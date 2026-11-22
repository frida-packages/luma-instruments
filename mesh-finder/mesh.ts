import { gatherPositions, sequentialIndices, triangleList } from "./geometry-kernels.js";
import type { GpuBuffer, IndexFormat, Topology } from "./graphics-backend.js";
import { formatName, type PositionFormat } from "./vertex-format.js";

export type Evidence = "drawn" | "found";

export type LayoutKnowledge = "declared" | "guessed";

export type Contents = "cpu-visible" | "gpu-only" | "unlocated";

export type Unreadable = Exclude<Contents, "cpu-visible">;

export interface Mesh {
    id: number;
    identity: string;
    api: string;
    label: string | null;
    evidence: Evidence;
    contents: Contents;
    topology: Topology;
    positions: Float32Array | null;
    indices: Uint32Array | null;
    vertexCount: number;
    triangleCount: number;
    bounds: Bounds | null;
    layout: VertexLayout | null;
    indexFormat: IndexFormat | null;
    vertexBuffer: BufferPlacement;
    indexBuffer: BufferPlacement | null;
}

export interface Bounds {
    min: [number, number, number];
    max: [number, number, number];
}

export interface VertexLayout {
    stride: number;
    offset: number;
    format: PositionFormat;
    knowledge: LayoutKnowledge;
    confidence: number;
    source: string;
}

export interface BufferPlacement {
    id: string;
    address: string;
    label: string | null;
    byteLength: number;
    offset: number;
}

export interface MeshSpec {
    identity: string;
    api: string;
    evidence: Evidence;
    topology: Topology;
    layout: VertexLayout;
    vertexBuffer: BufferPlacement;
    vertexBytes: ArrayBuffer;
    vertexCount: number;
    firstVertex: number;
    indices: IndexSpec | null;
}

export interface IndexSpec {
    bytes: ArrayBuffer;
    format: IndexFormat;
    placement: BufferPlacement;
}

export interface UnreadableSpec {
    identity: string;
    api: string;
    contents: Unreadable;
    topology: Topology;
    vertexBuffer: BufferPlacement;
    indexBuffer: BufferPlacement | null;
    indexFormat: IndexFormat | null;
    vertexCount: number;
    primitiveCount: number;
}

export type UnnumberedMesh = Omit<Mesh, "id">;

export function buildMesh(spec: MeshSpec): UnnumberedMesh | null {
    const { layout } = spec;
    const gathered = gatherPositions(spec.vertexBytes, spec.vertexCount, layout.stride, layout.format);
    if (gathered.nonFinite === spec.vertexCount) {
        return null;
    }
    const indices = (spec.topology === "point-list") ? null : triangleIndices(spec);
    return {
        identity: spec.identity,
        api: spec.api,
        label: spec.vertexBuffer.label ?? spec.indices?.placement.label ?? null,
        evidence: spec.evidence,
        contents: "cpu-visible",
        topology: spec.topology,
        positions: gathered.positions,
        indices,
        vertexCount: spec.vertexCount,
        triangleCount: (indices !== null) ? indices.length / 3 : 0,
        bounds: { min: gathered.min, max: gathered.max },
        layout,
        indexFormat: spec.indices?.format ?? null,
        vertexBuffer: spec.vertexBuffer,
        indexBuffer: spec.indices?.placement ?? null,
    };
}

export function unreadableMesh(spec: UnreadableSpec): UnnumberedMesh {
    return {
        identity: spec.identity,
        api: spec.api,
        label: spec.vertexBuffer.label ?? spec.indexBuffer?.label ?? null,
        evidence: "drawn",
        contents: spec.contents,
        topology: spec.topology,
        positions: null,
        indices: null,
        vertexCount: spec.vertexCount,
        triangleCount: spec.primitiveCount,
        bounds: null,
        layout: null,
        indexFormat: spec.indexFormat,
        vertexBuffer: spec.vertexBuffer,
        indexBuffer: spec.indexBuffer,
    };
}

export function placementOf(buffer: GpuBuffer, offset: number): BufferPlacement {
    return { id: buffer.id, address: buffer.address, label: buffer.label, byteLength: buffer.byteLength, offset };
}

export function describeLayout(layout: VertexLayout): string {
    return `${formatName(layout.format)} at +${layout.offset}, stride ${layout.stride}`;
}

export function primitiveCount(topology: Topology, indexCount: number): number {
    switch (topology) {
        case "triangle-list":
            return Math.floor(indexCount / 3);
        case "triangle-strip":
        case "triangle-fan":
            return Math.max(indexCount - 2, 0);
        case "point-list":
            return 0;
    }
}

function triangleIndices(spec: MeshSpec): Uint32Array {
    if (spec.indices !== null) {
        return triangleList(spec.indices.bytes, spec.indices.format, spec.topology, spec.firstVertex);
    }
    return triangleList(sequentialIndices(spec.vertexCount), "uint32", spec.topology, 0);
}
