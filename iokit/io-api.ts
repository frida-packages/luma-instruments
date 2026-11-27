import type { ServiceCatalog } from "./catalog.js";
import { cf, createString, toJavaScript } from "./cf.js";
import type { Connection, ConnectionBook } from "./connections.js";
import {
    childrenOf,
    describeEntry,
    drain,
    type EntryFacts,
    entryFacts,
    iokit,
    MAIN_PORT,
    PATH_SIZE,
    resultText,
    servicePlane,
    SUCCESS,
    taskSelf,
} from "./iokit.js";
import { isTruncatedData } from "./kept-bytes.js";
import type { ActivityEvent } from "./recorder.js";
import { type Scalar, scalarOf } from "./tap.js";

export interface CallArguments {
    scalars?: ScalarInput[];
    struct?: StructInput;
    outputScalars?: number;
    outputStruct?: number;
}

export type ScalarInput = number | UInt64 | Int64 | string;
export type StructInput = ArrayBuffer | ArrayBufferView | number[];

export interface CallResult {
    result: string;
    scalars: Scalar[];
    struct: ArrayBuffer;
}

export interface ProbeRun {
    selectors: string;
    result: string;
}

export interface Mapping {
    address: NativePointer;
    size: number;
}

const PROPERTY_DATA_LIMIT = 4096;
const MAP_ANYWHERE = 1;

export class IOApi {
    readonly #connections: ConnectionBook;
    readonly #catalog: ServiceCatalog;
    readonly #recall: (seq: number) => ActivityEvent | undefined;
    readonly #changed: () => void;
    readonly #opened = new Set<number>();

    constructor(connections: ConnectionBook, catalog: ServiceCatalog, recall: (seq: number) => ActivityEvent | undefined,
            changed: () => void) {
        this.#connections = connections;
        this.#catalog = catalog;
        this.#recall = recall;
        this.#changed = changed;
    }

    find(className: string): IOEntry[] {
        return this.#matching(iokit.serviceMatching(Memory.allocUtf8String(className)));
    }

    named(name: string): IOEntry[] {
        return this.#matching(iokit.serviceNameMatching(Memory.allocUtf8String(name)));
    }

    entry(id: number | string | UInt64): IOEntry {
        const port = iokit.serviceGetMatchingService(MAIN_PORT, iokit.registryEntryIDMatching(uint64(id.toString())));
        if (port === 0) {
            throw new Error(`No service has the registry entry ID ${id}`);
        }
        return new IOEntry(this, port);
    }

    path(path: string): IOEntry {
        const port = iokit.registryEntryFromPath(MAIN_PORT, Memory.allocUtf8String(path));
        if (port === 0) {
            throw new Error(`No registry entry is at ${path}`);
        }
        return new IOEntry(this, port);
    }

    get root(): IOEntry {
        return new IOEntry(this, iokit.registryGetRootEntry(MAIN_PORT));
    }

    openable(pattern: string | RegExp = /./): IOEntry[] {
        const regex = new RegExp(pattern);
        return this.#catalog.entries()
            .filter(entry => regex.test(entry.className) || entry.userClients.some(userClient => regex.test(userClient)))
            .map(entry => this.entry(entry.id));
    }

    get connections(): IOConnection[] {
        return this.#connections.all().map(connection => new IOConnection(this, connection));
    }

    connection(port: number): IOConnection {
        const connection = new IOConnection(this, this.#connections.resolve(port));
        this.#changed();
        return connection;
    }

    replay(seq: number): CallResult {
        const event = this.#recall(seq);
        if (event?.kind !== "call") {
            throw new Error(`#${seq} is not a call among the recent ones`);
        }
        if (event.async === true) {
            throw new Error(`#${seq} is an asynchronous call; only synchronous ones can be replayed`);
        }
        const { struct } = event.input;
        if (isTruncatedData(struct)) {
            throw new Error(`#${seq}'s input struct was kept as ${struct.bytes.byteLength} of its ${struct.length} bytes; `
                + "raise “Bytes kept per struct or data value” to replay calls like it");
        }
        return this.connection(event.port).call(event.selector, {
            scalars: event.input.scalars,
            struct,
            outputScalars: event.outputCapacity.scalars,
            outputStruct: event.outputCapacity.struct,
        });
    }

    open(entry: IOEntry, type: number): IOConnection {
        const found = Memory.alloc(4);
        const result = iokit.serviceOpen(entry.port, taskSelf, type, found);
        if (result !== SUCCESS) {
            throw new Error(`Opening ${describeEntry(entry.facts)} with type ${type} failed: ${resultText(result)}`);
        }
        const port = found.readU32();
        this.#opened.add(port);
        const connection = this.#connections.opened(port, entry.port, type, "explorer", Date.now());
        this.#changed();
        return new IOConnection(this, connection);
    }

    close(connection: IOConnection): void {
        iokit.serviceClose(connection.port);
        this.#opened.delete(connection.port);
        this.#connections.closed(connection.port);
        this.#changed();
    }

    closeAll(): void {
        for (const port of this.#opened) {
            iokit.serviceClose(port);
        }
        this.#opened.clear();
    }

    #matching(dictionary: NativePointer): IOEntry[] {
        const iterator = Memory.alloc(4);
        iokit.serviceGetMatchingServices(MAIN_PORT, dictionary, iterator);
        return drain(iterator.readU32()).map(port => new IOEntry(this, port));
    }
}

export class IOEntry {
    readonly port: number;
    readonly facts: EntryFacts;
    readonly #api: IOApi;

    constructor(api: IOApi, port: number) {
        this.port = port;
        this.facts = entryFacts(port);
        this.#api = api;
        Script.bindWeak(this, () => iokit.objectRelease(port));
    }

    get className(): string {
        return this.facts.className;
    }

    get name(): string {
        return this.facts.name;
    }

    get id(): string {
        return this.facts.id;
    }

    get path(): string | null {
        const path = Memory.alloc(PATH_SIZE);
        return (iokit.registryEntryGetPath(this.port, servicePlane, path) === SUCCESS) ? path.readUtf8String() : null;
    }

    properties(): unknown {
        const found = Memory.alloc(Process.pointerSize);
        const result = iokit.registryEntryCreateCFProperties(this.port, found, NULL, 0);
        if (result !== SUCCESS) {
            throw new Error(`Reading the properties of ${describeEntry(this.facts)} failed: ${resultText(result)}`);
        }
        return taken(found.readPointer());
    }

    property(key: string): unknown {
        const name = createString(key);
        const value = iokit.registryEntryCreateCFProperty(this.port, name, NULL, 0);
        cf.release(name);
        return value.isNull() ? undefined : taken(value);
    }

    children(): IOEntry[] {
        return childrenOf(this.port).map(port => new IOEntry(this.#api, port));
    }

    parent(): IOEntry | null {
        const found = Memory.alloc(4);
        return (iokit.registryEntryGetParentEntry(this.port, servicePlane, found) === SUCCESS)
            ? new IOEntry(this.#api, found.readU32())
            : null;
    }

    open(type = 0): IOConnection {
        return this.#api.open(this, type);
    }

    describe(): Record<string, unknown> {
        return { entry: describeEntry(this.facts), id: this.id, path: this.path };
    }
}

export class IOConnection {
    readonly #api: IOApi;
    readonly #connection: Connection;

    constructor(api: IOApi, connection: Connection) {
        this.#api = api;
        this.#connection = connection;
    }

    get port(): number {
        return this.#connection.port;
    }

    get userClient(): string {
        return this.#connection.userClient;
    }

    call(selector: number, args: CallArguments = {}): CallResult {
        return callMethod(this.port, selector, args);
    }

    probe(first = 0, last = 63): ProbeRun[] {
        const runs: { first: number; last: number; result: string }[] = [];
        for (let selector = first; selector <= last; selector++) {
            const { result } = callMethod(this.port, selector, {});
            const run = runs.at(-1);
            if (run?.result === result) {
                run.last = selector;
            } else {
                runs.push({ first: selector, last: selector, result });
            }
        }
        return runs.map(run => ({ selectors: (run.first === run.last) ? String(run.first) : `${run.first}–${run.last}`, result: run.result }));
    }

    map(memoryType: number, options = MAP_ANYWHERE): Mapping {
        const address = Memory.alloc(8);
        const size = Memory.alloc(8);
        const result = iokit.connectMapMemory(this.port, memoryType, taskSelf, address, size, options);
        if (result !== SUCCESS) {
            throw new Error(`Mapping memory type ${memoryType} of ${this.userClient} failed: ${resultText(result)}`);
        }
        return { address: address.readPointer(), size: size.readU64().toNumber() };
    }

    close(): void {
        this.#api.close(this);
    }

    describe(): Record<string, unknown> {
        const { service } = this.#connection;
        return {
            connection: `${this.userClient} 0x${this.port.toString(16)}`,
            port: this.port,
            ...((service !== null) ? { service: describeEntry(service), entryId: service.id } : {}),
        };
    }
}

function callMethod(port: number, selector: number, args: CallArguments): CallResult {
    const scalars = args.scalars ?? [];
    const input = Memory.alloc(Math.max(scalars.length, 1) * 8);
    scalars.forEach((scalar, index) => writeScalar(input.add(index * 8), scalar));
    const struct = bytesOf(args.struct ?? []);
    const inputStruct = Memory.alloc(Math.max(struct.byteLength, 1));
    inputStruct.writeByteArray(struct);
    const outputScalars = args.outputScalars ?? 0;
    const output = Memory.alloc(Math.max(outputScalars, 1) * 8);
    const outputCount = Memory.alloc(4).writeU32(outputScalars);
    const outputStructSize = args.outputStruct ?? 0;
    const outputStruct = Memory.alloc(Math.max(outputStructSize, 1));
    const outputStructCount = Memory.alloc(8).writeU64(outputStructSize);
    const result = iokit.connectCallMethod(port, selector, input, scalars.length, inputStruct, struct.byteLength,
        output, outputCount, outputStruct, outputStructCount);
    const returned = (result === SUCCESS) ? outputCount.readU32() : 0;
    const returnedSize = (result === SUCCESS) ? outputStructCount.readU64().toNumber() : 0;
    return {
        result: resultText(result),
        scalars: Array.from({ length: returned }, (_, index) => scalarOf(output.add(index * 8).readU64())),
        struct: (returnedSize === 0) ? new ArrayBuffer(0) : outputStruct.readByteArray(returnedSize)!,
    };
}

function writeScalar(address: NativePointer, scalar: ScalarInput): void {
    if (scalar instanceof Int64 || (typeof scalar === "number" && scalar < 0)) {
        address.writeS64(scalar);
    } else {
        address.writeU64((typeof scalar === "string") ? uint64(scalar) : scalar);
    }
}

function bytesOf(struct: StructInput): ArrayBuffer {
    if (struct instanceof ArrayBuffer) {
        return struct;
    }
    if (ArrayBuffer.isView(struct)) {
        return struct.buffer.slice(struct.byteOffset, struct.byteOffset + struct.byteLength) as ArrayBuffer;
    }
    return new Uint8Array(struct).buffer;
}

function taken(object: NativePointer): unknown {
    const value = toJavaScript(object, PROPERTY_DATA_LIMIT);
    cf.release(object);
    return value;
}
