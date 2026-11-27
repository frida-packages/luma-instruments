import { comCalls, comMethod, guid, methodAddress, queryInterface, release, succeeded } from "./com-methods.js";
import { BufferDesc, QueryDesc, SubresourceData } from "./d3d11-descriptions.pat";

export type TapCall =
    | "setInputLayout"
    | "setVertexBuffers"
    | "setIndexBuffer"
    | "setTopology"
    | "setPixelShader"
    | "setShaderResources"
    | "draw"
    | "drawIndexed"
    | "drawInstanced"
    | "drawIndexedInstanced"
    | "drawInstancedIndirect"
    | "drawIndexedInstancedIndirect"
    | "clearState"
    | "executeCommandList"
    | "finishCommandList"
    | "swapState"
    | "setRenderTargets"
    | "setRenderTargetsAndUnorderedAccessViews"
    | "setStreamOutputTargets"
    | "setComputeUnorderedAccessViews"
    | "createBuffer"
    | "createInputLayout"
    | "createPixelShader"
    | "createDeferredContext";

export interface HookTarget {
    call: TapCall;
    address: NativePointer;
}

export interface BufferClass {
    vtable: NativePointer;
    signature: SignatureWord[];
}

export interface SignatureWord {
    offset: number;
    value: NativePointer;
}

export interface D3D11Runtime {
    driver: string;
    hooks: HookTarget[];
    buffers: BufferClass | null;
    liveContexts: number;
}

interface Throwaway {
    driver: string;
    device: NativePointer;
    context: NativePointer;
}

interface ContextTables {
    entries: Map<TapCall, Set<string>>;
    heads: Set<string>;
}

type DriverType = [name: string, value: number];

export const contextSlots = {
    map: 14,
    unmap: 15,
    copySubresourceRegion: 46,
    flush: 111,
};

export const deviceSlots = {
    createBuffer: 3,
    createTexture2D: 5,
    createQuery: 24,
    createDeferredContext: 27,
};

const multithreadSlots = {
    setMultithreadProtected: 5,
};

export const deviceChildSlots = {
    getDevice: 3,
    getPrivateData: 4,
};

export const bufferSlots = {
    getDesc: 10,
};

export const textureSlots = {
    getDesc: 10,
};

export const viewSlots = {
    getResource: 7,
    getDesc: 8,
};

const contextCalls: [TapCall, number][] = [
    ["setShaderResources", 8],
    ["setPixelShader", 9],
    ["drawIndexed", 12],
    ["draw", 13],
    ["setInputLayout", 17],
    ["setVertexBuffers", 18],
    ["setIndexBuffer", 19],
    ["drawIndexedInstanced", 20],
    ["drawInstanced", 21],
    ["setTopology", 24],
    ["setRenderTargets", 33],
    ["setRenderTargetsAndUnorderedAccessViews", 34],
    ["setStreamOutputTargets", 37],
    ["drawIndexedInstancedIndirect", 39],
    ["drawInstancedIndirect", 40],
    ["executeCommandList", 58],
    ["setComputeUnorderedAccessViews", 68],
    ["clearState", 110],
    ["finishCommandList", 114],
];
const context1Calls: [TapCall, number][] = [["swapState", 131]];
const deviceCalls: [TapCall, number][] = [
    ["createBuffer", 3],
    ["createInputLayout", 11],
    ["createPixelShader", 15],
    ["createDeferredContext", 27],
];
const device1Calls: [TapCall, number][] = [["createDeferredContext", 44]];

const IID_ID3D11DEVICE1 = guid("a04bfb29-08ef-43d6-a49c-a9bdbdcbe686");
const IID_ID3D11DEVICECONTEXT1 = guid("bb2c6faa-b5fb-4082-8e6b-388b8cfa90e1");
const IID_ID3D11MULTITHREAD = guid("9b7e4e00-342c-4106-a19f-4f2704f689f0");

const driverTypes: DriverType[] = [["null", 3], ["WARP", 5]];
const D3D11_SDK_VERSION = 7;
const QUERY_EVENT = 0;
const USAGE_DEFAULT = 0;
const USAGE_IMMUTABLE = 1;
const USAGE_DYNAMIC = 2;
const BIND_VERTEX_BUFFER = 0x1;
const BIND_INDEX_BUFFER = 0x2;
const CPU_ACCESS_WRITE = 0x10000;
const SAMPLE_BUFFER_SIZE = 4096;
const OBJECT_REACH = 256;
const BACK_REFERENCE_REACH = 512;
const SAMPLE_ROUNDS = 2;

type SampleKind = [usage: number, bind: number, cpuAccess: number];

const sampleBuffers: SampleKind[] = [
    [USAGE_IMMUTABLE, BIND_VERTEX_BUFFER, 0],
    [USAGE_DEFAULT, BIND_INDEX_BUFFER, 0],
    [USAGE_DYNAMIC, BIND_VERTEX_BUFFER, CPU_ACCESS_WRITE],
    [USAGE_DEFAULT, BIND_VERTEX_BUFFER | BIND_INDEX_BUFFER, 0],
];

export function discoverRuntime(module: Module): D3D11Runtime {
    const throwaway = createThrowawayDevice(module);
    try {
        const tables = contextTablesOf(throwaway, module);
        noteTemplates(tables, module);
        const liveContexts = findLiveContexts(tables, module);
        return {
            driver: throwaway.driver,
            hooks: [...deviceHooksOf(throwaway.device), ...contextHooksOf(tables)],
            buffers: bufferClassOf(throwaway, module),
            liveContexts,
        };
    } finally {
        release(throwaway.context);
        release(throwaway.device);
    }
}

function createThrowawayDevice(module: Module): Throwaway {
    const create = new NativeFunction(module.getExportByName("D3D11CreateDevice"), "int",
        ["pointer", "int", "pointer", "uint32", "pointer", "uint32", "uint32", "pointer", "pointer", "pointer"], comCalls);
    const out = Memory.alloc(3 * Process.pointerSize);
    const failures: string[] = [];
    for (const [driver, type] of driverTypes) {
        const result = create(NULL, type, NULL, 0, NULL, 0, D3D11_SDK_VERSION, out, out.add(Process.pointerSize),
            out.add(2 * Process.pointerSize));
        if (succeeded(result)) {
            return { driver, device: out.readPointer(), context: out.add(2 * Process.pointerSize).readPointer() };
        }
        failures.push(`${driver}: 0x${(result >>> 0).toString(16)}`);
    }
    throw new Error(`no Direct3D 11 device could be made to learn its classes from (${failures.join(", ")})`);
}

function contextTablesOf({ device, context }: Throwaway, module: Module): ContextTables {
    const tables: ContextTables = { entries: new Map(), heads: new Set() };
    const deferred = () => {
        const out = Memory.alloc(Process.pointerSize);
        const result = comMethod(device, deviceSlots.createDeferredContext, "int", ["uint32", "pointer"])(device, 0, out);
        return succeeded(result) ? out.readPointer() : null;
    };
    const unprotected = deferred();
    noteTable(tables, context, module);
    if (unprotected !== null) {
        noteTable(tables, unprotected, module);
        release(unprotected);
    }
    const multithread = queryInterface(context, IID_ID3D11MULTITHREAD);
    if (multithread !== null) {
        comMethod(multithread, multithreadSlots.setMultithreadProtected, "int", ["int"])(multithread, 1);
        noteTable(tables, context, module);
        const guarded = deferred();
        if (guarded !== null) {
            noteTable(tables, guarded, module);
            release(guarded);
        }
        release(multithread);
    }
    return tables;
}

function noteTemplates(tables: ContextTables, module: Module): void {
    const readOnly = module.enumerateRanges("r--").filter(range => !range.protection.includes("x"));
    for (const { address } of Memory.findPointers(readOnly, queryInterfacesOf(tables))) {
        noteEntries(tables, address, module);
    }
}

function findLiveContexts(tables: ContextTables, module: Module): number {
    let found = 0;
    for (const { address } of Memory.findPointers(Process.enumerateRanges("rw-"), queryInterfacesOf(tables))) {
        const object = address.sub(Process.pointerSize);
        if (readPointerOrNull(object)?.equals(address) === true && noteEntries(tables, address, module)) {
            found++;
        }
    }
    return found;
}

function deviceHooksOf(device: NativePointer): HookTarget[] {
    const calls = supports(device, IID_ID3D11DEVICE1) ? [...deviceCalls, ...device1Calls] : deviceCalls;
    return calls.map(([call, slot]) => ({ call, address: methodAddress(device, slot) }));
}

function contextHooksOf(tables: ContextTables): HookTarget[] {
    const claims = new Map<string, TapCall[]>();
    for (const [call, addresses] of tables.entries) {
        for (const address of addresses) {
            claims.set(address, [...(claims.get(address) ?? []), call]);
        }
    }
    return [...claims].filter(([, calls]) => calls.length === 1).map(([address, [call]]) => ({ call, address: ptr(address) }));
}

function bufferClassOf({ device, context }: Throwaway, module: Module): BufferClass | null {
    const samples: NativePointer[] = [];
    const spacers: NativePointer[] = [];
    try {
        for (let round = 0; round !== SAMPLE_ROUNDS; round++) {
            for (const kind of sampleBuffers) {
                samples.push(createSampleBuffer(device, kind));
                const spacer = createSpacer(device);
                if (spacer !== null) {
                    spacers.push(spacer);
                }
            }
        }
        const vtable = samples[0].readPointer();
        if (samples.some(sample => !sample.readPointer().equals(vtable))) {
            return null;
        }
        if (!referencedFromBehind(samples, destroyedSamples(device, context))) {
            return null;
        }
        return { vtable, signature: signatureOf(samples, module) };
    } finally {
        for (const object of [...samples, ...spacers]) {
            release(object);
        }
    }
}

function noteTable(tables: ContextTables, context: NativePointer, module: Module): void {
    const calls = supports(context, IID_ID3D11DEVICECONTEXT1) ? [...contextCalls, ...context1Calls] : contextCalls;
    for (const [call, slot] of calls) {
        const address = methodAddress(context, slot);
        if (isCodeOf(module, address)) {
            noteEntry(tables, call, address);
        }
    }
    tables.heads.add(headOf(context.readPointer()));
}

function queryInterfacesOf(tables: ContextTables): NativePointer[] {
    return [...new Set([...tables.heads].map(head => head.split(",")[0]))].map(address => ptr(address));
}

function noteEntries(tables: ContextTables, table: NativePointer, module: Module): boolean {
    if (!tables.heads.has(headOf(table))) {
        return false;
    }
    const entries = contextCalls.map(([call, slot]) => [call, readPointerOrNull(table.add(slot * Process.pointerSize))] as const);
    if (!entries.every(([, entry]) => entry !== null && isCodeOf(module, entry))) {
        return false;
    }
    for (const [call, entry] of entries) {
        noteEntry(tables, call, entry!);
    }
    return true;
}

function createSpacer(device: NativePointer): NativePointer | null {
    const description = QueryDesc.at(Memory.alloc(QueryDesc.size));
    description.query = QUERY_EVENT;
    const out = Memory.alloc(Process.pointerSize);
    const result = comMethod(device, deviceSlots.createQuery, "int", ["pointer", "pointer"])(device, description.$address, out);
    return succeeded(result) ? out.readPointer() : null;
}

function referencedFromBehind(samples: NativePointer[], destroyed: NativePointer[]): boolean {
    return samples.every(sample => isReferencedFromBehind(sample)) && destroyed.every(victim => !isReferencedFromBehind(victim));
}

function destroyedSamples(device: NativePointer, context: NativePointer): NativePointer[] {
    const victims = sampleBuffers.map(kind => createSampleBuffer(device, kind));
    for (const victim of victims) {
        release(victim);
    }
    comMethod(context, contextSlots.flush, "void", [])(context);
    return victims;
}

function signatureOf(samples: NativePointer[], module: Module): SignatureWord[] {
    const signature: SignatureWord[] = [];
    for (let offset = -Process.pointerSize; offset <= OBJECT_REACH; offset += Process.pointerSize) {
        const values = samples.map(sample => readPointerOrNull(sample.add(offset)));
        const value = values[0];
        if (value !== null && isWithin(module, value) && values.every(other => other !== null && other.equals(value))) {
            signature.push({ offset, value });
        }
    }
    return signature;
}

function supports(object: NativePointer, iid: NativePointer): boolean {
    const other = queryInterface(object, iid);
    if (other === null) {
        return false;
    }
    release(other);
    return true;
}

function isCodeOf(module: Module, address: NativePointer): boolean {
    return isWithin(module, address) && (Process.findRangeByAddress(address)?.protection.includes("x") ?? false);
}

function noteEntry(tables: ContextTables, call: TapCall, address: NativePointer): void {
    let known = tables.entries.get(call);
    if (known === undefined) {
        known = new Set();
        tables.entries.set(call, known);
    }
    known.add(address.toString());
}

function headOf(table: NativePointer): string {
    return [0, 1, 2].map(slot => readPointerOrNull(table.add(slot * Process.pointerSize))?.toString() ?? "").join(",");
}

function createSampleBuffer(device: NativePointer, [usage, bind, cpuAccess]: SampleKind): NativePointer {
    const description = BufferDesc.at(Memory.alloc(BufferDesc.size));
    description.byteWidth = SAMPLE_BUFFER_SIZE;
    description.usage = usage;
    description.bindFlags = bind;
    description.cpuAccessFlags = cpuAccess;
    const contents = Memory.alloc(SAMPLE_BUFFER_SIZE);
    const initial = SubresourceData.at(Memory.alloc(SubresourceData.size));
    initial.sysMem = contents;
    const out = Memory.alloc(Process.pointerSize);
    const result = comMethod(device, deviceSlots.createBuffer, "int", ["pointer", "pointer", "pointer"])(device, description.$address,
        (usage === USAGE_DYNAMIC) ? NULL : initial.$address, out);
    if (!succeeded(result)) {
        throw new Error(`a sample buffer could not be made: 0x${(result >>> 0).toString(16)}`);
    }
    return out.readPointer();
}

export function isReferencedFromBehind(object: NativePointer): boolean {
    for (let offset = Process.pointerSize; offset <= BACK_REFERENCE_REACH; offset += Process.pointerSize) {
        if (readPointerOrNull(object.sub(offset))?.equals(object) === true) {
            return true;
        }
    }
    return false;
}

function isWithin(module: Module, address: NativePointer): boolean {
    return address.compare(module.base) >= 0 && address.compare(module.base.add(module.size)) < 0;
}

export function readPointerOrNull(address: NativePointer): NativePointer | null {
    try {
        return address.readPointer();
    } catch {
        return null;
    }
}
