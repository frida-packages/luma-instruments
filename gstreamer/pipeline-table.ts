import type { BinFacts, ElementState } from "./gstreamer-api.js";
import type { ScanStatus } from "./scan-status.js";
import type { TrackedBin } from "./tracked-bins.js";

type PipelineTableWidget = CustomInstrumentWidgetMap["pipelines"];
type Cells = Parameters<PipelineTableWidget["upsertRow"]>[0]["cells"];

export class PipelineTable {
    readonly #table: PipelineTableWidget;
    readonly #status: ScanStatus;
    readonly #shownCells = new Map<string, string>();

    constructor(table: PipelineTableWidget, status: ScanStatus) {
        this.#table = table;
        this.#status = status;
        table.clear();
    }

    enableRescan(enabled: boolean): void {
        this.#table.setActionEnabled("rescan", enabled);
    }

    showBin(bin: TrackedBin, facts: BinFacts): void {
        const cells: Cells = {
            name: facts.name,
            type: facts.type,
            kind: facts.isPipeline ? "pipeline" : "bin",
            state: stateText(facts.state, facts.pending),
            elements: String(facts.elements),
            address: bin.id,
            found: bin.foundBy,
        };
        const text = JSON.stringify(cells);
        if (this.#shownCells.get(bin.id) !== text) {
            this.#shownCells.set(bin.id, text);
            this.#table.upsertRow({ id: bin.id, cells });
            this.#status.showBinCount(this.#shownCells.size);
        }
    }

    removeBin(bin: TrackedBin): void {
        if (this.#shownCells.delete(bin.id)) {
            this.#table.removeRow(bin.id);
            this.#status.showBinCount(this.#shownCells.size);
        }
    }
}

function stateText(state: ElementState, pending: ElementState): string {
    return (pending === "void-pending") ? state : `${state} → ${pending}`;
}
