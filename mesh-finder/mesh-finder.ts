import { indexRange, indexWidths } from "./geometry-kernels.js";
import type { DrawCall, GeometryObserver, GpuBuffer, IndexBinding, AttributeLayout, VertexStream } from "./graphics-backend.js";
import { guessDrawLayout, type VertexSpan } from "./layout-guess.js";
import { texturesOf, type MeshTexture } from "./material.js";
import {
    buildMesh,
    placementOf,
    primitiveCount,
    unreadableMesh,
    type Evidence,
    type MeshSpec,
    type TexcoordSpec,
    type Unreadable,
    type VertexLayout,
} from "./mesh.js";
import { rankOf, type MeshCatalog } from "./mesh-catalog.js";
import type { Settings } from "./settings.js";
import { guessTexcoords } from "./texcoord-guess.js";
import type { TextureCatalog } from "./texture-catalog.js";
import { analyzeUndrawnBuffers, snapshotCandidates } from "./undrawn-buffers.js";
import { formatSize } from "./vertex-format.js";

export interface FinderProgress {
    note(text: string): void;
}

interface PlacedPositions {
    stream: VertexStream;
    layout: VertexLayout;
}

type Work = Generator<void, void, void>;

const SLICE_BUDGET_MS = 8;
const PAUSE_BETWEEN_SLICES_MS = 4;

export class MeshFinder implements GeometryObserver {
    readonly #catalog: MeshCatalog;
    readonly #textures: TextureCatalog;
    readonly #settings: Settings;
    readonly #progress: FinderProgress;
    readonly #work: Record<Evidence, Work[]> = { drawn: [], found: [] };
    #scheduled: ReturnType<typeof setTimeout> | null = null;
    #unreadableDraws = 0;

    constructor(
        catalog: MeshCatalog,
        textures: TextureCatalog,
        settings: Settings,
        progress: FinderProgress,
    ) {
        this.#catalog = catalog;
        this.#textures = textures;
        this.#settings = settings;
        this.#progress = progress;
    }

    observeDraw(draw: DrawCall): void {
        try {
            this.#captureDraw(draw);
        } catch (error) {
            this.#unreadableDraws++;
            if (this.#unreadableDraws === 1) {
                this.#progress.note(`A draw's buffers could not be read: ${(error as Error).message}`);
            }
        }
    }

    observeBuffers(buffers: GpuBuffer[]): void {
        if (!this.#settings.guessUndrawn) {
            return;
        }
        const undrawn = buffers.filter(buffer => !this.#catalog.isDrawn(buffer.id));
        const snapshots = snapshotCandidates(undrawn);
        const megabytes = snapshots.buffers.reduce((sum, snapshot) => sum + snapshot.byteLength, 0) / 1048576;
        const unreadable = (snapshots.unreadable !== 0) ? `, ${snapshots.unreadable} could not be read` : "";
        this.#progress.note(`Read ${snapshots.buffers.length} of ${buffers.length} buffers (${megabytes.toFixed(1)} MiB) that may hold `
            + `meshes${unreadable}.`);
        this.#enqueue("found", analyzeUndrawnBuffers(snapshots.buffers, this.#catalog, this.#progress));
    }

    observeScratchBuffer(id: string): void {
        this.#catalog.noteScratch(id);
    }

    dispose(): void {
        if (this.#scheduled !== null) {
            clearTimeout(this.#scheduled);
            this.#scheduled = null;
        }
        this.#work.drawn.length = 0;
        this.#work.found.length = 0;
    }

    #captureDraw(draw: DrawCall): void {
        this.#catalog.noteDrawn(bufferIdsOf(draw));
        const indexBytes = (draw.indices !== null && draw.indices.buffer.access === "cpu-readable") ? readIndices(draw.indices) : null;
        const span = vertexSpanOf(draw, indexBytes);
        if (span === null) {
            return;
        }
        const positions = (draw.position !== null) ? declaredPositions(draw, draw.position) : this.#guessedPositions(draw, span);
        const textureIds = draw.textures.map(binding => binding.texture.id);
        if (positions === null || !this.#catalog.wants(identityOf(draw, positions.stream, span), rankOf(drawnWith(positions.layout)), textureIds)) {
            return;
        }
        if (positions.stream.buffer.access !== "cpu-readable" || (draw.indices !== null && indexBytes === null)) {
            this.#captureUnreadable(draw, positions.stream, span);
            return;
        }
        const textures = this.#texturesOf(draw);
        this.#enqueue("drawn", this.#admitDrawn(drawnMeshSpec(draw, positions, span, indexBytes, texcoordSpecOf(draw, positions, span), textures)));
    }

    #guessedPositions(draw: DrawCall, span: VertexSpan): PlacedPositions | null {
        const guess = guessDrawLayout(draw.streams, span);
        if (guess === null) {
            if (draw.streams.every(stream => stream.buffer.access !== "cpu-readable")) {
                this.#captureUnreadable(draw, draw.streams[0], span);
            }
            return null;
        }
        draw.noteSlotGuess(guess.slot);
        return {
            stream: draw.streams.find(stream => stream.slot === guess.slot)!,
            layout: { stride: guess.stride, offset: guess.offset, format: guess.format, knowledge: "guessed", confidence: guess.confidence,
                source: guess.reason },
        };
    }

    #captureUnreadable(draw: DrawCall, stream: VertexStream | undefined, span: VertexSpan): void {
        if (stream === undefined) {
            return;
        }
        const indexed = draw.indices !== null;
        const elementCount = indexed ? draw.indices!.count : draw.vertexCount;
        this.#catalog.admit(unreadableMesh({
            identity: unreadableIdentityOf(draw, span),
            api: draw.api,
            contents: unreadableContentsOf([stream.buffer, draw.indices?.buffer]),
            topology: draw.topology,
            vertexBuffer: placementOf(stream.buffer, stream.offset),
            indexBuffer: indexed ? placementOf(draw.indices!.buffer, draw.indices!.offset) : null,
            indexFormat: draw.indices?.format ?? null,
            vertexCount: indexed ? 0 : span.last - span.first + 1,
            primitiveCount: primitiveCount(draw.topology, elementCount),
            textures: this.#texturesOf(draw),
        }));
    }

    #texturesOf(draw: DrawCall): MeshTexture[] {
        return texturesOf(draw.textures.map(binding => ({ slot: binding.slot, name: binding.name,
            texture: this.#textures.capture(binding.texture) })));
    }

    *#admitDrawn(spec: MeshSpec): Work {
        const mesh = buildMesh(spec);
        if (mesh !== null) {
            this.#catalog.admit(mesh);
        }
    }

    #enqueue(evidence: Evidence, work: Work): void {
        this.#work[evidence].push(work);
        if (this.#scheduled === null) {
            this.#scheduled = setTimeout(() => this.#drain(), 0);
        }
    }

    #drain(): void {
        this.#scheduled = null;
        const deadline = Date.now() + SLICE_BUDGET_MS;
        let queue = this.#nextQueue();
        while (queue !== null && Date.now() < deadline) {
            if (queue[0].next().done) {
                queue.shift();
            } else if (queue === this.#work.found) {
                queue.push(queue.shift()!);
            }
            queue = this.#nextQueue();
        }
        if (queue !== null) {
            this.#scheduled = setTimeout(() => this.#drain(), PAUSE_BETWEEN_SLICES_MS);
        }
    }

    #nextQueue(): Work[] | null {
        const { drawn, found } = this.#work;
        return (drawn.length !== 0) ? drawn : (found.length !== 0) ? found : null;
    }
}

function bufferIdsOf(draw: DrawCall): string[] {
    const ids = [...draw.streams.map(stream => stream.buffer.id), ...draw.bystanders.map(buffer => buffer.id)];
    return (draw.indices !== null) ? [...ids, draw.indices.buffer.id] : ids;
}

function readIndices(binding: IndexBinding): ArrayBuffer {
    const length = Math.min(binding.count * indexWidths[binding.format], binding.buffer.byteLength - binding.offset);
    return binding.buffer.read(binding.offset, length - length % indexWidths[binding.format]);
}

function vertexSpanOf(draw: DrawCall, indexBytes: ArrayBuffer | null): VertexSpan | null {
    if (draw.indices === null) {
        return (draw.vertexCount > 0) ? { first: draw.firstVertex, last: draw.firstVertex + draw.vertexCount - 1 } : null;
    }
    if (indexBytes === null) {
        return { first: 0, last: 0 };
    }
    const range = indexRange(indexBytes, draw.indices.format, draw.topology);
    return (range !== null) ? { first: range.min + draw.baseVertex, last: range.max + draw.baseVertex } : null;
}

function declaredPositions(draw: DrawCall, declared: AttributeLayout): PlacedPositions | null {
    const stream = draw.streams.find(candidate => candidate.slot === declared.slot);
    if (stream === undefined) {
        return null;
    }
    return { stream, layout: declaredLayout(stream, declared) };
}

function declaredLayout(stream: VertexStream, declared: AttributeLayout): VertexLayout {
    return { stride: stream.stride ?? declared.stride, offset: declared.offset, format: declared.format, knowledge: "declared",
        confidence: 1, source: declared.source };
}

function identityOf(draw: DrawCall, stream: VertexStream, span: VertexSpan): string {
    return `${draw.api}|${stream.buffer.id}+${stream.offset}|${span.first}-${span.last}|${elementCountOf(draw)}|${draw.topology}`;
}

function elementCountOf(draw: DrawCall): number {
    return (draw.indices !== null) ? draw.indices.count : draw.vertexCount;
}

function drawnWith(layout: VertexLayout) {
    return { evidence: "drawn", contents: "cpu-visible", layout } as const;
}

function unreadableIdentityOf(draw: DrawCall, span: VertexSpan): string {
    const source = (draw.indices !== null && draw.indices.buffer.access !== "cpu-readable")
        ? `${draw.indices.buffer.id}+${draw.indices.offset}|${draw.baseVertex}`
        : `${draw.streams[0].buffer.id}+${draw.streams[0].offset}|${span.first}-${span.last}`;
    return `${draw.api}|unreadable|${source}|${elementCountOf(draw)}`;
}

function unreadableContentsOf(buffers: (GpuBuffer | undefined)[]): Unreadable {
    return buffers.some(buffer => buffer?.access === "unlocated") ? "unlocated" : "gpu-only";
}

function drawnMeshSpec(
    draw: DrawCall,
    { stream, layout }: PlacedPositions,
    span: VertexSpan,
    indexBytes: ArrayBuffer | null,
    texcoords: TexcoordSpec | null,
    textures: MeshTexture[],
): MeshSpec {
    return {
        identity: identityOf(draw, stream, span),
        api: draw.api,
        evidence: "drawn",
        topology: draw.topology,
        layout,
        vertexBuffer: placementOf(stream.buffer, stream.offset),
        vertexBytes: spanBytes(stream, layout, span),
        vertexCount: span.last - span.first + 1,
        firstVertex: span.first - ((draw.indices !== null) ? draw.baseVertex : 0),
        indices: (draw.indices !== null)
            ? { bytes: indexBytes!, format: draw.indices.format, placement: placementOf(draw.indices.buffer, draw.indices.offset) }
            : null,
        texcoords,
        textures,
    };
}

function texcoordSpecOf(draw: DrawCall, positions: PlacedPositions, span: VertexSpan): TexcoordSpec | null {
    const declared = draw.texcoord;
    if (declared === null) {
        return (draw.textures.length !== 0) ? guessedTexcoordSpecOf(positions, span) : null;
    }
    const stream = draw.streams.find(candidate => candidate.slot === declared.slot);
    if (stream === undefined || stream.buffer.access !== "cpu-readable") {
        return null;
    }
    const layout = declaredLayout(stream, declared);
    return { layout, bytes: spanBytes(stream, layout, span) };
}

function guessedTexcoordSpecOf({ stream, layout: positions }: PlacedPositions, span: VertexSpan): TexcoordSpec | null {
    const layout = guessTexcoords(stream, positions, span);
    return (layout !== null) ? { layout, bytes: spanBytes(stream, layout, span) } : null;
}

function spanBytes(stream: VertexStream, layout: VertexLayout, span: VertexSpan): ArrayBuffer {
    const vertexCount = span.last - span.first + 1;
    return stream.buffer.read(stream.offset + span.first * layout.stride + layout.offset,
        (vertexCount - 1) * layout.stride + formatSize(layout.format));
}
