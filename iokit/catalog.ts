import { describeEntry, drain, entryFacts, type EntryFacts, iokit, isUserClient, MAIN_PORT, servicePlane, stringProperty, SUCCESS } from "./iokit.js";

export interface CatalogEntry extends EntryFacts {
    userClients: string[];
    clients: number;
}

interface Gathered {
    facts: EntryFacts;
    userClients: Set<string>;
    clients: number;
}

type ServiceTable = CustomInstrumentWidgetMap["services"];

const ITERATE_RECURSIVELY = 1;

interface Scan {
    entries: CatalogEntry[];
    providers: Map<string, EntryFacts>;
}

export class ServiceCatalog {
    readonly #table: ServiceTable;
    #entries: CatalogEntry[] = [];
    #providers = new Map<string, EntryFacts>();
    readonly #unknown = new Set<string>();

    constructor(table: ServiceTable) {
        this.#table = table;
    }

    entries(): CatalogEntry[] {
        return this.#entries;
    }

    providerOf(userClientId: string): EntryFacts | null {
        if (!this.#providers.has(userClientId) && !this.#unknown.has(userClientId)) {
            this.scan();
        }
        const provider = this.#providers.get(userClientId) ?? null;
        if (provider === null) {
            this.#unknown.add(userClientId);
        }
        return provider;
    }

    scan(): void {
        ({ entries: this.#entries, providers: this.#providers } = scanRegistry());
        this.#unknown.clear();
        this.#table.clear();
        for (const entry of this.#entries) {
            this.#table.upsertRow({
                id: entry.id,
                cells: {
                    entryId: entry.id,
                    service: describeEntry(entry),
                    userClients: entry.userClients.join(", "),
                    clients: String(entry.clients),
                },
            });
        }
    }
}

function scanRegistry(): Scan {
    const services = new Map<string, Gathered>();
    const providers = new Map<string, EntryFacts>();
    for (const entry of everyService()) {
        if (isUserClient(entry)) {
            noteUserClient(services, providers, entry);
        } else {
            const declared = stringProperty(entry, "IOUserClientClass");
            if (declared !== null) {
                gathered(services, entryFacts(entry)).userClients.add(declared);
            }
        }
        iokit.objectRelease(entry);
    }
    return {
        entries: Array.from(services.values(), ({ facts, userClients, clients }) => ({ ...facts, userClients: Array.from(userClients), clients })),
        providers,
    };
}

function everyService(): number[] {
    const iterator = Memory.alloc(4);
    iokit.registryCreateIterator(MAIN_PORT, servicePlane, ITERATE_RECURSIVELY, iterator);
    return drain(iterator.readU32());
}

function noteUserClient(services: Map<string, Gathered>, providers: Map<string, EntryFacts>, userClient: number): void {
    const provider = Memory.alloc(4);
    if (iokit.registryEntryGetParentEntry(userClient, servicePlane, provider) !== SUCCESS) {
        return;
    }
    const service = provider.readU32();
    const facts = entryFacts(service);
    const client = entryFacts(userClient);
    const entry = gathered(services, facts);
    entry.userClients.add(client.className);
    entry.clients++;
    providers.set(client.id, facts);
    iokit.objectRelease(service);
}

function gathered(services: Map<string, Gathered>, facts: EntryFacts): Gathered {
    let entry = services.get(facts.id);
    if (entry === undefined) {
        entry = { facts, userClients: new Set(), clients: 0 };
        services.set(facts.id, entry);
    }
    return entry;
}
