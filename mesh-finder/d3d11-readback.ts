import { comMethod, release, succeeded } from "./com-methods.js";
import type { BufferContents, RetainedBuffer } from "./d3d11-buffers.js";
import { BufferDesc, Texture2DDesc } from "./d3d11-descriptions.pat";
import { Box, MappedSubresource } from "./d3d11-readback.pat";
import { contextSlots, deviceSlots } from "./d3d11-runtime.js";
import type { RetainedTexture, TextureContents } from "./d3d11-textures.js";

interface CopyRequest {
    source: RetainedBuffer;
    offset: number;
    length: number;
}

interface StagedTexture {
    texture: RetainedTexture;
    staging: NativePointer;
}

type TurnState = "open" | "over";

type TextureSnapshot = ArrayBuffer | Error;

const USAGE_STAGING = 3;
const CPU_ACCESS_READ = 0x20000;
const MAP_READ = 1;
export const LARGEST_PREFETCH = 64 * 1048576;
const STAGING_CHUNK = 16 * 1048576;

export class TurnReadback implements BufferContents, TextureContents {
    readonly #context: NativePointer;
    readonly #device: NativePointer;
    readonly #snapshots = new Map<string, ArrayBuffer>();
    readonly #textureSnapshots = new Map<string, TextureSnapshot>();
    readonly #description = BufferDesc.at(Memory.alloc(BufferDesc.size));
    readonly #textureDescription = Texture2DDesc.at(Memory.alloc(Texture2DDesc.size));
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

    prefetchTextures(textures: RetainedTexture[]): void {
        const staged: StagedTexture[] = [];
        try {
            for (const texture of textures) {
                staged.push({ texture, staging: this.#stagedCopyOf(texture) });
            }
            for (const { texture, staging } of staged) {
                this.#textureSnapshots.set(texture.handle.toString(), this.#mappedTexture(staging, texture));
            }
        } catch (error) {
            for (const texture of textures.filter(texture => !this.#textureSnapshots.has(texture.handle.toString()))) {
                this.#textureSnapshots.set(texture.handle.toString(), error as Error);
            }
        } finally {
            for (const { staging } of staged) {
                release(staging);
            }
        }
    }

    readTexture(texture: RetainedTexture): ArrayBuffer {
        const snapshot = this.#textureSnapshots.get(texture.handle.toString());
        if (snapshot === undefined) {
            throw new Error(`${texture.handle} can only be read while the process draws`);
        }
        if (snapshot instanceof Error) {
            throw snapshot;
        }
        return snapshot;
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

    #stagedCopyOf(texture: RetainedTexture): NativePointer {
        const { width, height, resourceFormat } = texture.description;
        const description = this.#textureDescription;
        description.width = width;
        description.height = height;
        description.mipLevels = 1;
        description.arraySize = 1;
        description.format = resourceFormat;
        description.sampleCount = 1;
        description.sampleQuality = 0;
        description.usage = USAGE_STAGING;
        description.bindFlags = 0;
        description.cpuAccessFlags = CPU_ACCESS_READ;
        description.miscFlags = 0;
        const result = comMethod(this.#device, deviceSlots.createTexture2D, "int", ["pointer", "pointer", "pointer"])(this.#device,
            description.$address, NULL, this.#createdStaging);
        if (!succeeded(result)) {
            throw new Error(`a ${width} × ${height} staging texture could not be made: 0x${(result >>> 0).toString(16)}`);
        }
        const staging = this.#createdStaging.readPointer();
        comMethod(this.#context, contextSlots.copySubresourceRegion, "void",
            ["pointer", "uint32", "uint32", "uint32", "uint32", "pointer", "uint32", "pointer"])(this.#context, staging, 0, 0, 0, 0,
            texture.handle, 0, NULL);
        return staging;
    }

    #mappedTexture(staging: NativePointer, texture: RetainedTexture): ArrayBuffer {
        const mapping = this.#mapping;
        const result = comMethod(this.#context, contextSlots.map, "int", ["pointer", "uint32", "uint32", "uint32", "pointer"])(
            this.#context, staging, 0, MAP_READ, 0, mapping.$address);
        if (!succeeded(result)) {
            throw new Error(`${texture.handle} could not be read back: 0x${(result >>> 0).toString(16)}`);
        }
        try {
            const { rowBytes, rows } = texture.description.packing!;
            const pitch = mapping.rowPitch;
            const pitched = new Uint8Array(mapping.data.readByteArray(pitch * (rows - 1) + rowBytes)!);
            const packed = new Uint8Array(rowBytes * rows);
            for (let row = 0; row !== rows; row++) {
                packed.set(pitched.subarray(row * pitch, row * pitch + rowBytes), row * rowBytes);
            }
            return packed.buffer;
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
