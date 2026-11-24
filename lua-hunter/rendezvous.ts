import type { Interpreter, InterpreterRegistry } from "./interpreters.js";
import type { LuaRuntime } from "./lua-runtimes.js";
import { deriveLayout, pairOf } from "./lua-states.js";
import { openVisitGate, type VisitFilter, type VisitGate } from "./visit-gate.js";

export interface Errand {
    run(L: NativePointer, threadId: ThreadId): void;
    abandon(reason: string): void;
}

export interface RendezvousObserver {
    onSighted(interpreter: Interpreter, L: NativePointer, threadId: ThreadId): void;
    onStillWaiting(interpreter: Interpreter): void;
}

interface RuntimeHooks {
    runtime: LuaRuntime;
    filter: VisitFilter;
    listeners: InvocationListener[];
}

const EXPLORATION_VISITS = 2000;
const FOREIGN_VISITS_BEFORE_NOTICE = 5000;
const REMEMBERED_STATES = 4096;

export class Rendezvous {
    readonly #registry: InterpreterRegistry;
    readonly #observer: RendezvousObserver;
    readonly #runtimes: LuaRuntime[] = [];
    readonly #errands = new Map<Interpreter, Errand[]>();
    readonly #noticed = new Set<Interpreter>();
    readonly #states = new Map<string, Interpreter | null>();
    readonly #gate: VisitGate = openVisitGate();
    readonly #filters = new Map<LuaRuntime, VisitFilter>();
    #hooks: RuntimeHooks[] = [];
    #explorationLeft = 0;
    #detachScheduled = false;

    constructor(registry: InterpreterRegistry, observer: RendezvousObserver) {
        this.#registry = registry;
        this.#observer = observer;
    }

    get attached(): boolean {
        return this.#hooks.length !== 0;
    }

    add(runtime: LuaRuntime): void {
        this.#runtimes.push(runtime);
        if (this.attached) {
            this.#hooks.push(this.#hook(runtime));
            this.#refreshFilters();
        }
    }

    explore(): void {
        this.#explorationLeft = EXPLORATION_VISITS;
        this.#attach();
        this.#refreshFilters();
    }

    send(interpreter: Interpreter, errand: Errand): void {
        const pending = this.#errands.get(interpreter) ?? [];
        pending.push(errand);
        this.#errands.set(interpreter, pending);
        this.#noticed.delete(interpreter);
        this.#attach();
        this.#refreshFilters();
    }

    recall(interpreter: Interpreter, reason: string): number {
        const pending = this.#errands.get(interpreter) ?? [];
        this.#errands.delete(interpreter);
        for (const errand of pending) {
            errand.abandon(reason);
        }
        this.#refreshFilters();
        this.#scheduleDetachIfIdle();
        return pending.length;
    }

    pendingFor(interpreter: Interpreter): number {
        return this.#errands.get(interpreter)?.length ?? 0;
    }

    forget(interpreter: Interpreter, reason: string): void {
        this.recall(interpreter, reason);
        this.#noticed.delete(interpreter);
        for (const [state, known] of this.#states) {
            if (known === interpreter) {
                this.#states.delete(state);
            }
        }
    }

    remove(runtime: LuaRuntime): void {
        this.#runtimes.splice(this.#runtimes.indexOf(runtime), 1);
        const hooks = this.#hooks.find(candidate => candidate.runtime === runtime);
        if (hooks !== undefined) {
            this.#hooks.splice(this.#hooks.indexOf(hooks), 1);
            detachAll(hooks.listeners);
        }
    }

    dispose(): void {
        this.#detach();
        for (const interpreter of [...this.#errands.keys()]) {
            this.recall(interpreter, "The instrument was removed before the interpreter came by.");
        }
    }

    #attach(): void {
        if (!this.attached) {
            this.#hooks = this.#runtimes.map(runtime => this.#hook(runtime));
        }
    }

    #hook(runtime: LuaRuntime): RuntimeHooks {
        const filter = this.#filterFor(runtime);
        const listeners = runtime.entryPoints.map(({ address }) => filter.attach(address));
        return { runtime, filter, listeners };
    }

    #filterFor(runtime: LuaRuntime): VisitFilter {
        let filter = this.#filters.get(runtime);
        if (filter === undefined) {
            filter = this.#gate.filter((L, threadId) => this.#visit(runtime, L, threadId), () => this.#onForeignVisits());
            this.#filters.set(runtime, filter);
        }
        return filter;
    }

    #visit(runtime: LuaRuntime, L: NativePointer, threadId: ThreadId): void {
        const interpreter = this.#resolve(runtime, L);
        if (interpreter === null || interpreter.presence === "closed") {
            return;
        }
        this.#observer.onSighted(interpreter, L, threadId);
        this.#runErrands(interpreter, L, threadId);
        if (--this.#explorationLeft === 0) {
            this.#refreshFilters();
        }
        this.#scheduleDetachIfIdle();
    }

    #onForeignVisits(): void {
        for (const waiting of this.#errands.keys()) {
            if (!this.#noticed.has(waiting)) {
                this.#noticed.add(waiting);
                this.#observer.onStillWaiting(waiting);
            }
        }
    }

    #resolve(runtime: LuaRuntime, L: NativePointer): Interpreter | null {
        const key = L.toString();
        const known = this.#states.get(key);
        if (known !== undefined && (known === null || stillBelongs(runtime, L, known))) {
            return known;
        }
        runtime.layout ??= deriveLayout(runtime.flavor, L);
        const pair = (runtime.layout !== null) ? pairOf(runtime.flavor, runtime.layout, L) : null;
        const interpreter = (pair !== null) ? this.#registry.admit(runtime, pair, "call") : null;
        this.#remember(key, interpreter);
        return interpreter;
    }

    #remember(key: string, interpreter: Interpreter | null): void {
        this.#states.set(key, interpreter);
        if (this.#states.size > REMEMBERED_STATES) {
            this.#states.delete(this.#states.keys().next().value!);
        }
    }

    #runErrands(interpreter: Interpreter, L: NativePointer, threadId: ThreadId): void {
        const pending = this.#errands.get(interpreter);
        if (pending === undefined) {
            return;
        }
        this.#errands.delete(interpreter);
        this.#refreshFilters();
        for (const errand of pending) {
            try {
                errand.run(L, threadId);
            } catch (e) {
                errand.abandon(`Running it failed: ${(e instanceof Error) ? e.message : String(e)}`);
            }
        }
    }

    #refreshFilters(): void {
        for (const { runtime, filter } of this.#hooks) {
            if (this.#explorationLeft > 0 || runtime.layout === null) {
                filter.admitEverything();
            } else {
                const wanted = [...this.#errands.keys()].filter(interpreter => interpreter.runtime === runtime);
                filter.admitOnly(runtime.layout.globalOffset, wanted.map(interpreter => interpreter.global), FOREIGN_VISITS_BEFORE_NOTICE);
            }
        }
    }

    #scheduleDetachIfIdle(): void {
        if (this.#explorationLeft > 0 || this.#errands.size !== 0 || this.#detachScheduled || !this.attached) {
            return;
        }
        this.#detachScheduled = true;
        setTimeout(() => {
            this.#detachScheduled = false;
            if (this.#explorationLeft <= 0 && this.#errands.size === 0) {
                this.#detach();
            }
        }, 0);
    }

    #detach(): void {
        for (const { listeners } of this.#hooks) {
            detachAll(listeners);
        }
        this.#hooks = [];
    }
}

function stillBelongs(runtime: LuaRuntime, L: NativePointer, interpreter: Interpreter): boolean {
    const pair = pairOf(runtime.flavor, runtime.layout!, L);
    return pair !== null && pair.global.equals(interpreter.global);
}

function detachAll(listeners: InvocationListener[]): void {
    for (const listener of listeners) {
        listener.detach();
    }
}
