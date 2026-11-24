import { addRef, comMethod, guid, release, succeeded } from "./com-methods.js";
import { BufferDesc } from "./d3d11-descriptions.pat";
import { bufferSlots, isReferencedFromBehind, readPointerOrNull, type BufferClass } from "./d3d11-runtime.js";
import type { BufferAccess, GpuBuffer } from "./graphics-backend.js";

export const API = "Direct3D 11";

export interface BufferDescription {
    byteLength: number;
    usage: number;
    bindFlags: number;
    device: NativePointer;
    label: string | null;
}

export interface RetainedBuffer {
    handle: NativePointer;
    description: BufferDescription;
}

export interface BufferContents {
    read(buffer: RetainedBuffer, offset: number, length: number): ArrayBuffer;
}

const BIND_VERTEX_BUFFER = 0x1;
const BIND_INDEX_BUFFER = 0x2;
const USAGE_STAGING = 3;
const LONGEST_LABEL = 256;
const WKPDID_D3D_DEBUG_OBJECT_NAME = guid("429b8c22-9188-4b0c-8742-acb0bf85c200");

export class D3D11Buffer implements GpuBuffer {
    readonly api = API;
    readonly id: string;
    readonly address: string;
    readonly label: string | null;
    readonly byteLength: number;
    readonly access: BufferAccess = "cpu-readable";
    readonly creationOrder: number;
    readonly #retained: RetainedBuffer;
    readonly #contents: BufferContents;

    constructor(retained: RetainedBuffer, contents: BufferContents) {
        this.#retained = retained;
        this.#contents = contents;
        this.id = `${API}:${retained.handle}`;
        this.address = retained.handle.toString();
        this.label = retained.description.label;
        this.byteLength = retained.description.byteLength;
        this.creationOrder = Number(retained.handle.toString());
    }

    read(offset: number, length: number): ArrayBuffer {
        if (offset < 0 || length < 0 || offset + length > this.byteLength) {
            throw new Error(`read of ${length} bytes at ${offset} is outside ${this.address}, which holds ${this.byteLength}`);
        }
        return this.#contents.read(this.#retained, offset, length);
    }
}

export class BufferDescriber {
    readonly #description = BufferDesc.at(Memory.alloc(BufferDesc.size));
    readonly #device = Memory.alloc(Process.pointerSize);
    readonly #labelSize = Memory.alloc(4);
    readonly #label = Memory.alloc(LONGEST_LABEL);

    retainLive(candidates: NativePointer[], bufferClass: BufferClass): RetainedBuffer[] {
        const retained: RetainedBuffer[] = [];
        for (const address of candidates) {
            if (!isLive(address, bufferClass)) {
                continue;
            }
            const buffer = this.retain(address);
            if (mayHoldMesh(buffer.description)) {
                retained.push(buffer);
            } else {
                release(address);
            }
        }
        return retained;
    }

    retain(handle: NativePointer): RetainedBuffer {
        addRef(handle);
        return { handle, description: this.#describe(handle) };
    }

    #describe(handle: NativePointer): BufferDescription {
        const description = this.#description;
        comMethod(handle, bufferSlots.getDesc, "void", ["pointer"])(handle, description.$address);
        comMethod(handle, bufferSlots.getDevice, "void", ["pointer"])(handle, this.#device);
        const device = this.#device.readPointer();
        release(device);
        return {
            byteLength: description.byteWidth,
            usage: description.usage,
            bindFlags: description.bindFlags,
            device,
            label: this.#labelOf(handle),
        };
    }

    #labelOf(handle: NativePointer): string | null {
        this.#labelSize.writeU32(LONGEST_LABEL);
        const result = comMethod(handle, bufferSlots.getPrivateData, "int", ["pointer", "pointer", "pointer"])(handle,
            WKPDID_D3D_DEBUG_OBJECT_NAME, this.#labelSize, this.#label);
        if (!succeeded(result)) {
            return null;
        }
        return this.#label.readUtf8String(this.#labelSize.readU32())!.replace(/\0+$/, "") || null;
    }
}

export function candidateBuffers({ vtable }: BufferClass): NativePointer[] {
    return Memory.findPointers(Process.enumerateRanges("rw-"), [vtable]).map(({ address }) => address);
}

export function releaseAll(buffers: RetainedBuffer[]): void {
    for (const { handle } of buffers) {
        release(handle);
    }
}

function isLive(candidate: NativePointer, { signature }: BufferClass): boolean {
    return signature.every(({ offset, value }) => readPointerOrNull(candidate.add(offset))?.equals(value) === true)
        && isReferencedFromBehind(candidate);
}

function mayHoldMesh(description: BufferDescription): boolean {
    return (description.bindFlags & (BIND_VERTEX_BUFFER | BIND_INDEX_BUFFER)) !== 0 && description.usage !== USAGE_STAGING;
}
