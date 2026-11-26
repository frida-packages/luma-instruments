import type { Evaluation, JsiEvaluator } from "./jsi-evaluator.js";
import { type JsiSlots, slotFunction } from "./jsi-vtables.js";
import { javaScriptThreadNames, type Platform } from "./platforms.js";
import type { RuntimeClass } from "./runtime-classes.js";
import { holdsInstance, pointerKey } from "./runtime-instances.js";
import type { Runtime, RuntimeRegistry } from "./runtimes.js";

export interface Errand {
    source: string | (() => string);
    settle(evaluation: Evaluation): void;
    abandon(reason: string): void;
}

export interface RendezvousObserver {
    onOwnerLearned(runtime: Runtime): void;
    onRuntimeClosed(runtime: Runtime): void;
}

const EXPLORATION_MS = 6000;
const visitedSlots: (keyof Pick<JsiSlots, "call" | "global" | "utf8">)[] = ["call", "global", "utf8"];

export class Rendezvous {
    readonly #registry: RuntimeRegistry;
    readonly #evaluator: JsiEvaluator;
    readonly #platform: Platform;
    readonly #observer: RendezvousObserver;
    readonly #errands = new Map<Runtime, Errand[]>();
    readonly #busy = new Set<Runtime>();
    readonly #classes = new Map<string, RuntimeClass>();
    readonly #entryPoints = new Map<string, NativePointer>();
    readonly #destructors = new Map<string, InvocationListener>();
    readonly #unwakeable = new Set<Runtime>();
    #listeners: InvocationListener[] = [];
    #exploringUntil = 0;
    #disposed = false;
    #explorationEnd: ReturnType<typeof setTimeout> | null = null;

    constructor(registry: RuntimeRegistry, evaluator: JsiEvaluator, platform: Platform, observer: RendezvousObserver) {
        this.#registry = registry;
        this.#evaluator = evaluator;
        this.#platform = platform;
        this.#observer = observer;
    }

    watchClasses(classes: RuntimeClass[]): void {
        for (const runtimeClass of classes) {
            this.#classes.set(pointerKey(runtimeClass.vtable), runtimeClass);
            for (const slot of visitedSlots) {
                const entryPoint = slotFunction(runtimeClass.vtable, runtimeClass.base.slots[slot]);
                this.#entryPoints.set(entryPoint.toString(), entryPoint);
            }
            this.#watchDestruction(runtimeClass);
        }
        this.#refreshListeners();
    }

    explore(): void {
        this.#exploringUntil = Date.now() + EXPLORATION_MS;
        if (this.#explorationEnd !== null) {
            clearTimeout(this.#explorationEnd);
        }
        this.#explorationEnd = setTimeout(() => {
            this.#explorationEnd = null;
            this.#refreshListeners();
        }, EXPLORATION_MS);
        this.#refreshListeners();
    }

    send(runtime: Runtime, errand: Errand): void {
        const pending = this.#errands.get(runtime) ?? [];
        pending.push(errand);
        this.#errands.set(runtime, pending);
        if (runtime.owner === null) {
            this.#presumeOwner(runtime);
        }
        if (!this.#wakeOwner(runtime)) {
            this.#unwakeable.add(runtime);
        }
        this.#refreshListeners();
    }

    pendingFor(runtime: Runtime): number {
        return this.#errands.get(runtime)?.length ?? 0;
    }

    recall(runtime: Runtime, reason: string): number {
        const pending = this.#errands.get(runtime) ?? [];
        this.#errands.delete(runtime);
        for (const errand of pending) {
            errand.abandon(reason);
        }
        this.#refreshListeners();
        return pending.length;
    }

    dispose(): void {
        this.#disposed = true;
        if (this.#explorationEnd !== null) {
            clearTimeout(this.#explorationEnd);
        }
        for (const runtime of [...this.#errands.keys()]) {
            this.recall(runtime, "The instrument was removed before the runtime came by.");
        }
        this.#detach();
        this.#destructors.forEach(listener => listener.detach());
        this.#destructors.clear();
    }

    #watchDestruction(runtimeClass: RuntimeClass): void {
        const slot = runtimeClass.base.slots.deletingDestructor;
        if (slot === null) {
            return;
        }
        const destructor = slotFunction(runtimeClass.vtable, slot);
        if (this.#destructors.has(destructor.toString())) {
            return;
        }
        const rendezvous = this;
        this.#destructors.set(destructor.toString(), Interceptor.attach(destructor, {
            onEnter(args) {
                rendezvous.#onDestroyed(args[0]);
            },
        }));
    }

    #onDestroyed(address: NativePointer): void {
        const runtime = this.#registry.byKey(pointerKey(address));
        if (runtime === undefined || runtime.presence === "closed") {
            return;
        }
        this.#close(runtime);
    }

    #close(runtime: Runtime): void {
        this.#registry.close(runtime);
        this.recall(runtime, `${runtime.runtimeClass.engine} runtime #${runtime.number} was destroyed.`);
        this.#observer.onRuntimeClosed(runtime);
    }

    #presumeOwner(runtime: Runtime): void {
        const live = this.#registry.all.filter(candidate => candidate.presence !== "closed");
        const unowned = live.filter(candidate => candidate.owner === null);
        const owners = new Set(live.map(candidate => candidate.owner).filter(owner => owner !== null));
        const threads = Process.enumerateThreads()
            .filter(thread => thread.name !== undefined && javaScriptThreadNames.has(thread.name) && !owners.has(thread.id));
        if (unowned.length !== 1 || threads.length !== 1) {
            return;
        }
        runtime.owner = threads[0].id;
        runtime.ownerName = threads[0].name!;
        runtime.ownership = "presumed";
        this.#registry.changed(runtime);
        this.#observer.onOwnerLearned(runtime);
    }

    #wakeOwner(runtime: Runtime): boolean {
        const owner = runtime.owner;
        if (owner === null || !this.#platform.wakes) {
            return false;
        }
        return this.#platform.wake(owner, () => {
            if (runtime.owner === owner && runtime.presence !== "closed") {
                this.#unwakeable.delete(runtime);
                this.#runErrands(runtime);
            }
        });
    }

    #refreshListeners(): void {
        if (this.#listenersWanted() && this.#listeners.length === 0) {
            this.#attach();
        } else if (!this.#listenersWanted() && this.#listeners.length !== 0) {
            setTimeout(() => {
                if (!this.#listenersWanted()) {
                    this.#detach();
                }
            }, 0);
        }
    }

    #listenersWanted(): boolean {
        return !this.#disposed && (Date.now() < this.#exploringUntil || this.#registry.all.some(runtime =>
            this.pendingFor(runtime) !== 0 && (this.#unwakeable.has(runtime) || runtime.ownership !== "seen" || !this.#platform.wakes)));
    }

    #attach(): void {
        const rendezvous = this;
        this.#listeners = [...this.#entryPoints.values()].map(entryPoint => Interceptor.attach(entryPoint, {
            onEnter(args) {
                rendezvous.#visit(args[0], this.threadId);
            },
        }));
    }

    #detach(): void {
        this.#listeners.forEach(listener => listener.detach());
        this.#listeners = [];
    }

    #visit(address: NativePointer, thread: ThreadId): void {
        const runtime = this.#registry.byKey(pointerKey(address)) ?? this.#discovered(address);
        if (runtime === null || runtime.presence === "closed" || this.#busy.has(runtime)) {
            return;
        }
        if (runtime.ownership !== "seen") {
            this.#learnOwner(runtime, thread);
        } else if (runtime.owner !== thread) {
            return;
        }
        if (this.pendingFor(runtime) === 0) {
            this.#refreshListeners();
        } else if (!this.#wakeOwner(runtime)) {
            this.#runErrands(runtime);
        }
    }

    #discovered(address: NativePointer): Runtime | null {
        if (Date.now() >= this.#exploringUntil) {
            return null;
        }
        let vtable: NativePointer;
        try {
            vtable = address.readPointer();
        } catch (e) {
            return null;
        }
        const runtimeClass = this.#classes.get(pointerKey(vtable));
        return (runtimeClass !== undefined) ? this.#registry.admit(address, runtimeClass) : null;
    }

    #learnOwner(runtime: Runtime, thread: ThreadId): void {
        runtime.owner = thread;
        runtime.ownership = "seen";
        runtime.ownerName = Process.enumerateThreads().find(candidate => candidate.id === thread)?.name ?? null;
        runtime.presence = "seen";
        this.#registry.changed(runtime);
        this.#observer.onOwnerLearned(runtime);
        this.#presumeForWaiting();
    }

    #presumeForWaiting(): void {
        for (const waiting of this.#errands.keys()) {
            if (waiting.owner === null) {
                this.#presumeOwner(waiting);
                this.#wakeOwner(waiting);
            }
        }
    }

    #runErrands(runtime: Runtime): void {
        const pending = this.#errands.get(runtime);
        if (pending === undefined || this.#busy.has(runtime)) {
            return;
        }
        if (!holdsInstance(runtime.address, runtime.runtimeClass.vtable)) {
            this.#close(runtime);
            return;
        }
        this.#errands.delete(runtime);
        this.#busy.add(runtime);
        try {
            for (const errand of pending) {
                this.#runErrand(runtime, errand);
            }
        } finally {
            this.#busy.delete(runtime);
        }
        if (this.#errands.has(runtime)) {
            this.#runErrands(runtime);
        }
    }

    #runErrand(runtime: Runtime, errand: Errand): void {
        if (runtime.presence === "closed") {
            errand.abandon(`${runtime.runtimeClass.engine} runtime #${runtime.number} was destroyed.`);
            return;
        }
        let evaluation: Evaluation;
        try {
            const source = (typeof errand.source === "function") ? errand.source() : errand.source;
            evaluation = this.#evaluator.evaluate(runtime.address, runtime.runtimeClass.base.slots, source);
        } catch (e) {
            errand.abandon(`Evaluating failed: ${(e instanceof Error) ? e.message : String(e)}`);
            return;
        }
        errand.settle(evaluation);
    }
}
