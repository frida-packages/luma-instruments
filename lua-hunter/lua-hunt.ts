import { type Interpreter, InterpreterRegistry } from "./interpreters.js";
import { findEmbeddedLuaRuntime, findExportedLuaRuntime, type LuaRuntime } from "./lua-runtimes.js";
import { codePointersIn, deriveLayout, locateStateAround, pairOf, peekPointer } from "./lua-states.js";
import { pointerKey, sweepWritableMemory, yieldToEventLoop } from "./memory-sweep.js";
import { Rendezvous, type RendezvousObserver } from "./rendezvous.js";
import type { Settings } from "./settings.js";

export interface HuntLog {
    note(text: string): void;
    onStillWaiting(interpreter: Interpreter): void;
}

export interface SweepActivity {
    showSweeping(sweeping: boolean): void;
}

type Phase = "starting" | "running" | "disposed";

interface AdoptedRuntime {
    runtime: LuaRuntime;
    lifecycle: InvocationListener[];
}

const CENSUS_MAX_AGE_MS = 2000;

export class LuaHunt implements RendezvousObserver {
    readonly registry = new InterpreterRegistry();
    readonly rendezvous: Rendezvous;
    readonly #settings: Settings;
    readonly #log: HuntLog;
    readonly #activity: SweepActivity;
    readonly #adopted = new Map<string, AdoptedRuntime>();
    readonly #embeddedCandidates: Module[] = [];
    readonly #anchorsLearnedFrom = new Set<Interpreter>();
    #moduleObserver!: ModuleObserver;
    #phase: Phase = "starting";
    #sweep: Promise<void> | null = null;
    #sweepWanted = false;
    #checkingModules: Promise<void> | null = null;

    constructor(settings: Settings, log: HuntLog, activity: SweepActivity) {
        this.#settings = settings;
        this.#log = log;
        this.#activity = activity;
        this.rendezvous = new Rendezvous(this.registry, this);
    }

    async start(): Promise<void> {
        this.#moduleObserver = Process.attachModuleObserver({
            onAdded: module => this.#consider(module),
            onRemoved: module => this.#abandon(module),
        });
        await this.#checkEmbeddedCandidates();
        if (this.#phase === "disposed") {
            return;
        }
        this.#phase = "running";
        if (this.#adopted.size === 0) {
            this.#log.note("No Lua found yet. Libraries loaded later are checked as they load.");
        }
        await this.rescan();
    }

    #consider(module: Module): void {
        const runtime = findExportedLuaRuntime(module);
        if (runtime !== null) {
            this.#adopt(runtime);
            return;
        }
        this.#embeddedCandidates.push(module);
        if (this.#phase === "running") {
            void this.#checkEmbeddedCandidates();
        }
    }

    #adopt(runtime: LuaRuntime): void {
        this.#adopted.set(runtime.image.module.path, { runtime, lifecycle: this.#watchLifecycle(runtime) });
        this.rendezvous.add(runtime);
        this.#log.note(`Found ${runtime.release.name} in ${runtime.moduleName}, ${howFound(runtime)}.`);
        if (this.#phase === "running" && this.#checkingModules === null) {
            void this.rescan();
        }
    }

    #watchLifecycle(runtime: LuaRuntime): InvocationListener[] {
        const hunt = this;
        const { creators, closer } = runtime.lifecycle;
        const listeners = creators.map(creator => Interceptor.attach(creator, {
            onLeave(retval) {
                if (!retval.isNull()) {
                    hunt.#onCreated(runtime, retval);
                }
            },
        }));
        if (closer !== null) {
            listeners.push(Interceptor.attach(closer, {
                onEnter(args) {
                    this.closing = hunt.#onClosing(runtime, args[0]);
                },
                onLeave() {
                    if (this.closing !== null) {
                        hunt.registry.endClosing(this.closing);
                    }
                },
            }));
        }
        return listeners;
    }

    #onCreated(runtime: LuaRuntime, L: NativePointer): void {
        runtime.layout ??= deriveLayout(runtime.flavor, L);
        const pair = (runtime.layout !== null) ? pairOf(runtime.flavor, runtime.layout, L) : null;
        if (pair !== null) {
            this.registry.admit(runtime, pair, "creation");
            this.rendezvous.explore();
        }
    }

    #onClosing(runtime: LuaRuntime, L: NativePointer): Interpreter | null {
        const pair = (runtime.layout !== null) ? pairOf(runtime.flavor, runtime.layout, L) : null;
        const interpreter = (pair !== null) ? this.registry.lookup(pair.global) : undefined;
        if (interpreter === undefined) {
            return null;
        }
        this.rendezvous.forget(interpreter, `${interpreter.label} was closed before it came by.`);
        this.registry.beginClosing(interpreter);
        return interpreter;
    }

    async rescan(): Promise<void> {
        if (this.#settings.scanMemory) {
            await this.#requestSweep();
        }
        if (this.#phase !== "disposed") {
            this.rendezvous.explore();
        }
    }

    #requestSweep(): Promise<void> {
        if (this.#sweep !== null) {
            this.#sweepWanted = true;
            return this.#sweep;
        }
        this.#activity.showSweeping(true);
        this.#sweep = this.#sweepOnce().finally(() => {
            this.#sweep = null;
            if (this.#phase === "disposed") {
                return;
            }
            if (this.#sweepWanted) {
                this.#sweepWanted = false;
                void this.#requestSweep();
            } else {
                this.#activity.showSweeping(false);
            }
        });
        return this.#sweep;
    }

    async #sweepOnce(): Promise<void> {
        const owners = new Map<string, LuaRuntime>();
        for (const runtime of this.#runtimes) {
            for (const anchor of runtime.anchors) {
                owners.set(pointerKey(ptr(anchor)), runtime);
            }
        }
        if (owners.size === 0) {
            return;
        }
        const knownBefore = this.registry.all.length;
        const { slots, bytesScanned, durationMs } = await sweepWritableMemory([...owners.keys()].map(key => ptr(key)));
        const located = new Set<Interpreter>();
        for (const slot of slots) {
            const value = peekPointer(slot);
            const runtime = (value !== null) ? owners.get(pointerKey(value)) : undefined;
            const found = (runtime !== undefined) ? locateStateAround(runtime.flavor, runtime.layout, slot) : null;
            if (runtime !== undefined && found !== null) {
                runtime.layout ??= found.layout;
                located.add(this.registry.admit(runtime, found.pair, "memory"));
            }
        }
        const added = this.registry.all.length - knownBefore;
        this.#log.note(`Swept ${formatBytes(bytesScanned)} of writable memory in ${durationMs} ms: `
            + `${located.size} interpreter${(located.size === 1) ? "" : "s"} in memory, ${added} not known before.`);
    }

    get #runtimes(): LuaRuntime[] {
        return [...this.#adopted.values()].map(({ runtime }) => runtime);
    }

    #checkEmbeddedCandidates(): Promise<void> {
        this.#checkingModules ??= this.#drainEmbeddedCandidates().finally(() => {
            this.#checkingModules = null;
        });
        return this.#checkingModules;
    }

    async #drainEmbeddedCandidates(): Promise<void> {
        const adoptedBefore = this.#adopted.size;
        while (this.#embeddedCandidates.length !== 0) {
            const module = this.#embeddedCandidates.shift()!;
            const runtime = findEmbeddedLuaRuntime(module);
            if (runtime !== null) {
                this.#adopt(runtime);
            }
            await yieldToEventLoop();
        }
        if (this.#phase === "running" && this.#adopted.size !== adoptedBefore) {
            await this.rescan();
        }
    }

    #abandon(module: Module): void {
        const adopted = this.#adopted.get(module.path);
        if (adopted === undefined) {
            return;
        }
        this.#adopted.delete(module.path);
        this.rendezvous.remove(adopted.runtime);
        for (const interpreter of this.registry.live.filter(candidate => candidate.runtime === adopted.runtime)) {
            this.#close(interpreter);
        }
    }

    #close(interpreter: Interpreter): void {
        this.rendezvous.forget(interpreter, `${interpreter.label} was closed before it came by.`);
        this.registry.update(interpreter, subject => {
            subject.presence = "closed";
        });
    }

    dispose(): void {
        this.#phase = "disposed";
        this.#moduleObserver.detach();
        this.rendezvous.dispose();
        for (const { lifecycle } of this.#adopted.values()) {
            for (const listener of lifecycle) {
                listener.detach();
            }
        }
        this.#adopted.clear();
    }

    refreshCensus(interpreter: Interpreter, L: NativePointer, threadId: ThreadId): void {
        interpreter.censusTakenAt = 0;
        this.onSighted(interpreter, L, threadId);
    }

    onSighted(interpreter: Interpreter, L: NativePointer, threadId: ThreadId): void {
        const executor = interpreter.runtime.executor;
        const censusIsStale = executor !== null && Date.now() - interpreter.censusTakenAt > CENSUS_MAX_AGE_MS;
        if (interpreter.presence === "seen" && interpreter.thread === threadId && !censusIsStale) {
            return;
        }
        const census = (executor !== null && censusIsStale) ? executor.census(L) : null;
        this.registry.update(interpreter, subject => {
            subject.presence = "seen";
            subject.thread = threadId;
            if (census !== null) {
                subject.census = census;
                subject.censusTakenAt = Date.now();
            }
        });
        this.#learnAnchorsFrom(interpreter);
    }

    #learnAnchorsFrom(interpreter: Interpreter): void {
        if (this.#anchorsLearnedFrom.has(interpreter)) {
            return;
        }
        this.#anchorsLearnedFrom.add(interpreter);
        const { runtime } = interpreter;
        const learned = runtime.learnAnchors(codePointersIn(interpreter.global, address => runtime.image.isCode(address)));
        if (learned && this.#settings.scanMemory && this.#phase === "running") {
            setTimeout(() => void this.#requestSweep(), 0);
        }
    }

    onStillWaiting(interpreter: Interpreter): void {
        this.#log.onStillWaiting(interpreter);
    }
}

function howFound(runtime: LuaRuntime): string {
    switch (runtime.discovery) {
        case "exports":
            return "through its exported API";
        case "symbols":
            return "through its symbols";
        case "strings":
            return (runtime.executor !== null)
                ? "through its strings; it has no symbols, so its API was recovered from the base library's code"
                : "through its strings; it has no symbols and its API could not be recovered, so code cannot be run in it";
    }
}

function formatBytes(byteCount: number): string {
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let value = byteCount;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${(unit === 0) ? value : value.toFixed(1)} ${units[unit]}`;
}
