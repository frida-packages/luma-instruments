import type { Census } from "./census.js";
import type { LuaRuntime } from "./lua-runtimes.js";
import type { StatePair } from "./lua-states.js";

export type Sighting = "memory" | "creation" | "call";
export type Presence = "unseen" | "seen" | "closed";

export class Interpreter {
    census: Census | null = null;
    censusTakenAt = 0;
    thread: ThreadId | null = null;
    presence: Presence = "unseen";

    constructor(
        readonly number: number,
        readonly runtime: LuaRuntime,
        readonly main: NativePointer,
        readonly global: NativePointer,
        readonly sighting: Sighting,
    ) {
    }

    get label(): string {
        return `#${this.number} ${this.runtime.release.name}`;
    }

    get canRun(): boolean {
        return this.runtime.executor !== null && this.presence !== "closed";
    }
}

export interface InterpreterObserver {
    onInterpreterAdded(interpreter: Interpreter): void;
    onInterpreterChanged(interpreter: Interpreter): void;
}

export class InterpreterRegistry {
    private readonly interpreters: Interpreter[] = [];
    private readonly byGlobal = new Map<string, Interpreter>();
    private readonly closing = new Set<string>();
    private readonly observers: InterpreterObserver[] = [];
    private nextNumber = 1;

    observe(observer: InterpreterObserver): void {
        this.observers.push(observer);
    }

    get all(): Interpreter[] {
        return this.interpreters;
    }

    get live(): Interpreter[] {
        return this.all.filter(interpreter => interpreter.presence !== "closed");
    }

    numbered(number: number): Interpreter | undefined {
        return this.all.find(interpreter => interpreter.number === number);
    }

    lookup(global: NativePointer): Interpreter | undefined {
        return this.byGlobal.get(global.toString());
    }

    admit(runtime: LuaRuntime, pair: StatePair, sighting: Sighting): Interpreter {
        const known = this.lookup(pair.global);
        if (known !== undefined && (known.presence !== "closed" || this.closing.has(pair.global.toString()))) {
            return known;
        }
        const interpreter = new Interpreter(this.nextNumber++, runtime, pair.main, pair.global, sighting);
        this.interpreters.push(interpreter);
        this.byGlobal.set(pair.global.toString(), interpreter);
        for (const observer of this.observers) {
            observer.onInterpreterAdded(interpreter);
        }
        return interpreter;
    }

    beginClosing(interpreter: Interpreter): void {
        this.closing.add(interpreter.global.toString());
        this.update(interpreter, subject => {
            subject.presence = "closed";
        });
    }

    endClosing(interpreter: Interpreter): void {
        this.closing.delete(interpreter.global.toString());
    }

    update(interpreter: Interpreter, change: (interpreter: Interpreter) => void): void {
        change(interpreter);
        for (const observer of this.observers) {
            observer.onInterpreterChanged(interpreter);
        }
    }
}
