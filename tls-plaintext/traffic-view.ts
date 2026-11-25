import type { Connection } from "./connection.js";
import type { Direction, LibraryReport } from "./tls-libraries.js";

const flushDelay = 250;
const payloadViewLimit = 65536;
const missing = "—";

interface PayloadRun {
    connection: Connection;
    direction: Direction;
    chunks: ArrayBuffer[];
    byteLength: number;
}

export class TrafficView {
    readonly #librariesTable: CustomInstrumentWidgetMap["libraries"];
    readonly #connectionsTable: CustomInstrumentWidgetMap["connections"];
    readonly #sentCounter: CustomInstrumentWidgetMap["sent"];
    readonly #receivedCounter: CustomInstrumentWidgetMap["received"];
    readonly #payloadHex: CustomInstrumentWidgetMap["payload"];
    readonly #changedConnections = new Set<Connection>();
    #totalSent = 0;
    #totalReceived = 0;
    #latestPayload: PayloadRun | null = null;
    #payloadChanged = false;
    #pendingFlush: ReturnType<typeof setTimeout> | null = null;

    constructor(ctx: CustomInstrumentContext) {
        this.#librariesTable = ctx.widget("libraries");
        this.#connectionsTable = ctx.widget("connections");
        this.#sentCounter = ctx.widget("sent");
        this.#receivedCounter = ctx.widget("received");
        this.#payloadHex = ctx.widget("payload");
        this.#showTotals();
    }

    showLibrary(report: LibraryReport): void {
        this.#librariesTable.upsertRow({ id: report.module, cells: { ...report } });
    }

    showConnection(connection: Connection): void {
        this.#changedConnections.add(connection);
        this.#scheduleFlush();
    }

    count(connection: Connection, direction: Direction, length: number): void {
        if (direction === "sent") {
            this.#totalSent += length;
        } else {
            this.#totalReceived += length;
        }
        this.showConnection(connection);
    }

    showPayload(connection: Connection, direction: Direction, bytes: ArrayBuffer): void {
        const run = this.#latestPayload;
        if (run !== null && continuesRun(run, connection, direction, bytes)) {
            run.chunks.push(bytes);
            run.byteLength += bytes.byteLength;
        } else {
            this.#latestPayload = { connection, direction, chunks: [bytes], byteLength: bytes.byteLength };
        }
        this.#payloadChanged = true;
        this.#scheduleFlush();
    }

    clearSent(): void {
        this.#totalSent = 0;
        this.#showTotals();
    }

    clearReceived(): void {
        this.#totalReceived = 0;
        this.#showTotals();
    }

    clearConnections(): void {
        this.#changedConnections.clear();
        this.#connectionsTable.clear();
    }

    dispose(): void {
        if (this.#pendingFlush !== null) {
            clearTimeout(this.#pendingFlush);
            this.#flush();
        }
    }

    #showTotals(): void {
        this.#sentCounter.setCounter(scaledByteCount(this.#totalSent));
        this.#receivedCounter.setCounter(scaledByteCount(this.#totalReceived));
    }

    #scheduleFlush(): void {
        if (this.#pendingFlush === null) {
            this.#pendingFlush = setTimeout(() => this.#flush(), flushDelay);
        }
    }

    #flush(): void {
        this.#pendingFlush = null;
        for (const connection of this.#changedConnections) {
            this.#connectionsTable.upsertRow({ id: connection.id, cells: connectionCells(connection) });
        }
        this.#changedConnections.clear();
        this.#showTotals();
        if (this.#payloadChanged) {
            this.#payloadHex.setHex({ bytes: joinedBytes(this.#latestPayload!) });
            this.#payloadChanged = false;
        }
    }
}

function continuesRun(run: PayloadRun, connection: Connection, direction: Direction, bytes: ArrayBuffer): boolean {
    return run.connection === connection && run.direction === direction && run.byteLength + bytes.byteLength <= payloadViewLimit;
}

function connectionCells(connection: Connection) {
    const { serverName, peer, cipher } = connection.details;
    return {
        host: serverName ?? missing,
        peer: peer ?? missing,
        library: connection.libraryName,
        protocol: protocolSummary(connection),
        cipher: cipher ?? missing,
        sent: formattedByteCount(connection.sent),
        received: formattedByteCount(connection.received),
        request: requestSummary(connection),
        active: formattedTime(connection.lastActive),
    };
}

function protocolSummary(connection: Connection): string {
    const { version, alpn } = connection.details;
    return [version ?? missing, alpn].filter(part => part !== null).join(" · ");
}

function formattedByteCount(byteCount: number): string {
    const { value, unit } = scaledByteCount(byteCount);
    return `${value} ${unit}`;
}

function requestSummary(connection: Connection): string {
    const { request, status } = connection;
    if (request === null) {
        return status !== null ? String(status) : "";
    }
    return status !== null ? `${request} → ${status}` : request;
}

function formattedTime(timestamp: number): string {
    const time = new Date(timestamp);
    return [time.getHours(), time.getMinutes(), time.getSeconds()].map(part => String(part).padStart(2, "0")).join(":");
}

function joinedBytes(run: PayloadRun): ArrayBuffer {
    const joined = new Uint8Array(run.byteLength);
    let offset = 0;
    for (const chunk of run.chunks) {
        joined.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
    }
    return joined.buffer;
}

const byteUnits = ["B", "KiB", "MiB", "GiB", "TiB"];

function scaledByteCount(byteCount: number): { value: number; unit: string } {
    let value = byteCount;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < byteUnits.length - 1) {
        value /= 1024;
        unitIndex++;
    }
    return { value: unitIndex === 0 ? value : Math.round(value * 10) / 10, unit: byteUnits[unitIndex] };
}
