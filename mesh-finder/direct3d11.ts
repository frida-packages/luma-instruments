import { API, BufferDescriber, candidateBuffers, D3D11Buffer, releaseAll, type RetainedBuffer } from "./d3d11-buffers.js";
import { ContextTap, type TappedDraw } from "./d3d11-context-tap.js";
import { InputLayouts, type DeclaredAttribute } from "./d3d11-input-layouts.js";
import { LARGEST_PREFETCH, TurnReadback } from "./d3d11-readback.js";
import { discoverRuntime, type D3D11Runtime } from "./d3d11-runtime.js";
import type {
    BufferSearch,
    DrawCall,
    GeometryObserver,
    GraphicsBackend,
    GraphicsBackendFactory,
    IndexBinding,
    IndexFormat,
    AttributeLayout,
    Topology,
    VertexStream,
} from "./graphics-backend.js";
import { direct3D11Libraries } from "./graphics-libraries.js";

export const direct3D11: GraphicsBackendFactory = {
    api: API,
    libraries: direct3D11Libraries.runtime,
    activation: "after-loading",
    create: observer => new Direct3D11Backend(observer),
};

interface PendingDraw {
    draw: TappedDraw;
    buffers: Map<string, RetainedBuffer>;
}

interface PendingSearch {
    outstanding: number;
    found: D3D11Buffer[];
    detail: string;
    resolve(search: BufferSearch): void;
}

interface PendingScan {
    candidates: NativePointer[];
    search: PendingSearch;
    giveUp: ReturnType<typeof setTimeout>;
}

interface BufferBatch {
    buffers: RetainedBuffer[];
    search: PendingSearch | null;
}

interface DeviceWork {
    device: NativePointer;
    draws: PendingDraw[];
    batches: BufferBatch[];
}

type Lifecycle = "running" | "disposed";

type AfterTurn = () => void;

const TURN_BUDGET = 64 * 1048576;
const SCAN_SLICE = 512;
const TURN_WAIT_MS = 3000;
const BATCH_SLICE = 512;
const SETTLE_MS = 250;
const INDEXED_ARGUMENTS_SIZE = 20;
const ARGUMENTS_SIZE = 16;
const FORMAT_R16_UINT = 57;

const topologies = new Map<number, Topology>([[1, "point-list"], [4, "triangle-list"], [5, "triangle-strip"], [35, "triangle-list"]]);

class Direct3D11Backend implements GraphicsBackend {
    readonly api = API;
    readonly #observer: GeometryObserver;
    readonly #describer = new BufferDescriber();
    readonly #layouts = new InputLayouts();
    readonly #work = new Map<string, DeviceWork>();
    readonly #scans: PendingScan[] = [];
    readonly #runtime: D3D11Runtime;
    readonly #tap: ContextTap;
    #unsettled: RetainedBuffer[] = [];
    #settleTimer: ReturnType<typeof setTimeout> | null = null;
    #lifecycle: Lifecycle = "running";

    constructor(observer: GeometryObserver) {
        this.#observer = observer;
        this.#runtime = discoverRuntime(Process.enumerateModules().find(module => direct3D11Libraries.runtime.test(module.name))!);
        this.#tap = new ContextTap(this.#runtime.hooks, {
            newDraw: draw => this.#onNewDraw(draw),
            turn: (context, device) => this.#onTurn(context, device),
            bufferCreated: buffer => this.#onBufferCreated(buffer),
            inputLayoutCreated: (layout, elements, count) => this.#onInputLayout(layout, elements, count),
        });
    }

    watchDraws(): void {
        this.#tap.observeDraws("observed");
    }

    unwatchDraws(): void {
        this.#tap.observeDraws("ignored");
    }

    async findBuffers(): Promise<BufferSearch> {
        const runtime = this.#runtime;
        const tap = this.#tap;
        if (runtime.buffers === null) {
            return { buffers: 0, detail: `buffers made earlier cannot be told from freed ones here; ${contextsOf(runtime)}` };
        }
        const candidates = candidateBuffers(runtime.buffers);
        const detail = `live instances of d3d11.dll's buffer class, read back while the process draws; ${contextsOf(runtime)}`;
        return new Promise(resolve => {
            const scan: PendingScan = {
                candidates,
                search: { outstanding: 1, found: [], detail, resolve },
                giveUp: setTimeout(() => this.#giveUp(scan), TURN_WAIT_MS),
            };
            this.#scans.push(scan);
            tap.requestAnyTurn();
        });
    }

    dispose(): void {
        this.#lifecycle = "disposed";
        this.#tap.dispose();
        if (this.#settleTimer !== null) {
            clearTimeout(this.#settleTimer);
        }
        releaseAll(this.#unsettled);
        this.#unsettled = [];
        for (const { search, giveUp } of this.#scans.splice(0)) {
            clearTimeout(giveUp);
            search.resolve({ buffers: search.found.length, detail: search.detail });
        }
        for (const work of this.#work.values()) {
            for (const draw of work.draws) {
                releaseAll([...draw.buffers.values()]);
            }
            for (const batch of work.batches) {
                releaseAll(batch.buffers);
                batch.search?.resolve({ buffers: batch.search.found.length, detail: batch.search.detail });
            }
        }
        this.#work.clear();
    }

    #onNewDraw(draw: TappedDraw): void {
        if (this.#lifecycle === "disposed") {
            return;
        }
        const handles = [...draw.slots.map(slot => slot.buffer), draw.indexBuffer, draw.indirectBuffer].filter(handle => !handle.isNull());
        const buffers = new Map<string, RetainedBuffer>();
        for (const handle of handles) {
            if (!buffers.has(handle.toString())) {
                buffers.set(handle.toString(), this.#describer.retain(handle));
            }
        }
        this.#workOf(draw.device).draws.push({ draw, buffers });
        this.#tap.requestTurn(draw.device);
    }

    #onTurn(context: NativePointer, device: NativePointer): void {
        if (this.#lifecycle === "disposed") {
            return;
        }
        const afterTurn: AfterTurn[] = [];
        this.#retainScanned(afterTurn);
        const work = this.#work.get(device.toString());
        if (work !== undefined) {
            this.#work.delete(device.toString());
            const readback = new TurnReadback(context, device);
            try {
                this.#readDraws(work.draws, readback, afterTurn);
                this.#readBatches(work.batches, readback, afterTurn);
            } finally {
                readback.end();
            }
        }
        if (afterTurn.length !== 0) {
            setTimeout(() => this.#runAfterTurn(afterTurn), 0);
        }
    }

    #onBufferCreated(handle: NativePointer): void {
        if (this.#lifecycle === "disposed") {
            return;
        }
        this.#unsettled.push(this.#describer.retain(handle));
        if (this.#settleTimer !== null) {
            clearTimeout(this.#settleTimer);
        }
        this.#settleTimer = setTimeout(() => {
            this.#settleTimer = null;
            const settled = this.#unsettled;
            this.#unsettled = [];
            this.#queueBuffers(settled, null);
        }, SETTLE_MS);
    }

    #onInputLayout(layout: NativePointer, elements: NativePointer, count: number): void {
        const { position, texcoord } = this.#layouts.learn(layout, elements, count);
        if (position !== null) {
            this.#tap.narrowLayout(layout, (1 << position.slot) | ((texcoord !== null) ? 1 << texcoord.slot : 0));
        }
    }

    #retainScanned(afterTurn: AfterTurn[]): void {
        const scan = this.#scans[0];
        if (scan === undefined) {
            return;
        }
        for (const { giveUp } of this.#scans) {
            clearTimeout(giveUp);
        }
        const runtime = this.#runtime;
        const tap = this.#tap;
        const found = this.#describer.retainLive(scan.candidates.splice(0, SCAN_SLICE), runtime.buffers!);
        if (found.length !== 0) {
            this.#queueBuffers(found, scan.search);
        }
        if (scan.candidates.length !== 0) {
            tap.requestAnyTurn();
            return;
        }
        this.#scans.shift();
        afterTurn.push(() => this.#settle(scan.search));
        if (this.#scans.length !== 0) {
            tap.requestAnyTurn();
        }
    }

    #readDraws(draws: PendingDraw[], readback: TurnReadback, afterTurn: AfterTurn[]): void {
        const distinct = new Map<string, RetainedBuffer>();
        for (const { buffers } of draws) {
            for (const [key, buffer] of buffers) {
                distinct.set(key, buffer);
            }
        }
        readback.prefetch(partitionByBudget([...distinct.values()], TURN_BUDGET).taken);
        for (const pending of draws) {
            const unread = [...pending.buffers.values()].filter(buffer => !readback.holds(buffer));
            if (unread.length === 0) {
                afterTurn.push(() => this.#observeDraw(pending, readback));
            } else if (unread.every(buffer => buffer.description.byteLength > LARGEST_PREFETCH)) {
                this.#observeDraw(pending, readback);
            } else {
                this.#workOf(pending.draw.device).draws.push(pending);
                this.#tap.requestTurn(pending.draw.device);
                continue;
            }
            releaseAll([...pending.buffers.values()]);
        }
    }

    #readBatches(batches: BufferBatch[], readback: TurnReadback, afterTurn: AfterTurn[]): void {
        let budget = TURN_BUDGET;
        for (const batch of batches) {
            const { taken, oversized, left, cost } = partitionByBudget(batch.buffers, budget);
            budget -= cost;
            const observed = [...taken, ...oversized];
            readback.prefetch(taken);
            const buffers = observed.map(buffer => new D3D11Buffer(buffer, readback));
            releaseAll(observed);
            const search = batch.search;
            if (left.length !== 0) {
                const device = left[0].description.device;
                this.#workOf(device).batches.push({ buffers: left, search });
                this.#tap.requestTurn(device);
            }
            if (search === null) {
                afterTurn.push(() => this.#observer.observeBuffers(buffers));
                continue;
            }
            search.found.push(...buffers);
            if (left.length === 0) {
                afterTurn.push(() => this.#settle(search));
            }
        }
    }

    #runAfterTurn(work: AfterTurn[]): void {
        if (this.#lifecycle === "running") {
            for (const step of work) {
                step();
            }
        }
    }

    #giveUp(scan: PendingScan): void {
        this.#scans.splice(this.#scans.indexOf(scan), 1);
        scan.search.resolve({ buffers: 0, detail: `no frame was drawn within ${TURN_WAIT_MS / 1000} s; scan again once it draws` });
    }

    #queueBuffers(buffers: RetainedBuffer[], search: PendingSearch | null): void {
        const byDevice = new Map<string, RetainedBuffer[]>();
        for (const buffer of buffers) {
            const key = buffer.description.device.toString();
            byDevice.set(key, [...(byDevice.get(key) ?? []), buffer]);
        }
        for (const deviceBuffers of byDevice.values()) {
            const device = deviceBuffers[0].description.device;
            this.#workOf(device).batches.push({ buffers: deviceBuffers, search });
            if (search !== null) {
                search.outstanding++;
            }
            this.#tap.requestTurn(device);
        }
    }

    #settle(search: PendingSearch): void {
        if (--search.outstanding === 0) {
            this.#observer.observeBuffers(search.found);
            search.resolve({ buffers: search.found.length, detail: search.detail });
        }
    }

    #observeDraw(pending: PendingDraw, readback: TurnReadback): void {
        const call = this.#drawCallOf(pending, readback);
        if (call !== null) {
            this.#observer.observeDraw(call);
        }
    }

    #workOf(device: NativePointer): DeviceWork {
        const key = device.toString();
        let work = this.#work.get(key);
        if (work === undefined) {
            work = { device, draws: [], batches: [] };
            this.#work.set(key, work);
        }
        return work;
    }

    #drawCallOf({ draw, buffers }: PendingDraw, readback: TurnReadback): DrawCall | null {
        const topology = topologies.get(draw.topology)!;
        const bufferOf = (handle: NativePointer) => new D3D11Buffer(buffers.get(handle.toString())!, readback);
        const streams: VertexStream[] = draw.slots.map(slot => ({
            slot: slot.index,
            buffer: bufferOf(slot.buffer),
            offset: slot.offset,
            stride: (slot.stride !== 0) ? slot.stride : null,
        }));
        const declared = draw.layout.isNull() ? undefined : this.#layouts.attributesOf(draw.layout);
        const position = attributeLayoutOf(declared?.position ?? null, streams);
        const tap = this.#tap;
        const call: DrawCall = {
            api: API,
            topology,
            streams,
            bystanders: [],
            position,
            texcoord: attributeLayoutOf(declared?.texcoord ?? null, streams),
            textures: [],
            indices: null,
            firstVertex: draw.startVertex,
            vertexCount: draw.vertexCount,
            baseVertex: draw.baseVertex,
            noteSlotGuess(slot) {
                if (position === null && !draw.layout.isNull()) {
                    tap.narrowLayout(draw.layout, 1 << slot);
                }
            },
        };
        const indirect = draw.indirectBuffer.isNull() ? null : bufferOf(draw.indirectBuffer);
        if (draw.kind === "vertices" || draw.kind === "vertices-indirect") {
            if (indirect === null) {
                return call;
            }
            const args = argumentsOf(indirect, draw.indirectOffset, ARGUMENTS_SIZE);
            return (args !== null) ? { ...call, vertexCount: args.getUint32(0, true), firstVertex: args.getUint32(8, true) } : null;
        }
        const format: IndexFormat = (draw.indexFormat === FORMAT_R16_UINT) ? "uint16" : "uint32";
        const width = (format === "uint16") ? 2 : 4;
        const indices: IndexBinding = { buffer: bufferOf(draw.indexBuffer), offset: 0, format, count: draw.indexCount };
        let startIndex = draw.startIndex;
        if (indirect !== null) {
            const args = argumentsOf(indirect, draw.indirectOffset, INDEXED_ARGUMENTS_SIZE);
            if (args === null) {
                return null;
            }
            indices.count = args.getUint32(0, true);
            startIndex = args.getUint32(8, true);
            call.baseVertex = args.getInt32(12, true);
        }
        indices.offset = draw.indexOffset + startIndex * width;
        return { ...call, indices, vertexCount: 0 };
    }
}

function contextsOf(runtime: D3D11Runtime): string {
    return `${runtime.liveContexts} live contexts, classes learned from a ${runtime.driver} device`;
}

function attributeLayoutOf(declared: DeclaredAttribute | null, streams: VertexStream[]): AttributeLayout | null {
    const stream = (declared !== null) ? streams.find(candidate => candidate.slot === declared.slot) : undefined;
    return (declared !== null && stream !== undefined) ? { ...declared, stride: stream.stride ?? 0 } : null;
}

function partitionByBudget(buffers: RetainedBuffer[], budget: number) {
    const taken: RetainedBuffer[] = [];
    const oversized: RetainedBuffer[] = [];
    const left: RetainedBuffer[] = [];
    let cost = 0;
    for (const buffer of buffers) {
        const size = buffer.description.byteLength;
        if (size > LARGEST_PREFETCH) {
            oversized.push(buffer);
        } else if (cost + size <= budget && taken.length !== BATCH_SLICE) {
            taken.push(buffer);
            cost += size;
        } else {
            left.push(buffer);
        }
    }
    return { taken, oversized, left, cost };
}

function argumentsOf(buffer: D3D11Buffer, offset: number, size: number): DataView | null {
    try {
        return new DataView(buffer.read(offset, size));
    } catch {
        return null;
    }
}
