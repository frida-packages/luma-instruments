import type { BinFacts, ElementState } from "./gstreamer-api.js";
import type { GraphDetail } from "./settings.js";
import type { TrackedBin } from "./tracked-bins.js";

type Pages = CustomInstrumentChildren<"bin">;
type Tone = NonNullable<NonNullable<CustomInstrumentChildRow["badge"]>["tone"]>;

export type BinPage = CustomInstrumentChild<"bin">;

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

const LONGEST_TITLE = 120;

const tones: Record<ElementState, Tone> = {
    "void-pending": "neutral",
    "null": "ended",
    "ready": "neutral",
    "paused": "waiting",
    "playing": "active",
};

export class BinPages {
    readonly #pages: Pages;
    readonly #unconfirmed: Set<string>;
    readonly #shownRows = new Map<string, string>();
    readonly #sentGraphs = new Map<string, SentGraph>();

    constructor(pages: Pages) {
        this.#pages = pages;
        this.#unconfirmed = new Set(pages.ids());
    }

    show(bin: TrackedBin, facts: BinFacts, details: GraphDetail, dot: ArrayBuffer): void {
        const page = this.#pageOf(bin, facts);
        const { name, type, state, pending } = facts;
        const pipeline = { id: bin.id, name, type, state, pending };
        const graph = { description: JSON.stringify({ pipeline, details }), dot: new Uint8Array(dot) };
        const sent = this.#sentGraphs.get(bin.id);
        if (sent !== undefined && isSameGraph(sent, graph)) {
            return;
        }
        const value: GraphState = { pipeline, details, takenAt: Date.now() };
        page.widget("graph").setState(value, dot);
        this.#sentGraphs.set(bin.id, graph);
    }

    find(bin: TrackedBin): BinPage | null {
        return this.#shownRows.has(bin.id) ? this.#pages.get(bin.id)! : null;
    }

    remove(bin: TrackedBin): void {
        if (this.#shownRows.delete(bin.id)) {
            this.#sentGraphs.delete(bin.id);
            this.#pages.remove(bin.id);
        }
    }

    dropUnconfirmed(): void {
        for (const id of this.#unconfirmed) {
            this.#pages.remove(id);
        }
        this.#unconfirmed.clear();
    }

    #pageOf(bin: TrackedBin, facts: BinFacts): BinPage {
        this.#unconfirmed.delete(bin.id);
        const row = rowOf(bin, facts);
        const text = JSON.stringify(row);
        if (this.#shownRows.get(bin.id) === text) {
            return this.#pages.get(bin.id)!;
        }
        this.#shownRows.set(bin.id, text);
        return this.#pages.add(bin.id, row);
    }
}

function rowOf(bin: TrackedBin, facts: BinFacts): CustomInstrumentChildRow {
    const { name, type, state, pending, elements } = facts;
    const waiting = pending !== "void-pending";
    return {
        title: name.slice(0, LONGEST_TITLE),
        subtitle: `${type} · ${elements} element${(elements === 1) ? "" : "s"} · ${bin.id}`,
        badge: { text: waiting ? `${state} → ${pending}` : state, tone: waiting ? "waiting" : tones[state] },
    };
}

function isSameGraph(a: SentGraph, b: SentGraph): boolean {
    return a.description === b.description && a.dot.length === b.dot.length && a.dot.every((byte, i) => byte === b.dot[i]);
}
