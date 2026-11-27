import { toJavaScript } from "./cf.js";
import type { Connection, ConnectionBook } from "./connections.js";
import { describeEntry, type EntryFacts, entryFacts, entryPoints, resultText, SUCCESS } from "./iokit.js";
import { type KeptBytes, keepBytes } from "./kept-bytes.js";
import type { RateWindow } from "./rate-window.js";
import type { Settings } from "./settings.js";
import { summarize } from "./summary.js";

export type Observation =
    | CallObservation
    | OpenObservation
    | CloseObservation
    | MapObservation
    | LookupObservation
    | PropertyObservation;

export interface CallObservation extends Moment {
    kind: "call";
    connection: Connection;
    selector: number;
    async: boolean;
    result: number;
    durationNs: number;
    detail: CallDetail | null;
}

export interface CallDetail {
    input: Payload;
    output: Payload;
    capacity: Counts;
}

export interface Payload {
    scalars: Scalar[];
    struct: KeptBytes;
}

export interface Counts {
    scalars: number;
    struct: number;
}

export type Scalar = number | UInt64;

export interface OpenObservation extends Moment {
    kind: "open";
    service: EntryFacts;
    type: number;
    result: number;
    connection: Connection | null;
}

export interface CloseObservation extends Moment {
    kind: "close";
    connection: Connection;
}

export interface MapObservation extends Moment {
    kind: "map";
    connection: Connection;
    memoryType: number;
    result: number;
    address: NativePointer;
    size: number;
}

export interface LookupObservation extends Moment {
    kind: "lookup";
    via: string;
    matching: unknown;
    text: string;
    result: string;
}

export interface PropertyObservation extends Moment {
    kind: "property";
    via: string;
    entry: EntryFacts;
    key: string;
    value: unknown;
}

interface Moment {
    time: number;
    backtrace?: NativePointer[];
}

interface CallShape {
    async: boolean;
    input: number | null;
    inputStruct: number | null;
    output: number | null;
    outputStruct: number | null;
}

interface PendingCall {
    thread: number;
    call: CallInProgress | null;
}

interface CallInProgress {
    connection: Connection;
    selector: number;
    async: boolean;
    time: number;
    input: Payload | null;
    outputs: OutputSlots | null;
    capacity: Counts;
    backtrace?: NativePointer[];
    start: number;
}

type PendingOpen = Omit<OpenObservation, "result" | "connection"> & { servicePort: number; found: NativePointer };
type PendingMap = Omit<MapObservation, "result" | "address" | "size"> & { found: NativePointer; sizeAt: NativePointer };
type PendingLookup = Omit<LookupObservation, "result">;
interface PendingRead {
    thread: number;
    observation: Omit<PropertyObservation, "value"> | null;
}

interface OutputSlots {
    scalars: NativePointer;
    scalarCount: NativePointer;
    struct: NativePointer;
    structSize: NativePointer;
}

const LOOKUP_TEXT_LENGTH = 200;
const CLOCK_UPTIME_RAW = 8;

const uptimeNanoseconds = new NativeFunction(Module.getGlobalExportByName("clock_gettime_nsec_np"), "uint64", ["int"]);

const callShapes: [NativePointer, CallShape][] = [
    [entryPoints.connectCallMethod, { async: false, input: 2, inputStruct: 4, output: 6, outputStruct: 8 }],
    [entryPoints.connectCallAsyncMethod, { async: true, input: 5, inputStruct: 7, output: 9, outputStruct: 11 }],
    [entryPoints.connectCallScalarMethod, { async: false, input: 2, inputStruct: null, output: 4, outputStruct: null }],
    [entryPoints.connectCallStructMethod, { async: false, input: null, inputStruct: 2, output: null, outputStruct: 4 }],
    [entryPoints.connectCallAsyncScalarMethod, { async: true, input: 5, inputStruct: null, output: 7, outputStruct: null }],
    [entryPoints.connectCallAsyncStructMethod, { async: true, input: null, inputStruct: 5, output: null, outputStruct: 7 }],
];

export class IOKitTap {
    readonly #settings: Settings;
    readonly #rate: RateWindow;
    readonly #connections: ConnectionBook;
    readonly #sink: (observation: Observation) => void;
    readonly #agentThread = Process.getCurrentThreadId();
    readonly #listeners: InvocationListener[] = [];
    readonly #callingThreads = new Set<number>();
    readonly #readingThreads = new Set<number>();

    constructor(settings: Settings, rate: RateWindow, connections: ConnectionBook, sink: (observation: Observation) => void) {
        this.#settings = settings;
        this.#rate = rate;
        this.#connections = connections;
        this.#sink = sink;
    }

    start(): void {
        this.#listeners.push(...this.#watchCalls(), ...this.#watchConnections(), ...this.#watchLookups(), ...this.#watchProperties());
    }

    stop(): void {
        for (const listener of this.#listeners) {
            listener.detach();
        }
        this.#listeners.length = 0;
    }

    #watchCalls(): InvocationListener[] {
        const tap = this;
        return callShapes.map(([target, shape]) => Interceptor.attach(target, {
            onEnter(args) {
                this.pending = tap.#beginCall(args, shape, this.context);
            },
            onLeave(retval) {
                if (this.pending !== null) {
                    tap.#endCall(this.pending, retval.toInt32());
                }
            }
        }));
    }

    #beginCall(args: InvocationArguments, shape: CallShape, context: CpuContext): PendingCall | null {
        const thread = Process.getCurrentThreadId();
        if (thread === this.#agentThread || this.#callingThreads.has(thread)) {
            return null;
        }
        this.#callingThreads.add(thread);
        const connection = this.#connections.resolve(args[0].toUInt32());
        if (!this.#wantsConnection(connection)) {
            return { thread, call: null };
        }
        const time = Date.now();
        const detailed = this.#rate.admits(time);
        const outputs = detailed ? outputSlotsOf(args, shape) : null;
        return {
            thread,
            call: {
                connection,
                selector: args[1].toUInt32(),
                async: shape.async,
                time,
                input: detailed ? this.#inputOf(args, shape) : null,
                outputs,
                capacity: (outputs !== null) ? countsOf(outputs) : { scalars: 0, struct: 0 },
                ...this.#backtrace(detailed, context),
                start: uptimeNanoseconds(CLOCK_UPTIME_RAW).toNumber(),
            },
        };
    }

    #inputOf(args: InvocationArguments, { input, inputStruct }: CallShape): Payload {
        const [scalars, scalarCount] = pairAt(args, input);
        const [struct, structSize] = pairAt(args, inputStruct);
        return this.#payload(scalars, scalarCount.toUInt32(), struct, structSize.toUInt32());
    }

    #endCall({ thread, call }: PendingCall, result: number): void {
        this.#callingThreads.delete(thread);
        if (call === null) {
            return;
        }
        const durationNs = uptimeNanoseconds(CLOCK_UPTIME_RAW).toNumber() - call.start;
        this.#sink({
            kind: "call",
            time: call.time,
            connection: call.connection,
            selector: call.selector,
            async: call.async,
            result,
            durationNs,
            detail: (call.input !== null) ? { input: call.input, output: this.#outputOf(call, result), capacity: call.capacity } : null,
            ...((call.backtrace !== undefined) ? { backtrace: call.backtrace } : {}),
        });
    }

    #outputOf({ outputs }: CallInProgress, result: number): Payload {
        if (result !== SUCCESS) {
            return { scalars: [], struct: new ArrayBuffer(0) };
        }
        const slots = outputs!;
        const counts = countsOf(slots);
        return this.#payload(slots.scalars, counts.scalars, slots.struct, counts.struct);
    }

    #payload(scalars: NativePointer, scalarCount: number, struct: NativePointer, structSize: number): Payload {
        return {
            scalars: Array.from({ length: scalarCount }, (_, index) => scalarOf(scalars.add(index * 8).readU64())),
            struct: keepBytes(struct, structSize, this.#settings.dataLimit),
        };
    }

    #watchConnections(): InvocationListener[] {
        const tap = this;
        return [
            Interceptor.attach(entryPoints.serviceOpen, {
                onEnter(args) {
                    this.open = tap.#beginOpen(args, this.context);
                },
                onLeave(retval) {
                    if (this.open !== null) {
                        tap.#endOpen(this.open, retval.toInt32());
                    }
                }
            }),
            Interceptor.attach(entryPoints.serviceClose, {
                onEnter(args) {
                    tap.#noteClose(args[0].toUInt32(), this.context);
                }
            }),
            Interceptor.attach(entryPoints.connectMapMemory, {
                onEnter(args) {
                    this.map = tap.#beginMap(args, this.context);
                },
                onLeave(retval) {
                    if (this.map !== null) {
                        tap.#endMap(this.map, retval.toInt32());
                    }
                }
            }),
        ];
    }

    #beginOpen(args: InvocationArguments, context: CpuContext): PendingOpen | null {
        if (this.#fromAgent()) {
            return null;
        }
        const service = entryFacts(args[0].toUInt32());
        if (!this.#settings.wants(service.className)) {
            return null;
        }
        return {
            kind: "open",
            time: Date.now(),
            servicePort: args[0].toUInt32(),
            service,
            type: args[2].toUInt32(),
            found: args[3],
            ...this.#backtrace(true, context),
        };
    }

    #endOpen({ servicePort, found, ...open }: PendingOpen, result: number): void {
        const connection = (result === SUCCESS)
            ? this.#connections.opened(found.readU32(), servicePort, open.type, "process", open.time)
            : null;
        this.#sink({ ...open, result, connection });
    }

    #noteClose(port: number, context: CpuContext): void {
        if (this.#fromAgent()) {
            return;
        }
        const connection = this.#connections.closed(port);
        if (this.#wantsConnection(connection)) {
            this.#sink({ kind: "close", time: Date.now(), connection, ...this.#backtrace(true, context) });
        }
    }

    #beginMap(args: InvocationArguments, context: CpuContext): PendingMap | null {
        if (this.#fromAgent()) {
            return null;
        }
        const connection = this.#connections.resolve(args[0].toUInt32());
        if (!this.#wantsConnection(connection)) {
            return null;
        }
        return {
            kind: "map",
            time: Date.now(),
            connection,
            memoryType: args[1].toUInt32(),
            found: args[3],
            sizeAt: args[4],
            ...this.#backtrace(true, context),
        };
    }

    #endMap({ found, sizeAt, ...map }: PendingMap, result: number): void {
        const mapped = result === SUCCESS;
        this.#sink({
            ...map,
            result,
            address: mapped ? found.readPointer() : NULL,
            size: mapped ? sizeAt.readU64().toNumber() : 0,
        });
    }

    #watchLookups(): InvocationListener[] {
        const tap = this;
        return [
            Interceptor.attach(entryPoints.serviceGetMatchingService, {
                onEnter(args) {
                    this.lookup = tap.#beginLookup("IOServiceGetMatchingService", args[1], this.context);
                },
                onLeave(retval) {
                    if (this.lookup !== null) {
                        tap.#endLookup(this.lookup, foundText(retval.toUInt32()));
                    }
                }
            }),
            Interceptor.attach(entryPoints.serviceGetMatchingServices, {
                onEnter(args) {
                    this.lookup = tap.#beginLookup("IOServiceGetMatchingServices", args[1], this.context);
                },
                onLeave(retval) {
                    if (this.lookup !== null) {
                        tap.#endLookup(this.lookup, resultText(retval.toInt32()));
                    }
                }
            }),
            Interceptor.attach(entryPoints.serviceAddMatchingNotification, {
                onEnter(args) {
                    this.lookup = tap.#beginLookup(`IOServiceAddMatchingNotification ${args[1].readUtf8String()}`, args[2], this.context);
                },
                onLeave(retval) {
                    if (this.lookup !== null) {
                        tap.#endLookup(this.lookup, resultText(retval.toInt32()));
                    }
                }
            }),
            Interceptor.attach(entryPoints.registryEntryFromPath, {
                onEnter(args) {
                    this.lookup = tap.#beginPathLookup(args[1].readUtf8String()!, this.context);
                },
                onLeave(retval) {
                    if (this.lookup !== null) {
                        tap.#endLookup(this.lookup, foundText(retval.toUInt32()));
                    }
                }
            }),
        ];
    }

    #beginLookup(via: string, matching: NativePointer, context: CpuContext): PendingLookup | null {
        if (this.#fromAgent()) {
            return null;
        }
        const value = toJavaScript(matching, this.#settings.dataLimit);
        return this.#lookup(via, value, summarize(value, LOOKUP_TEXT_LENGTH), context);
    }

    #beginPathLookup(path: string, context: CpuContext): PendingLookup | null {
        if (this.#fromAgent()) {
            return null;
        }
        return this.#lookup("IORegistryEntryFromPath", path, path, context);
    }

    #lookup(via: string, matching: unknown, text: string, context: CpuContext): PendingLookup | null {
        if (!this.#settings.wants(text)) {
            return null;
        }
        return { kind: "lookup", time: Date.now(), via, matching, text, ...this.#backtrace(true, context) };
    }

    #endLookup(lookup: PendingLookup, result: string): void {
        this.#sink({ ...lookup, result });
    }

    #watchProperties(): InvocationListener[] {
        const tap = this;
        return [
            Interceptor.attach(entryPoints.registryEntryCreateCFProperty, {
                onEnter(args) {
                    this.read = tap.#beginRead("IORegistryEntryCreateCFProperty", args[0], args[1], this.context);
                },
                onLeave(retval) {
                    if (this.read !== null) {
                        tap.#endRead(this.read, retval);
                    }
                }
            }),
            Interceptor.attach(entryPoints.registryEntrySearchCFProperty, {
                onEnter(args) {
                    this.read = tap.#beginRead(`IORegistryEntrySearchCFProperty ${args[1].readUtf8String()}`, args[0], args[2], this.context);
                },
                onLeave(retval) {
                    if (this.read !== null) {
                        tap.#endRead(this.read, retval);
                    }
                }
            }),
            Interceptor.attach(entryPoints.registryEntryCreateCFProperties, {
                onEnter(args) {
                    this.read = tap.#beginRead("IORegistryEntryCreateCFProperties", args[0], NULL, this.context);
                    this.properties = args[1];
                },
                onLeave(retval) {
                    if (this.read !== null) {
                        tap.#endRead(this.read, (retval.toInt32() === SUCCESS) ? this.properties.readPointer() : NULL);
                    }
                }
            }),
        ];
    }

    #beginRead(via: string, entry: NativePointer, key: NativePointer, context: CpuContext): PendingRead | null {
        const thread = Process.getCurrentThreadId();
        if (thread === this.#agentThread || this.#readingThreads.has(thread)) {
            return null;
        }
        this.#readingThreads.add(thread);
        const facts = entryFacts(entry.toUInt32());
        if (!this.#settings.wants(facts.className)) {
            return { thread, observation: null };
        }
        const keyText = key.isNull() ? "(all)" : String(toJavaScript(key, 0));
        return {
            thread,
            observation: { kind: "property", time: Date.now(), via, entry: facts, key: keyText, ...this.#backtrace(true, context) },
        };
    }

    #endRead({ thread, observation }: PendingRead, value: NativePointer): void {
        this.#readingThreads.delete(thread);
        if (observation !== null) {
            this.#sink({ ...observation, value: value.isNull() ? undefined : toJavaScript(value, this.#settings.dataLimit) });
        }
    }

    #wantsConnection(connection: Connection): boolean {
        return this.#settings.wants(connection.userClient, connection.service?.className ?? "");
    }

    #fromAgent(): boolean {
        return Process.getCurrentThreadId() === this.#agentThread;
    }

    #backtrace(wanted: boolean, context: CpuContext): { backtrace?: NativePointer[] } {
        return (wanted && this.#settings.backtraces) ? { backtrace: Thread.backtrace(context, Backtracer.ACCURATE) } : {};
    }
}

function outputSlotsOf(args: InvocationArguments, { output, outputStruct }: CallShape): OutputSlots {
    const [scalars, scalarCount] = pairAt(args, output);
    const [struct, structSize] = pairAt(args, outputStruct);
    return { scalars, scalarCount, struct, structSize };
}

function pairAt(args: InvocationArguments, index: number | null): [NativePointer, NativePointer] {
    return (index !== null) ? [args[index], args[index + 1]] : [NULL, NULL];
}

function countsOf({ scalarCount, structSize }: OutputSlots): Counts {
    return {
        scalars: scalarCount.isNull() ? 0 : scalarCount.readU32(),
        struct: structSize.isNull() ? 0 : structSize.readU64().toNumber(),
    };
}

export function scalarOf(value: UInt64): Scalar {
    const number = value.toNumber();
    return Number.isSafeInteger(number) ? number : value;
}

function foundText(object: number): string {
    return (object === 0) ? "nothing" : describeEntry(entryFacts(object));
}
