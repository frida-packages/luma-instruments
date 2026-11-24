import type { BinFacts, ElementState } from "./gstreamer-api.js";
import type { GraphDetail } from "./settings.js";
import type { TrackedBin } from "./tracked-bins.js";

type GraphWidget = CustomInstrumentWidgetMap["graph"];

export interface GraphState {
    pipeline: {
        id: string;
        name: string;
        type: string;
        state: ElementState;
        pending: ElementState;
    };
    details: GraphDetail;
    takenAt: number;
}

interface SentGraph {
    description: string;
    dot: Uint8Array;
}

export class GraphDisplay {
    readonly #widget: GraphWidget;
    #sent: SentGraph | null = null;

    constructor(widget: GraphWidget) {
        this.#widget = widget;
    }

    show(bin: TrackedBin, facts: BinFacts, details: GraphDetail, dot: ArrayBuffer): void {
        const { name, type, state, pending } = facts;
        const pipeline = { id: bin.id, name, type, state, pending };
        const graph = { description: JSON.stringify({ pipeline, details }), dot: new Uint8Array(dot) };
        if (this.#sent !== null && isSameGraph(this.#sent, graph)) {
            return;
        }
        const value: GraphState = { pipeline, details, takenAt: Date.now() };
        this.#widget.setState(value, dot);
        this.#sent = graph;
    }

    clear(): void {
        this.#widget.clear();
    }
}

function isSameGraph(a: SentGraph, b: SentGraph): boolean {
    return a.description === b.description && a.dot.length === b.dot.length && a.dot.every((byte, i) => byte === b.dot[i]);
}
