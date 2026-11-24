import { indexProfile, indexRange, indexWidths, looksLikeMeshData } from "./geometry-kernels.js";
import type { BufferAccess, GpuBuffer, IndexFormat } from "./graphics-backend.js";
import { couldHoldVertices, guessBufferLayout, type GuessedLayout } from "./layout-guess.js";
import { buildMesh, placementOf, type MeshSpec } from "./mesh.js";
import type { MeshCatalog } from "./mesh-catalog.js";
import type { FinderProgress } from "./mesh-finder.js";
import { formatSize } from "./vertex-format.js";

interface IndexCandidate {
    buffer: SnapshotBuffer;
    format: IndexFormat;
    firstVertex: number;
    vertexCount: number;
    density: number;
    bytes: ArrayBuffer;
}

interface Pairing {
    vertices: SnapshotBuffer;
    layout: GuessedLayout;
}

const SMALLEST_BUFFER = 36;
const LARGEST_BUFFER = 64 * 1048576;
const SNAPSHOT_BUDGET = 1024 * 1048576;
const PREFIX_BYTES = 4096;
const DENSEST_UNUSED_SHARE = 0.5;
const TOLERATED_DEGENERATE_SHARE = 0.05;
const LARGEST_RELATIVE_STEP = 0.25;
const LARGEST_VERTEX_COUNT = 1 << 24;
const SMALLEST_POINT_CLOUD = 32;
const HIGHEST_POINT_CLOUD_CONFIDENCE = 0.55;
const MOST_POINT_CLOUD_CANDIDATES = 512;
const MOST_PAIRING_CANDIDATES = 64;
const STATUS_INTERVAL_MS = 2000;

export class SnapshotBuffer implements GpuBuffer {
    readonly api: string;
    readonly id: string;
    readonly address: string;
    readonly label: string | null;
    readonly byteLength: number;
    readonly access: BufferAccess = "cpu-readable";
    readonly creationOrder: number;

    constructor(source: GpuBuffer, readonly bytes: ArrayBuffer) {
        this.api = source.api;
        this.id = source.id;
        this.address = source.address;
        this.label = source.label;
        this.byteLength = bytes.byteLength;
        this.creationOrder = source.creationOrder;
    }

    read(offset: number, length: number): ArrayBuffer {
        if (offset < 0 || offset + length > this.byteLength) {
            throw new Error(`read of ${length} bytes at ${offset} is outside a ${this.byteLength}-byte buffer`);
        }
        return this.bytes.slice(offset, offset + length);
    }
}

export interface Snapshots {
    buffers: SnapshotBuffer[];
    unreadable: number;
}

export function snapshotCandidates(buffers: GpuBuffer[]): Snapshots {
    const snapshots: SnapshotBuffer[] = [];
    let unreadable = 0;
    let budget = SNAPSHOT_BUDGET;
    for (const buffer of buffers) {
        const sized = buffer.byteLength >= SMALLEST_BUFFER && buffer.byteLength <= Math.min(LARGEST_BUFFER, budget);
        if (buffer.access !== "cpu-readable" || !sized) {
            continue;
        }
        try {
            const prefix = buffer.read(0, Math.min(PREFIX_BYTES, buffer.byteLength));
            if (looksLikeMeshData(prefix)) {
                snapshots.push(new SnapshotBuffer(buffer, buffer.read(0, buffer.byteLength)));
                budget -= buffer.byteLength;
            }
        } catch {
            unreadable++;
        }
    }
    return { buffers: snapshots, unreadable };
}

export function* analyzeUndrawnBuffers(snapshots: SnapshotBuffer[], catalog: MeshCatalog, progress: FinderProgress) {
    const status = new AnalysisStatus(snapshots.length, progress);
    const evidentLayouts = new EvidentLayouts();
    const indexCandidates: IndexCandidate[] = [];
    for (const [i, buffer] of snapshots.entries()) {
        if (catalog.isDrawn(buffer.id)) {
            continue;
        }
        const candidate = classifyIndices(buffer);
        if (candidate !== null) {
            indexCandidates.push(candidate);
        }
        status.left(snapshots.length - i);
        yield;
    }
    const indexBuffers = new Set<SnapshotBuffer>(indexCandidates.map(candidate => candidate.buffer));
    const unpaired = new Set(snapshots.filter(buffer => !indexBuffers.has(buffer) && !catalog.isDrawn(buffer.id)));
    indexCandidates.sort((a, b) => b.vertexCount - a.vertexCount);

    let meshes = 0;
    for (const [i, candidate] of indexCandidates.entries()) {
        const pairing = yield* bestPairing(candidate, unpaired, evidentLayouts,
            () => status.left(indexCandidates.length - i + unpaired.size));
        if (pairing !== null) {
            unpaired.delete(pairing.vertices);
            if (admit(catalog, meshSpec(pairing, candidate))) {
                meshes++;
            }
        }
        yield;
    }

    const pointCloudCandidates = [...unpaired].filter(buffer => !catalog.isDrawn(buffer.id))
        .sort((a, b) => b.byteLength - a.byteLength);
    const examined = pointCloudCandidates.slice(0, MOST_POINT_CLOUD_CANDIDATES);
    let pointClouds = 0;
    for (const [i, buffer] of examined.entries()) {
        const layout = evidentLayouts.of(buffer);
        const vertexCount = (layout !== null) ? Math.floor((buffer.byteLength - layout.offset) / layout.stride) : 0;
        if (layout !== null && vertexCount >= SMALLEST_POINT_CLOUD) {
            const capped = { ...layout, confidence: Math.min(layout.confidence, HIGHEST_POINT_CLOUD_CONFIDENCE) };
            if (admit(catalog, pointCloudSpec(buffer, capped, vertexCount))) {
                pointClouds++;
            }
        }
        status.left(examined.length - i);
        yield;
    }
    const skipped = pointCloudCandidates.length - examined.length;
    const unexamined = (skipped !== 0)
        ? ` The ${skipped} smallest buffers that no index buffer fits were not looked at as point clouds.`
        : "";
    progress.note(`Guessed ${meshes} meshes and ${pointClouds} point clouds from ${snapshots.length} buffers no draw was seen using.`
        + unexamined);
}

class EvidentLayouts {
    readonly #layouts = new Map<SnapshotBuffer, GuessedLayout | null>();

    of(buffer: SnapshotBuffer): GuessedLayout | null {
        if (!this.#layouts.has(buffer)) {
            this.#layouts.set(buffer, guessBufferLayout(buffer, null));
        }
        return this.#layouts.get(buffer)!;
    }
}

class AnalysisStatus {
    readonly #total: number;
    readonly #progress: FinderProgress;
    #lastNote = Date.now();

    constructor(total: number, progress: FinderProgress) {
        this.#total = total;
        this.#progress = progress;
    }

    left(buffers: number): void {
        const now = Date.now();
        if (now - this.#lastNote >= STATUS_INTERVAL_MS) {
            this.#lastNote = now;
            this.#progress.note(`Still analyzing ${buffers} of the ${this.#total} buffers no draw was seen using…`);
        }
    }
}

function classifyIndices(buffer: SnapshotBuffer): IndexCandidate | null {
    for (const format of ["uint16", "uint32"] as IndexFormat[]) {
        const width = indexWidths[format];
        const usable = usableIndexCount(buffer, width);
        if (usable < 3) {
            continue;
        }
        const bytes = buffer.read(0, usable * width);
        const range = indexRange(bytes, format, "triangle-list")!;
        if (range.max < 2 || range.max >= LARGEST_VERTEX_COUNT) {
            continue;
        }
        const profile = indexProfile(bytes, format, range.max);
        const vertexCount = range.max + 1;
        const density = profile.distinct / vertexCount;
        if (density >= DENSEST_UNUSED_SHARE
            && profile.degenerateTriangles <= (usable / 3) * TOLERATED_DEGENERATE_SHARE
            && profile.meanStep <= vertexCount * LARGEST_RELATIVE_STEP) {
            return { buffer, format, firstVertex: range.min, vertexCount, density, bytes };
        }
    }
    return null;
}

function usableIndexCount(buffer: SnapshotBuffer, width: number): number {
    const view = new DataView(buffer.bytes);
    const count = Math.floor(buffer.byteLength / width);
    let usable = count - count % 3;
    while (usable >= 3 && isPaddingTriangle(view, usable - 3, width)) {
        usable -= 3;
    }
    return usable;
}

function isPaddingTriangle(view: DataView, first: number, width: number): boolean {
    const indices = [0, 1, 2].map(k => (width === 2) ? view.getUint16((first + k) * 2, true) : view.getUint32((first + k) * 4, true));
    return indices[0] === indices[1] && indices[1] === indices[2];
}

function* bestPairing(candidate: IndexCandidate, vertexBuffers: Set<SnapshotBuffer>, evidentLayouts: EvidentLayouts,
    stepped: () => void): Generator<void, Pairing | null, void> {
    const nearest = [...vertexBuffers].filter(vertices => couldHoldVertices(vertices.byteLength, candidate.vertexCount))
        .sort((a, b) => distance(a, candidate) - distance(b, candidate))
        .slice(0, MOST_PAIRING_CANDIDATES);
    let best: Pairing | null = null;
    for (const vertices of nearest) {
        const layout = guessBufferLayout(vertices, candidate.vertexCount);
        stepped();
        yield;
        if (layout === null) {
            continue;
        }
        const outranks = best === null || layout.confidence > best.layout.confidence
            || (layout.confidence === best.layout.confidence && distance(vertices, candidate) < distance(best.vertices, candidate));
        if (outranks && !contradictsHomogeneousPositions(layout, evidentLayouts.of(vertices))) {
            best = { vertices, layout };
        }
    }
    return best;
}

function contradictsHomogeneousPositions(layout: GuessedLayout, evident: GuessedLayout | null): boolean {
    return evident !== null && evident.format.count === 4 && layout.stride % evident.stride !== 0 && evident.stride % layout.stride !== 0;
}

function distance(vertices: SnapshotBuffer, candidate: IndexCandidate): number {
    return Math.abs(vertices.creationOrder - candidate.buffer.creationOrder);
}

function meshSpec({ vertices, layout }: Pairing, candidate: IndexCandidate): MeshSpec {
    const usedVertices = candidate.vertexCount - candidate.firstVertex;
    const confidence = layout.confidence * (0.85 + 0.15 * candidate.density);
    return {
        identity: `${vertices.id}|${candidate.buffer.id}`,
        api: vertices.api,
        evidence: "found",
        topology: "triangle-list",
        layout: { stride: layout.stride, offset: layout.offset, format: layout.format, knowledge: "guessed", confidence,
            source: `${layout.reason}; paired with a ${candidate.format} index buffer whose largest index is ${candidate.vertexCount - 1}`,
        },
        vertexBuffer: placementOf(vertices, 0),
        vertexBytes: vertices.read(layout.offset + candidate.firstVertex * layout.stride,
            (usedVertices - 1) * layout.stride + formatSize(layout.format)),
        vertexCount: usedVertices,
        firstVertex: candidate.firstVertex,
        indices: { bytes: candidate.bytes, format: candidate.format, placement: placementOf(candidate.buffer, 0) },
    };
}

function pointCloudSpec(buffer: SnapshotBuffer, layout: GuessedLayout, vertexCount: number): MeshSpec {
    return {
        identity: buffer.id,
        api: buffer.api,
        evidence: "found",
        topology: "point-list",
        layout: { stride: layout.stride, offset: layout.offset, format: layout.format, knowledge: "guessed",
            confidence: layout.confidence, source: `${layout.reason}; no index buffer fits it` },
        vertexBuffer: placementOf(buffer, 0),
        vertexBytes: buffer.read(layout.offset, buffer.byteLength - layout.offset),
        vertexCount,
        firstVertex: 0,
        indices: null,
    };
}

function admit(catalog: MeshCatalog, spec: MeshSpec): boolean {
    const mesh = buildMesh(spec);
    return mesh !== null && catalog.admit(mesh) !== null;
}
