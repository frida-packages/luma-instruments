import type { Drained, TrafficRecord, TrafficUpdate } from "./runtime-kit.js";
import type { Runtime } from "./runtimes.js";
import type { Settings } from "./settings.js";

type TrafficWidget = CustomInstrumentWidgetMap["traffic"];
type DetailWidget = CustomInstrumentWidgetMap["detail"];
type Reply = Pick<CustomInstrumentConsoleResponder, "output" | "error" | "value">;

export interface CallCounter {
    count(module: string): void;
}

interface Call {
    id: string;
    runtime: Runtime;
    record: TrafficRecord;
    update: TrafficUpdate | null;
}

const FLUSH_DELAY_MS = 250;
const ROWS_KEPT = 2000;
const ARGUMENTS_SHOWN = 160;
const missing = "—";

const directionLabels: Record<TrafficRecord["direction"], string> = {
    "to native": "JS → native",
    "to JS": "native → JS",
    "event": "event → JS",
};

const helpLines = [
    "show <row>       show a call in full, by its row id, such as 1:42 (runtime 1, call 42)",
    "stats            count the calls seen and dropped",
    "help             show this",
];

export class TrafficView {
    readonly #table: TrafficWidget;
    readonly #detail: DetailWidget;
    readonly #settings: Settings;
    readonly #counter: CallCounter;
    readonly #calls = new Map<string, Call>();
    readonly #changed = new Set<Call>();
    #seen = 0;
    #dropped = 0;
    #pendingFlush: ReturnType<typeof setTimeout> | null = null;

    constructor(table: TrafficWidget, detail: DetailWidget, settings: Settings, counter: CallCounter) {
        this.#table = table;
        this.#detail = detail;
        this.#settings = settings;
        this.#counter = counter;
        table.clear();
        detail.clear();
    }

    add(runtime: Runtime, drained: Drained): void {
        this.#dropped += drained.dropped;
        for (const record of drained.records) {
            this.#addCall(runtime, record);
        }
        for (const update of drained.updates) {
            this.#updateCall(runtime, update);
        }
        this.#pendingFlush ??= setTimeout(() => this.#flush(), FLUSH_DELAY_MS);
    }

    note(text: string): void {
        this.#detail.appendOutput(text);
    }

    show(id: string, reply: Reply = this.#detailReply()): void {
        const call = this.#calls.get(id);
        if (call === undefined) {
            reply.error(`There is no call ${id} in the table any more.`);
            return;
        }
        reply.output(`Call ${id} in runtime #${call.runtime.number}:`);
        reply.value(fullCall(call));
    }

    run(text: string, reply: Reply): void {
        const [command, argument] = text.trim().split(/\s+/);
        switch (command) {
            case "show":
                this.show(argument ?? "", reply);
                break;
            case "stats":
                reply.output(`${this.#seen} calls seen, ${this.#calls.size} in the table, `
                    + `${this.#dropped} dropped by the runtimes before they could be read.`);
                break;
            case "help":
            case "":
                helpLines.forEach(line => reply.output(line));
                break;
            default:
                reply.error(`Unknown command ${command}. help lists them.`);
        }
    }

    clearTable(): void {
        this.#calls.clear();
        this.#changed.clear();
        this.#table.clear();
    }

    clearDetail(): void {
        this.#detail.clear();
    }

    dispose(): void {
        if (this.#pendingFlush !== null) {
            clearTimeout(this.#pendingFlush);
            this.#flush();
        }
    }

    #addCall(runtime: Runtime, record: TrafficRecord): void {
        this.#seen++;
        this.#counter.count(record.module);
        const pattern = this.#settings.trafficPattern;
        if (pattern !== null && !pattern.test(`${record.module}.${record.method}`)) {
            return;
        }
        const call: Call = { id: `${runtime.number}:${record.seq}`, runtime, record, update: null };
        this.#calls.set(call.id, call);
        this.#changed.add(call);
        if (this.#calls.size > ROWS_KEPT) {
            const oldest = this.#calls.keys().next().value!;
            this.#changed.delete(this.#calls.get(oldest)!);
            this.#calls.delete(oldest);
        }
    }

    #updateCall(runtime: Runtime, update: TrafficUpdate): void {
        const call = this.#calls.get(`${runtime.number}:${update.seq}`);
        if (call !== undefined) {
            call.update = update;
            this.#changed.add(call);
        }
    }

    #flush(): void {
        this.#pendingFlush = null;
        for (const call of this.#changed) {
            this.#table.upsertRow({ id: call.id, cells: cellsOf(call) });
        }
        this.#changed.clear();
    }

    #detailReply(): Reply {
        return {
            output: text => this.#detail.appendOutput(text),
            error: text => this.#detail.appendError(text),
            value: value => this.#detail.appendValue(value),
        };
    }
}

function cellsOf(call: Call) {
    const { record, update } = call;
    return {
        time: formattedTime(record.time),
        runtime: `#${call.runtime.number}`,
        direction: directionLabels[record.direction],
        module: record.module,
        method: record.method,
        arguments: shortened(record.args),
        outcome: (update !== null) ? `${update.status} ${shortened(update.result)}` : "pending",
        ms: (update !== null) ? String(update.ms) : missing,
    };
}

function fullCall(call: Call): unknown {
    const { record, update } = call;
    return {
        direction: directionLabels[record.direction],
        module: record.module,
        method: record.method,
        time: new Date(record.time).toISOString(),
        arguments: parsed(record.args),
        status: update?.status ?? "pending",
        result: (update !== null) ? parsed(update.result) : null,
        ms: update?.ms ?? null,
    };
}

function parsed(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch (e) {
        return text;
    }
}

function shortened(text: string): string {
    return (text.length > ARGUMENTS_SHOWN) ? `${text.slice(0, ARGUMENTS_SHOWN)}…` : text;
}

function formattedTime(timestamp: number): string {
    const time = new Date(timestamp);
    const clock = [time.getHours(), time.getMinutes(), time.getSeconds()].map(part => String(part).padStart(2, "0")).join(":");
    return `${clock}.${String(time.getMilliseconds()).padStart(3, "0")}`;
}
