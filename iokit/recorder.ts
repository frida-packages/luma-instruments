import { type LookupBoard, lookupBoard, type MethodBoard, methodBoard, type PropertyBoard, propertyBoard } from "./boards.js";
import { clockTime, type Connection, type ConnectionBook, portText } from "./connections.js";
import { describeEntry, resultText, SUCCESS } from "./iokit.js";
import { lengthOf } from "./kept-bytes.js";
import type { RateWindow } from "./rate-window.js";
import type { Settings } from "./settings.js";
import { summarize } from "./summary.js";
import type {
    CallDetail,
    CallObservation,
    CloseObservation,
    LookupObservation,
    MapObservation,
    Observation,
    OpenObservation,
    Payload,
    PropertyObservation,
} from "./tap.js";

export type ActivityEvent = { seq: number } & EventBody;

type EventBody = CallEvent | OtherEvent;

interface OtherEvent {
    kind: "open" | "close" | "map" | "lookup" | "property";
    [field: string]: unknown;
}

export interface CallEvent {
    kind: "call";
    port: number;
    userClient: string;
    service: string;
    selector: number;
    async?: true;
    input: Payload;
    output: Payload;
    outputCapacity: CallDetail["capacity"];
    result: string;
    durationUs: number;
    backtrace?: string[];
}

export type TallyWidget = "methods" | "lookups" | "properties";

const FLUSH_DELAY_MS = 50;
const RECALLABLE_EVENTS = 500;
const VALUE_GIST_LENGTH = 120;

export class Recorder {
    readonly #ctx: CustomInstrumentContext;
    readonly #settings: Settings;
    readonly #rate: RateWindow;
    readonly #connections: ConnectionBook;
    readonly #methods: MethodBoard;
    readonly #lookups: LookupBoard;
    readonly #properties: PropertyBoard;
    #queue: Observation[] = [];
    #flushTimer: ReturnType<typeof setTimeout> | null = null;
    #reportTimer: ReturnType<typeof setTimeout> | null = null;
    #nextSeq = 1;
    readonly #recallable = new Map<number, ActivityEvent>();

    constructor(ctx: CustomInstrumentContext, settings: Settings, rate: RateWindow, connections: ConnectionBook,
            restored: CustomInstrumentRestoredState) {
        this.#ctx = ctx;
        this.#settings = settings;
        this.#rate = rate;
        this.#connections = connections;
        this.#methods = methodBoard(ctx.widget("methods"), restored.methods);
        this.#lookups = lookupBoard(ctx.widget("lookups"), restored.lookups);
        this.#properties = propertyBoard(ctx.widget("properties"), restored.properties);
    }

    announce(existing: number): void {
        this.#ctx.widget("log").appendOutput(`Found ${counted(existing, "connection")} the process already held.`);
        this.#scheduleFlush();
    }

    record(observation: Observation): void {
        this.#queue.push(observation);
        this.#scheduleFlush();
    }

    publishSoon(): void {
        this.#scheduleFlush();
    }

    recall(seq: number): ActivityEvent | undefined {
        return this.#recallable.get(seq);
    }

    clear(widget: TallyWidget): void {
        const boards = { methods: this.#methods, lookups: this.#lookups, properties: this.#properties };
        boards[widget].clear();
    }

    clearLog(): void {
        this.#ctx.widget("log").clear();
        this.#recallable.clear();
    }

    discard(): void {
        if (this.#flushTimer !== null) {
            clearTimeout(this.#flushTimer);
            this.#flushTimer = null;
        }
        if (this.#reportTimer !== null) {
            clearTimeout(this.#reportTimer);
            this.#reportTimer = null;
        }
        this.#queue = [];
    }

    #scheduleFlush(): void {
        if (this.#flushTimer === null) {
            this.#flushTimer = setTimeout(() => this.#flush(), FLUSH_DELAY_MS);
        }
    }

    #flush(): void {
        this.#flushTimer = null;
        const observations = this.#queue;
        this.#queue = [];
        for (const observation of observations) {
            this.#tally(observation);
            if (observation.kind !== "call" || observation.detail !== null) {
                this.#show(observation);
            }
        }
        this.#connections.publish();
        this.#methods.publish();
        this.#lookups.publish();
        this.#properties.publish();
        this.#reportUnshown();
    }

    #tally(observation: Observation): void {
        switch (observation.kind) {
            case "call":
                this.#tallyCall(observation);
                break;
            case "lookup":
                this.#tallyLookup(observation);
                break;
            case "property":
                this.#tallyProperty(observation);
                break;
            default:
                break;
        }
    }

    #tallyCall(call: CallObservation): void {
        const { connection, selector } = call;
        this.#connections.counted(connection);
        const row = this.#methods.row(`${connection.userClient}#${selector}`,
            () => ({ userClient: connection.userClient, selector, calls: 0, errors: 0, totalUs: 0, last: "" }));
        row.calls++;
        if (call.result !== SUCCESS) {
            row.errors++;
        }
        row.totalUs += call.durationNs / 1000;
        row.last = outcomeText(call);
    }

    #tallyLookup({ via, text, result }: LookupObservation): void {
        const row = this.#lookups.row(`${via}\u0000${text}`, () => ({ matching: text, via, times: 0, result }));
        row.times++;
        row.result = result;
    }

    #tallyProperty({ entry, key, value }: PropertyObservation): void {
        const row = this.#properties.row(`${entry.className}\u0000${key}`, () => ({ entry: entry.className, key, times: 0, value: "" }));
        row.times++;
        row.value = valueGist(value);
    }

    #show(observation: Observation): void {
        const seq = this.#nextSeq++;
        const event = eventOf(observation, seq);
        this.#ctx.emit(event);
        this.#ctx.widget("log").appendOutput(`#${seq} ${clockTime(observation.time)} ${logLineOf(observation)}`);
        this.#recallable.set(seq, event);
        if (this.#recallable.size > RECALLABLE_EVENTS) {
            this.#recallable.delete(this.#recallable.keys().next().value!);
        }
    }

    #reportUnshown(): void {
        const unshown = this.#rate.takeUnreported();
        if (unshown !== 0) {
            this.#ctx.widget("log").appendOutput(
                `${counted(unshown, "call")} over the ${this.#settings.callsPerSecond} shown per second only counted.`);
        }
        if (this.#rate.pending && this.#reportTimer === null) {
            this.#reportTimer = setTimeout(() => this.#closeWindow(), Math.max(this.#rate.endsAt - Date.now(), 0));
        }
    }

    #closeWindow(): void {
        this.#reportTimer = null;
        this.#rate.closeIfOver(Date.now());
        this.#reportUnshown();
    }
}

function eventOf(observation: Observation, seq: number): ActivityEvent {
    const backtrace = (observation.backtrace !== undefined) ? { backtrace: observation.backtrace.map(symbolicate) } : {};
    switch (observation.kind) {
        case "call":
            return { seq, ...callEventOf(observation), ...backtrace };
        case "open":
            return { seq, ...openEventOf(observation), ...backtrace };
        case "close":
            return { seq, kind: "close", ...connectionFields(observation.connection), ...backtrace };
        case "map":
            return { seq, ...mapEventOf(observation), ...backtrace };
        case "lookup":
            return { seq, kind: "lookup", via: observation.via, matching: observation.matching, result: observation.result, ...backtrace };
        case "property":
            return { seq, ...propertyEventOf(observation), ...backtrace };
    }
}

function callEventOf(call: CallObservation): CallEvent {
    const detail = call.detail!;
    return {
        kind: "call",
        ...connectionFields(call.connection),
        selector: call.selector,
        ...(call.async ? { async: true } : {}),
        input: detail.input,
        output: detail.output,
        outputCapacity: detail.capacity,
        result: resultText(call.result),
        durationUs: Math.round(call.durationNs / 100) / 10,
    };
}

function openEventOf(open: OpenObservation): OtherEvent {
    return {
        kind: "open",
        service: describeEntry(open.service),
        entryId: open.service.id,
        type: open.type,
        result: resultText(open.result),
        ...((open.connection !== null) ? { port: open.connection.port, userClient: open.connection.userClient } : {}),
    };
}

function mapEventOf(map: MapObservation): OtherEvent {
    return {
        kind: "map",
        ...connectionFields(map.connection),
        memoryType: map.memoryType,
        result: resultText(map.result),
        address: map.address,
        size: map.size,
    };
}

function propertyEventOf(read: PropertyObservation): OtherEvent {
    return {
        kind: "property",
        via: read.via,
        entry: describeEntry(read.entry),
        entryId: read.entry.id,
        key: read.key,
        value: read.value,
    };
}

function connectionFields(connection: Connection): { port: number; userClient: string; service: string } {
    return {
        port: connection.port,
        userClient: connection.userClient,
        service: (connection.service !== null) ? describeEntry(connection.service) : "",
    };
}

function logLineOf(observation: Observation): string {
    switch (observation.kind) {
        case "call":
            return `${connectionText(observation.connection)} ${observation.async ? "async " : ""}${observation.selector}`
                + `${outcomeText(observation)} in ${(observation.durationNs / 1000).toFixed(1)} µs`;
        case "open":
            return openLineOf(observation);
        case "close":
            return `close ${connectionText(observation.connection)}`;
        case "map":
            return mapLineOf(observation);
        case "lookup":
            return `${observation.via} ${observation.text} → ${observation.result}`;
        case "property":
            return `${observation.via} ${describeEntry(observation.entry)} ${JSON.stringify(observation.key)} = ${valueGist(observation.value)}`;
    }
}

function openLineOf({ service, type, result, connection }: OpenObservation): string {
    const outcome = (connection !== null) ? connectionText(connection) : resultText(result);
    return `open ${describeEntry(service)} type ${type} → ${outcome}`;
}

function mapLineOf({ connection, memoryType, result, address, size }: MapObservation): string {
    const outcome = (result === SUCCESS) ? `${size} B at ${address}` : resultText(result);
    return `map ${connectionText(connection)} type ${memoryType} → ${outcome}`;
}

function connectionText(connection: Connection): string {
    return `${connection.userClient} ${portText(connection.port)}`;
}

function outcomeText({ detail, result }: CallObservation): string {
    const input = (detail !== null) ? payloadText(detail.input) : "";
    if (result !== SUCCESS) {
        return `${input} → ${resultText(result)}`;
    }
    return (detail !== null) ? `${input} → ${payloadText(detail.output)}` : " → success";
}

function payloadText({ scalars, struct }: Payload): string {
    const parts = scalars.map(scalar => `0x${scalar.toString(16)}`);
    const length = lengthOf(struct);
    if (length !== 0) {
        parts.push(`${length} B`);
    }
    return `(${parts.join(", ")})`;
}

function valueGist(value: unknown): string {
    return (value === undefined) ? "absent" : summarize(value, VALUE_GIST_LENGTH);
}

function counted(count: number, noun: string): string {
    return `${count} ${noun}${(count === 1) ? "" : "s"}`;
}

function symbolicate(address: NativePointer): string {
    return DebugSymbol.fromAddress(address).toString();
}
