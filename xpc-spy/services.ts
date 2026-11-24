import type { MessageEvent } from "./recorder.js";

type ServiceTable = CustomInstrumentWidgetMap["services"];
type ServiceSnapshot = CustomInstrumentRestoredState["services"];

interface ServiceRow {
    peer: string;
    sent: number;
    received: number;
    seen: string;
    last: string;
}

export class ServiceBoard {
    readonly #table: ServiceTable;
    readonly #rows = new Map<string, ServiceRow>();
    readonly #changed = new Set<string>();

    constructor(table: ServiceTable, restored: ServiceSnapshot) {
        this.#table = table;
        for (const { id, cells } of restored.rows) {
            this.#rows.set(id, {
                peer: cells.peer,
                sent: Number(cells.sent),
                received: Number(cells.received),
                seen: cells.seen,
                last: cells.last,
            });
        }
    }

    note(event: MessageEvent, gist: string, seen: string): void {
        let row = this.#rows.get(event.service);
        if (row === undefined) {
            row = { peer: "", sent: 0, received: 0, seen, last: "" };
            this.#rows.set(event.service, row);
        }
        if (event.direction === "sent") {
            row.sent++;
        } else {
            row.received++;
        }
        if (event.pid !== undefined) {
            row.peer = String(event.pid);
        }
        row.seen = seen;
        row.last = gist;
        this.#changed.add(event.service);
    }

    publish(): void {
        for (const service of this.#changed) {
            const row = this.#rows.get(service)!;
            this.#table.upsertRow({
                id: service,
                cells: {
                    service,
                    peer: row.peer,
                    sent: String(row.sent),
                    received: String(row.received),
                    seen: row.seen,
                    last: row.last,
                },
            });
        }
        this.#changed.clear();
    }

    clear(): void {
        this.#rows.clear();
        this.#changed.clear();
        this.#table.clear();
    }
}
