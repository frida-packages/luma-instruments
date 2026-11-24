import type { Connection } from "./connection.js";
import type { Http1StartLine } from "./http1-start-line.js";
import type { Direction } from "./tls-libraries.js";
import type { TrafficView } from "./traffic-view.js";

export class PayloadCapture {
    readonly #ctx: CustomInstrumentContext;
    readonly #view: TrafficView;
    #enabled = true;
    #hostPattern: RegExp | null = null;
    #chunkLimit = 0;

    constructor(ctx: CustomInstrumentContext, view: TrafficView, settings: CustomInstrumentSettingMap) {
        this.#ctx = ctx;
        this.#view = view;
        this.configure(settings);
    }

    configure(settings: CustomInstrumentSettingMap): void {
        this.#enabled = settings.capturePayloads;
        this.#hostPattern = settings.hostPattern !== undefined ? new RegExp(settings.hostPattern, "i") : null;
        this.#chunkLimit = settings.chunkLimit;
    }

    take(connection: Connection, direction: Direction, data: NativePointer, length: number, startLine: Http1StartLine | null): void {
        if (!this.#enabled || !this.#covers(connection)) {
            return;
        }
        const bytes = data.readByteArray(Math.min(length, this.#chunkLimit))!;
        this.#ctx.emit(chunkEvent(connection, direction, startLine, length, bytes));
        this.#view.showPayload(connection, direction, bytes);
    }

    #covers(connection: Connection): boolean {
        return this.#hostPattern === null || this.#hostPattern.test(connection.label);
    }
}

function chunkEvent(
    connection: Connection,
    direction: Direction,
    startLine: Http1StartLine | null,
    length: number,
    bytes: ArrayBuffer,
): { [field: string]: unknown } {
    const { serverName, peer } = connection.details;
    return {
        direction,
        ...(serverName !== null ? { host: serverName } : {}),
        ...(peer !== null ? { peer } : {}),
        ...startLineFields(startLine),
        length,
        data: bytes,
    };
}

function startLineFields(startLine: Http1StartLine | null): { [field: string]: unknown } {
    switch (startLine?.kind) {
        case "request":
            return { method: startLine.method, path: startLine.path };
        case "response":
            return { status: startLine.status };
        default:
            return {};
    }
}
