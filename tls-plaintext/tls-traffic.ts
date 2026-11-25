import { Connection } from "./connection.js";
import { readHttp1StartLine } from "./http1-start-line.js";
import type { PayloadCapture } from "./payload-capture.js";
import type { Direction, LibraryReport, TlsLibrary, TlsTrafficObserver } from "./tls-libraries.js";
import type { TrafficView } from "./traffic-view.js";

export class TlsTraffic implements TlsTrafficObserver {
    readonly #view: TrafficView;
    readonly #capture: PayloadCapture;
    readonly #connections = new Map<string, Connection>();
    #nextConnectionId = 1;

    constructor(view: TrafficView, capture: PayloadCapture) {
        this.#view = view;
        this.#capture = capture;
    }

    onHandshake(session: NativePointer, library: TlsLibrary): void {
        this.#view.showConnection(this.#connectionFor(session, library));
    }

    onData(session: NativePointer, library: TlsLibrary, direction: Direction, data: NativePointer, length: number): void {
        const connection = this.#connectionFor(session, library);
        const startLine = readHttp1StartLine(direction, data, length);
        connection.record(direction, length, startLine);
        this.#capture.take(connection, direction, data, length, startLine);
        this.#view.count(connection, direction, length);
    }

    onFree(session: NativePointer): void {
        this.#connections.delete(session.toString());
    }

    onLibrary(report: LibraryReport): void {
        this.#view.showLibrary(report);
    }

    #connectionFor(session: NativePointer, library: TlsLibrary): Connection {
        const key = session.toString();
        const known = this.#connections.get(key);
        if (known !== undefined) {
            known.refresh();
            return known;
        }
        const connection = new Connection(String(this.#nextConnectionId++), session, library);
        this.#connections.set(key, connection);
        return connection;
    }
}
