import { comMethod, release, succeeded } from "./com-methods.js";
import type { BufferContents, RetainedBuffer } from "./d3d11-buffers.js";
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
    private readonly snapshots = new Map<string, ArrayBuffer>();
    private readonly scratch = Memory.alloc(64);
    private state: TurnState = "open";

    constructor(private readonly context: NativePointer, private readonly device: NativePointer) {
    }

    prefetch(buffers: RetainedBuffer[]): void {
        const wanted = buffers.filter(buffer => !this.snapshots.has(buffer.handle.toString()) && buffer.description.byteLength !== 0);
        let contents: ArrayBuffer[];
        try {
            contents = this.copy(wanted.map(source => ({ source, offset: 0, length: source.description.byteLength })));
        } catch {
            return;
        }
        wanted.forEach((buffer, i) => this.snapshots.set(buffer.handle.toString(), contents[i]));
    }

    read(buffer: RetainedBuffer, offset: number, length: number): ArrayBuffer {
        const whole = this.snapshots.get(buffer.handle.toString());
        if (whole !== undefined) {
            return whole.slice(offset, offset + length);
        }
        if (this.state === "over") {
            throw new Error(`${buffer.handle} can only be read while the process draws`);
        }
        return (length !== 0) ? this.copy([{ source: buffer, offset, length }])[0] : new ArrayBuffer(0);
    }

    holds(buffer: RetainedBuffer): boolean {
        return this.snapshots.has(buffer.handle.toString());
    }

    end(): void {
        this.state = "over";
    }

    private copy(requests: CopyRequest[]): ArrayBuffer[] {
        return chunksOf(requests).flatMap(chunk => this.copyChunk(chunk));
    }

    private copyChunk(chunk: CopyRequest[]): ArrayBuffer[] {
        const total = chunk.reduce((sum, request) => sum + request.length, 0);
        const staging = this.createStaging(total);
        try {
            let position = 0;
            for (const request of chunk) {
                this.copyInto(staging, position, request);
                position += request.length;
            }
            const contents = this.mapped(staging, chunk[0].source, total);
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

    private createStaging(length: number): NativePointer {
        const description = this.scratch;
        description.writeU32(length);
        description.add(4).writeU32(USAGE_STAGING);
        description.add(8).writeU32(0);
        description.add(12).writeU32(CPU_ACCESS_READ);
        description.add(16).writeU32(0);
        description.add(20).writeU32(0);
        const out = this.scratch.add(32);
        const result = comMethod(this.device, deviceSlots.createBuffer, "int", ["pointer", "pointer", "pointer"])(this.device,
            description, NULL, out);
        if (!succeeded(result)) {
            throw new Error(`a ${length}-byte staging buffer could not be made: 0x${(result >>> 0).toString(16)}`);
        }
        return out.readPointer();
    }

    private copyInto(staging: NativePointer, position: number, { source, offset, length }: CopyRequest): void {
        const box = this.scratch;
        box.writeU32(offset);
        box.add(4).writeU32(0);
        box.add(8).writeU32(0);
        box.add(12).writeU32(offset + length);
        box.add(16).writeU32(1);
        box.add(20).writeU32(1);
        comMethod(this.context, contextSlots.copySubresourceRegion, "void",
            ["pointer", "uint32", "uint32", "uint32", "uint32", "pointer", "uint32", "pointer"])(this.context, staging, 0, position, 0, 0,
            source.handle, 0, box);
    }

    private mapped(staging: NativePointer, source: RetainedBuffer, length: number): ArrayBuffer {
        const mapping = this.scratch;
        const result = comMethod(this.context, contextSlots.map, "int", ["pointer", "uint32", "uint32", "uint32", "pointer"])(
            this.context, staging, 0, MAP_READ, 0, mapping);
        if (!succeeded(result)) {
            throw new Error(`${source.handle} could not be read back: 0x${(result >>> 0).toString(16)}`);
        }
        try {
            return mapping.readPointer().readByteArray(length)!;
        } finally {
            comMethod(this.context, contextSlots.unmap, "void", ["pointer", "uint32"])(this.context, staging, 0);
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
