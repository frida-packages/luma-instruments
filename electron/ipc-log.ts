import { revive, summarize, summarizeArguments } from "./revived-values.js";
import type { Drained, IpcOutcome, IpcRecord } from "./runtime-link.js";

type IpcWidget = CustomInstrumentWidgetMap["ipc"];
type MessageWidget = CustomInstrumentWidgetMap["message"];

export interface InspectReply {
    output(text: string): void;
    error(text: string): void;
    value(value: unknown): void;
}

export type ContentsLabel = (id: number | null) => string;

interface KeptMessage {
    record: IpcRecord;
    outcome: IpcOutcome | null;
}

const KEPT_MESSAGES = 1000;
const ARGUMENTS_CELL_CHARS = 120;
const RESULT_CELL_CHARS = 80;
const directionLabels = { in: "→ main", out: "main →" };

export class IpcLog {
    readonly #table: IpcWidget;
    readonly #detail: MessageWidget;
    readonly #contentsLabel: ContentsLabel;
    readonly #kept = new Map<number, KeptMessage>();

    constructor(table: IpcWidget, detail: MessageWidget, contentsLabel: ContentsLabel) {
        this.#table = table;
        this.#detail = detail;
        this.#contentsLabel = contentsLabel;
        table.clear();
        detail.clear();
        this.showPaused(false);
    }

    take({ messages, settled }: Drained): void {
        for (const record of messages) {
            this.#keep({ record, outcome: null });
        }
        for (const outcome of settled) {
            const kept = this.#kept.get(outcome.seq);
            if (kept !== undefined) {
                kept.outcome = outcome;
                this.#showRow(kept);
            }
        }
    }

    inspectRow(item: string): void {
        this.inspect(Number(item), {
            output: text => this.#detail.appendOutput(text),
            error: text => this.#detail.appendError(text),
            value: value => this.#detail.appendValue(value),
        });
    }

    handleInput(text: string, reply: InspectReply): void {
        const seq = Number(text.trim().replace(/^#/, ""));
        if (!Number.isInteger(seq)) {
            reply.error("Type the number of a message in the IPC table, such as 12.");
            return;
        }
        this.inspect(seq, reply);
    }

    inspect(seq: number, reply: InspectReply): void {
        const kept = this.#kept.get(seq);
        if (kept === undefined) {
            reply.error(`Message #${seq} is not kept; the last ${KEPT_MESSAGES} are.`);
            return;
        }
        const { record, outcome } = kept;
        reply.output(this.#headline(record));
        reply.value(detailOf(record, outcome));
    }

    showPaused(paused: boolean): void {
        this.#table.setActionEnabled("pause", !paused);
        this.#table.setActionEnabled("resume", paused);
    }

    clear(): void {
        this.#kept.clear();
        this.#table.clear();
    }

    clearDetail(): void {
        this.#detail.clear();
    }

    #keep(kept: KeptMessage): void {
        this.#kept.set(kept.record.seq, kept);
        if (this.#kept.size > KEPT_MESSAGES) {
            const [oldest] = this.#kept.keys();
            this.#kept.delete(oldest);
        }
        this.#showRow(kept);
    }

    #showRow({ record, outcome }: KeptMessage): void {
        this.#table.upsertRow({
            id: String(record.seq),
            cells: {
                seq: String(record.seq),
                time: clockOf(record.time),
                direction: directionLabels[record.direction],
                kind: (record.ports !== 0) ? `${record.kind} (${record.ports} port${(record.ports === 1) ? "" : "s"})` : record.kind,
                channel: record.channel,
                contents: (record.contents !== null) ? `#${record.contents}` : "—",
                args: summarizeArguments(record.args, ARGUMENTS_CELL_CHARS),
                result: resultCell(record, outcome),
                duration: (outcome !== null) ? String(outcome.duration) : "",
            },
        });
    }

    #headline(record: IpcRecord): string {
        const frame = (record.frame !== null) ? `, frame ${record.frame.join("/")}` : "";
        const way = (record.direction === "in") ? "from" : "to";
        return `#${record.seq} ${record.kind} “${record.channel}” ${way} ${this.#contentsLabel(record.contents)}${frame}, at ${clockOf(record.time)}`;
    }
}

function detailOf(record: IpcRecord, outcome: IpcOutcome | null): { [key: string]: unknown } {
    const detail: { [key: string]: unknown } = { arguments: revive(record.args) };
    if (record.ports !== 0) {
        detail.ports = record.ports;
    }
    if (outcome !== null) {
        if (outcome.ok) {
            detail.result = revive(outcome.value);
        } else {
            detail.error = outcome.error;
        }
        detail.milliseconds = outcome.duration;
    } else if (record.pending) {
        detail.result = "(not settled yet)";
    }
    return detail;
}

function resultCell(record: IpcRecord, outcome: IpcOutcome | null): string {
    if (outcome === null) {
        return record.pending ? "…" : "";
    }
    if (!outcome.ok) {
        return `✕ ${outcome.error!.split("\n")[0]}`.slice(0, RESULT_CELL_CHARS);
    }
    return summarize(outcome.value, RESULT_CELL_CHARS);
}

function clockOf(time: number): string {
    const date = new Date(time);
    const pad = (n: number, width = 2) => String(n).padStart(width, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}
