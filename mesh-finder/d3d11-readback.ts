import { comMethod, release, succeeded } from "./com-methods.js";
import type { BufferContents, RetainedBuffer } from "./d3d11-buffers.js";
import { BufferDesc } from "./d3d11-descriptions.pat";
import { Box, MappedSubresource } from "./d3d11-readback.pat";
import { contextSlots, deviceSlots } from "./d3d11-runtime.js";

interface CopyRequest {
    source: RetainedBuffer;
    offset: number;
    length: number;
}

type TurnState = "open" | "over";

const USAGE_STAGING = 3;
const CPU_ACCESS_READ = 0x20000;
const MAP_READ = 1;
export const LARGEST_PREFETCH = 64 * 1048576;
const STAGING_CHUNK = 16 * 1048576;

export class TurnReadback implements BufferContents {
    readonly #context: NativePointer;
    readonly #device: NativePointer;
    readonly #snapshots = new Map<string, ArrayBuffer>();
    readonly #description = BufferDesc.at(Memory.alloc(BufferDesc.size));
    readonly #createdStaging = Memory.alloc(Process.pointerSize);
    readonly #box = Box.at(Memory.alloc(Box.size));
    readonly #mapping = MappedSubresource.at(Memory.alloc(MappedSubresource.size));
    #state: TurnState = "open";

    constructor(context: NativePointer, device: NativePointer) {
        this.#context = context;
        this.#device = device;
    }

    prefetch(buffers: RetainedBuffer[]): void {
        const wanted = buffers.filter(buffer => !this.#snapshots.has(buffer.handle.toString()) && buffer.description.byteLength !== 0);
        let contents: ArrayBuffer[];
        try {
            contents = this.#copy(wanted.map(source => ({ source, offset: 0, length: source.description.byteLength })));
        } catch {
            return;
        }
        wanted.forEach((buffer, i) => this.#snapshots.set(buffer.handle.toString(), contents[i]));
    }

    read(buffer: RetainedBuffer, offset: number, length: number): ArrayBuffer {
        const whole = this.#snapshots.get(buffer.handle.toString());
        if (whole !== undefined) {
            return whole.slice(offset, offset + length);
        }
        if (this.#state === "over") {
            throw new Error(`${buffer.handle} can only be read while the process draws`);
        }
        return (length !== 0) ? this.#copy([{ source: buffer, offset, length }])[0] : new ArrayBuffer(0);
    }

    holds(buffer: RetainedBuffer): boolean {
        return this.#snapshots.has(buffer.handle.toString());
    }

    end(): void {
        this.#state = "over";
    }

    #copy(requests: CopyRequest[]): ArrayBuffer[] {
        return chunksOf(requests).flatMap(chunk => this.#copyChunk(chunk));
    }

    #copyChunk(chunk: CopyRequest[]): ArrayBuffer[] {
        const total = chunk.reduce((sum, request) => sum + request.length, 0);
        const staging = this.#createStaging(total);
        try {
            let position = 0;
            for (const request of chunk) {
                this.#copyInto(staging, position, request);
                position += request.length;
            }
            const contents = this.#mapped(staging, chunk[0].source, total);
            position = 0;
            return chunk.map(request => {
                const slice = contents.slice(position, position + request.length);
                position += request.length;
                return slice;
            });
        } finally {
            release(staging);
        }
    }

    #createStaging(length: number): NativePointer {
        const description = this.#description;
        description.byteWidth = length;
        description.usage = USAGE_STAGING;
        description.bindFlags = 0;
        description.cpuAccessFlags = CPU_ACCESS_READ;
        description.miscFlags = 0;
        description.structureByteStride = 0;
        const result = comMethod(this.#device, deviceSlots.createBuffer, "int", ["pointer", "pointer", "pointer"])(this.#device,
            description.$address, NULL, this.#createdStaging);
        if (!succeeded(result)) {
            throw new Error(`a ${length}-byte staging buffer could not be made: 0x${(result >>> 0).toString(16)}`);
        }
        return this.#createdStaging.readPointer();
    }

    #copyInto(staging: NativePointer, position: number, { source, offset, length }: CopyRequest): void {
        const box = this.#box;
        box.left = offset;
        box.top = 0;
        box.front = 0;
        box.right = offset + length;
        box.bottom = 1;
        box.back = 1;
        comMethod(this.#context, contextSlots.copySubresourceRegion, "void",
            ["pointer", "uint32", "uint32", "uint32", "uint32", "pointer", "uint32", "pointer"])(this.#context, staging, 0, position, 0, 0,
            source.handle, 0, box.$address);
    }

    #mapped(staging: NativePointer, source: RetainedBuffer, length: number): ArrayBuffer {
        const mapping = this.#mapping;
        const result = comMethod(this.#context, contextSlots.map, "int", ["pointer", "uint32", "uint32", "uint32", "pointer"])(
            this.#context, staging, 0, MAP_READ, 0, mapping.$address);
        if (!succeeded(result)) {
            throw new Error(`${source.handle} could not be read back: 0x${(result >>> 0).toString(16)}`);
        }
        try {
            return mapping.data.readByteArray(length)!;
        } finally {
            comMethod(this.#context, contextSlots.unmap, "void", ["pointer", "uint32"])(this.#context, staging, 0);
        }
    }
}

function chunksOf(requests: CopyRequest[]): CopyRequest[][] {
    const chunks: CopyRequest[][] = [];
    let current: CopyRequest[] = [];
    let size = 0;
    for (const request of requests) {
        if (current.length !== 0 && size + request.length > STAGING_CHUNK) {
            chunks.push(current);
            current = [];
            size = 0;
        }
        current.push(request);
        size += request.length;
    }
    if (current.length !== 0) {
        chunks.push(current);
    }
    return chunks;
}
