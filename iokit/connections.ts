import { describeEntry, type EntryFacts, entryFacts, portsWithSendRights, userClientOfPort } from "./iokit.js";

export type Origin = "process" | "before" | "explorer";

export interface Connection {
    port: number;
    userClient: string;
    service: EntryFacts | null;
    type: number | null;
    origin: Origin;
    openedAt: number | null;
    calls: number;
}

type ConnectionTable = CustomInstrumentWidgetMap["connections"];
type ProviderLookup = (userClientId: string) => EntryFacts | null;

const NOT_A_USER_CLIENT = "(not a user client)";

export class ConnectionBook {
    readonly #table: ConnectionTable;
    readonly #providerOf: ProviderLookup;
    readonly #connections = new Map<number, Connection>();
    readonly #changed = new Set<number>();
    readonly #removed = new Set<number>();

    constructor(table: ConnectionTable, providerOf: ProviderLookup) {
        this.#table = table;
        this.#providerOf = providerOf;
    }

    adoptExisting(): number {
        let adopted = 0;
        for (const port of portsWithSendRights()) {
            const userClient = userClientOfPort(port);
            if (userClient !== null && !this.#connections.has(port) && this.#providerOf(userClient.id) !== null) {
                this.resolve(port);
                adopted++;
            }
        }
        return adopted;
    }

    resolve(port: number): Connection {
        const known = this.#connections.get(port);
        if (known !== undefined) {
            return known;
        }
        const userClient = userClientOfPort(port);
        return this.#adopt({
            port,
            userClient: userClient?.className ?? NOT_A_USER_CLIENT,
            service: (userClient !== null) ? this.#providerOf(userClient.id) : null,
            type: null,
            origin: "before",
            openedAt: null,
            calls: 0,
        });
    }

    opened(port: number, service: number, type: number, origin: Origin, time: number): Connection {
        return this.#adopt({
            port,
            userClient: userClientOfPort(port)?.className ?? NOT_A_USER_CLIENT,
            service: entryFacts(service),
            type,
            origin,
            openedAt: time,
            calls: 0,
        });
    }

    closed(port: number): Connection {
        const connection = this.resolve(port);
        this.#connections.delete(port);
        this.#changed.delete(port);
        this.#removed.add(port);
        return connection;
    }

    counted(connection: Connection): void {
        connection.calls++;
        this.#changed.add(connection.port);
    }

    all(): Connection[] {
        return Array.from(this.#connections.values());
    }

    publish(): void {
        for (const port of this.#removed) {
            this.#table.removeRow(String(port));
        }
        this.#removed.clear();
        for (const port of this.#changed) {
            const connection = this.#connections.get(port)!;
            this.#table.upsertRow({
                id: String(port),
                cells: {
                    port: portText(port),
                    userClient: connection.userClient,
                    service: (connection.service !== null) ? describeEntry(connection.service) : "",
                    type: (connection.type !== null) ? String(connection.type) : "",
                    opened: openedText(connection),
                    calls: String(connection.calls),
                },
            });
        }
        this.#changed.clear();
    }

    #adopt(connection: Connection): Connection {
        this.#connections.set(connection.port, connection);
        this.#removed.delete(connection.port);
        this.#changed.add(connection.port);
        return connection;
    }
}

export function portText(port: number): string {
    return `0x${port.toString(16)}`;
}

export function clockTime(time: number): string {
    const date = new Date(time);
    return `${date.toTimeString().slice(0, 8)}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function openedText(connection: Connection): string {
    switch (connection.origin) {
        case "before":
            return "before Luma attached";
        case "explorer":
            return `${clockTime(connection.openedAt!)} by the explorer`;
        case "process":
            return clockTime(connection.openedAt!);
    }
}
