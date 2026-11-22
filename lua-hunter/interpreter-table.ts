import type { Interpreter, InterpreterObserver } from "./interpreters.js";

type InterpreterTableWidget = CustomInstrumentWidgetMap["interpreters"];

export interface ConsoleStatus {
    statusOf(interpreter: Interpreter): string;
}

const FLUSH_DELAY_MS = 100;
const NOTABLE_NAMES_SHOWN = 4;
const missing = "—";

export class InterpreterTable implements InterpreterObserver {
    private readonly changed = new Set<Interpreter>();
    private pendingFlush: ReturnType<typeof setTimeout> | null = null;
    private status!: ConsoleStatus;

    constructor(private readonly table: InterpreterTableWidget) {
    }

    attach(status: ConsoleStatus): void {
        this.status = status;
    }

    onInterpreterAdded(interpreter: Interpreter): void {
        this.show(interpreter);
    }

    onInterpreterChanged(interpreter: Interpreter): void {
        this.show(interpreter);
    }

    show(interpreter: Interpreter): void {
        this.changed.add(interpreter);
        this.pendingFlush ??= setTimeout(() => this.flush(), FLUSH_DELAY_MS);
    }

    dispose(): void {
        if (this.pendingFlush !== null) {
            clearTimeout(this.pendingFlush);
            this.flush();
        }
    }

    private flush(): void {
        this.pendingFlush = null;
        for (const interpreter of this.changed) {
            this.table.upsertRow({ id: String(interpreter.number), cells: this.cellsOf(interpreter) });
        }
        this.changed.clear();
    }

    private cellsOf(interpreter: Interpreter) {
        const { runtime, census } = interpreter;
        return {
            number: `#${interpreter.number}`,
            lua: runtime.release.name,
            code: `${runtime.moduleName} (${accessLabel(interpreter)})`,
            state: interpreter.main.toString(),
            thread: (interpreter.thread !== null) ? String(interpreter.thread) : missing,
            globals: (census !== null) ? globalsSummary(census.globals, census.notable) : missing,
            console: this.status.statusOf(interpreter),
        };
    }
}

function accessLabel({ runtime }: Interpreter): string {
    switch (runtime.discovery) {
        case "exports":
            return "exports";
        case "symbols":
            return "symbols";
        case "strings":
            return (runtime.executor !== null) ? "stripped, API recovered" : "stripped";
    }
}

function globalsSummary(count: number, notable: string[]): string {
    const shown = notable.slice(0, NOTABLE_NAMES_SHOWN).join(", ");
    const more = (notable.length > NOTABLE_NAMES_SHOWN) ? ", …" : "";
    return (shown.length !== 0) ? `${count}: ${shown}${more}` : String(count);
}
