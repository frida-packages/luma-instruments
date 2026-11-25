import type { Http1StartLine } from "./http1-start-line.js";
import type { Direction, SessionDetails, TlsLibrary } from "./tls-libraries.js";

export class Connection {
    readonly id: string;
    details: SessionDetails;
    sent = 0;
    received = 0;
    request: string | null = null;
    status: number | null = null;
    lastActive = Date.now();

    readonly #session: NativePointer;
    readonly #library: TlsLibrary;

    constructor(id: string, session: NativePointer, library: TlsLibrary) {
        this.id = id;
        this.details = library.describe(session);
        this.#session = session;
        this.#library = library;
    }

    get libraryName(): string {
        return this.#library.name;
    }

    get label(): string {
        return this.details.serverName ?? this.details.peer ?? "";
    }

    refresh(): void {
        if (!this.details.complete) {
            this.details = this.#library.describe(this.#session);
        }
    }

    record(direction: Direction, length: number, startLine: Http1StartLine | null): void {
        if (direction === "sent") {
            this.sent += length;
        } else {
            this.received += length;
        }
        this.lastActive = Date.now();

        switch (startLine?.kind) {
            case "request":
                this.request = `${startLine.method} ${startLine.path}`;
                this.status = null;
                break;
            case "response":
                this.status = startLine.status;
                break;
        }
    }
}
