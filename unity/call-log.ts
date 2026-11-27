import type { StatusLine } from "./status-line.js";

type CallTable = CustomInstrumentWidgetMap["calls"];
type HitHistogram = CustomInstrumentWidgetMap["hits"];

export interface Call {
    seq: number;
    time: string;
    thread: number;
    method: string;
    args: string;
    resultPointer: NativePointer;
}

const FLUSH_MS = 1000;
const MOST_BUCKETS = 100;

export class CallLog {
    readonly #table: CallTable;
    readonly #hits: HitHistogram;
    readonly #status: StatusLine;
    readonly #counts = new Map<string, number>();
    readonly #timer: ReturnType<typeof setInterval>;
    #perSecond = 0;
    #paused = false;
    #seq = 0;
    #windowStart = 0;
    #inWindow = 0;
    #dropped = 0;
    #changed = false;

    constructor(table: CallTable, hits: HitHistogram, status: StatusLine) {
        this.#table = table;
        this.#hits = hits;
        this.#status = status;
        table.clear();
        hits.clear();
        table.setActionEnabled("resume", false);
        this.#timer = setInterval(() => this.#flush(), FLUSH_MS);
    }

    set perSecond(perSecond: number) {
        this.#perSecond = perSecond;
    }

    admit(method: string): Call | null {
        if (this.#paused) {
            return null;
        }
        this.#counts.set(method, (this.#counts.get(method) ?? 0) + 1);
        this.#changed = true;
        if (!this.#withinRate()) {
            this.#dropped++;
            return null;
        }
        return { seq: ++this.#seq, time: timeOfDay(), thread: Process.getCurrentThreadId(), method, args: "", resultPointer: NULL };
    }

    show(call: Call, result: string): void {
        const { seq, time, thread, method, args } = call;
        this.#table.upsertRow({ id: String(seq), cells: { seq: String(seq), time, thread: String(thread), method, args, result } });
    }

    pause(): void {
        this.#setPaused(true);
    }

    resume(): void {
        this.#setPaused(false);
    }

    clear(): void {
        this.#table.clear();
        this.#hits.clear();
        this.#counts.clear();
        this.#dropped = 0;
        this.#changed = false;
        this.#status.forget("calls");
    }

    dispose(): void {
        clearInterval(this.#timer);
    }

    #withinRate(): boolean {
        const now = Date.now();
        if (now - this.#windowStart >= 1000) {
            this.#windowStart = now;
            this.#inWindow = 0;
        }
        return this.#inWindow++ < this.#perSecond;
    }

    #setPaused(paused: boolean): void {
        this.#paused = paused;
        this.#table.setActionEnabled("pause", !paused);
        this.#table.setActionEnabled("resume", paused);
    }

    #flush(): void {
        if (!this.#changed) {
            return;
        }
        this.#changed = false;
        const buckets = [...this.#counts]
            .sort((a, b) => b[1] - a[1])
            .slice(0, MOST_BUCKETS)
            .map(([label, count]) => ({ label, count }));
        this.#hits.setHistogram(buckets);
        if (this.#dropped !== 0) {
            this.#status.note("calls", `${this.#dropped} call${(this.#dropped === 1) ? "" : "s"} counted but not recorded, over the cap of ${this.#perSecond} a second`,
                "Raise “Most calls recorded per second”, or narrow “Trace methods matching”.");
        }
    }
}

function timeOfDay(): string {
    const now = new Date();
    const pad = (value: number, width: number) => String(value).padStart(width, "0");
    return `${pad(now.getHours(), 2)}:${pad(now.getMinutes(), 2)}:${pad(now.getSeconds(), 2)}.${pad(now.getMilliseconds(), 3)}`;
}
