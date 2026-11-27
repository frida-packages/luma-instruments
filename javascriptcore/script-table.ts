import type { ContextRegistry } from "./contexts.js";
import type { ScriptObserver, ScriptRecord } from "./script-log.js";

type ScriptsWidget = CustomInstrumentWidgetMap["scripts"];
type ScriptCells = Parameters<ScriptsWidget["upsertRow"]>[0]["cells"];

const FLUSH_DELAY_MS = 300;

export class ScriptTable implements ScriptObserver {
    readonly #widget: ScriptsWidget;
    readonly #registry: ContextRegistry;
    readonly #dirty = new Set<ScriptRecord>();
    readonly #contextNumbers = new Map<ScriptRecord, string>();
    #flush: ReturnType<typeof setTimeout> | null = null;

    constructor(widget: ScriptsWidget, registry: ContextRegistry) {
        this.#widget = widget;
        this.#registry = registry;
        widget.clear();
    }

    onScriptChanged(record: ScriptRecord): void {
        this.#dirty.add(record);
        this.#flush ??= setTimeout(() => this.#render(), FLUSH_DELAY_MS);
    }

    onScriptRemoved(record: ScriptRecord): void {
        this.#dirty.delete(record);
        this.#contextNumbers.delete(record);
        this.#widget.removeRow(String(record.serial));
    }

    dispose(): void {
        if (this.#flush !== null) {
            clearTimeout(this.#flush);
        }
    }

    #render(): void {
        this.#flush = null;
        for (const record of this.#dirty) {
            this.#widget.upsertRow({ id: String(record.serial), cells: this.#cellsOf(record) });
        }
        this.#dirty.clear();
    }

    #cellsOf(record: ScriptRecord): ScriptCells {
        return {
            number: String(record.serial),
            time: record.firstRun.toLocaleTimeString(),
            context: this.#contextOf(record),
            via: record.via,
            url: record.url ?? "",
            size: (record.length !== null) ? sizeText(record.length) : "",
            lines: (record.lines !== null) ? String(record.lines) : "",
            runs: String(record.runs),
            outcome: record.outcome,
            ms: (record.ms !== null) ? String(record.ms) : "",
        };
    }

    #contextOf(record: ScriptRecord): string {
        const known = this.#contextNumbers.get(record);
        if (known !== undefined) {
            return known;
        }
        const context = this.#registry.liveContextAt(record.context);
        if (context === undefined) {
            return record.context.toString();
        }
        this.#contextNumbers.set(record, String(context.serial));
        return String(context.serial);
    }
}

function sizeText(characters: number): string {
    return (characters < 10240) ? `${characters} chars` : `${(characters / 1024).toFixed(0)} K chars`;
}
