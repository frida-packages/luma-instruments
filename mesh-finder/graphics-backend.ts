import type { TextureFormat } from "./texture-format.js";
import type { AttributeFormat } from "./vertex-format.js";

export interface GraphicsBackendFactory {
    readonly api: string;
    readonly libraries: RegExp;
    readonly activation: Activation;
    create(observer: GeometryObserver): GraphicsBackend;
}

export type Activation = "while-loading" | "after-loading";

export interface GraphicsBackend {
    readonly api: string;
    watchDraws(): void;
    unwatchDraws(): void;
    findBuffers(): Promise<BufferSearch>;
    dispose(): void;
}

export interface BufferSearch {
    buffers: number;
    detail: string;
}

export interface GeometryObserver {
    observeDraw(draw: DrawCall): void;
    observeBuffers(buffers: GpuBuffer[]): void;
    observeScratchBuffer(id: string): void;
}

export interface GpuBuffer {
    readonly api: string;
    readonly id: string;
    readonly address: string;
    readonly label: string | null;
    readonly byteLength: number;
    readonly access: BufferAccess;
    readonly creationOrder: number;
    read(offset: number, length: number): ArrayBuffer;
}

export type BufferAccess = "cpu-readable" | "gpu-only" | "unlocated";

export type Topology = "triangle-list" | "triangle-strip" | "triangle-fan" | "point-list";

export type IndexFormat = "uint8" | "uint16" | "uint32";

export interface DrawCall {
    api: string;
    topology: Topology;
    streams: VertexStream[];
    bystanders: GpuBuffer[];
    position: AttributeLayout | null;
    texcoord: AttributeLayout | null;
    textures: TextureBinding[];
    indices: IndexBinding | null;
    firstVertex: number;
    vertexCount: number;
    baseVertex: number;
    noteSlotGuess(slot: number): void;
}

export interface VertexStream {
    slot: number;
    buffer: GpuBuffer;
    offset: number;
    stride: number | null;
}

export interface TextureBinding {
    slot: number;
    name: string | null;
    texture: GpuTexture;
}

export interface GpuTexture {
    readonly api: string;
    readonly id: string;
    readonly address: string;
    readonly label: string | null;
    readonly width: number;
    readonly height: number;
    readonly format: TextureFormat | null;
    readonly formatName: string;
    readonly access: BufferAccess;
    read(): ArrayBuffer;
}

export interface AttributeLayout {
    slot: number;
    stride: number;
    offset: number;
    format: AttributeFormat;
    source: string;
}

export interface IndexBinding {
    buffer: GpuBuffer;
    offset: number;
    format: IndexFormat;
    count: number;
}
