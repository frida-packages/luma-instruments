import { describeLayout, type Bounds, type Mesh } from "./mesh.js";
import type { CatalogListener } from "./mesh-catalog.js";
import type { Settings } from "./settings.js";

type MeshTableWidget = CustomInstrumentWidgetMap["meshes"];

const FLUSH_DELAY_MS = 100;
const missing = "—";

export class MeshTable implements CatalogListener {
    private readonly shown = new Set<number>();
    private readonly changed = new Map<number, Mesh | null>();
    private pendingFlush: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly table: MeshTableWidget, private readonly settings: Settings) {
        table.clear();
    }

    meshAdmitted(mesh: Mesh): void {
        this.changed.set(mesh.id, mesh);
        this.scheduleFlush();
    }

    meshRemoved(mesh: Mesh): void {
        this.changed.set(mesh.id, null);
        this.scheduleFlush();
    }

    refilter(meshes: Mesh[]): void {
        for (const mesh of meshes) {
            this.changed.set(mesh.id, mesh);
        }
        this.scheduleFlush();
    }

    dispose(): void {
        if (this.pendingFlush !== null) {
            clearTimeout(this.pendingFlush);
            this.flush();
        }
    }

    private scheduleFlush(): void {
        if (this.pendingFlush === null) {
            this.pendingFlush = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
        }
    }

    private flush(): void {
        this.pendingFlush = null;
        for (const [id, mesh] of this.changed) {
            if (mesh !== null && this.isVisible(mesh)) {
                this.table.upsertRow({ id: String(id), cells: cellsOf(mesh) });
                this.shown.add(id);
            } else if (this.shown.delete(id)) {
                this.table.removeRow(String(id));
            }
        }
        this.changed.clear();
    }

    private isVisible(mesh: Mesh): boolean {
        const enoughVertices = mesh.contents !== "cpu-visible" || mesh.vertexCount >= this.settings.minimumVertices;
        const confidentEnough = mesh.evidence === "drawn" || mesh.layout!.confidence >= this.settings.minimumConfidence;
        return enoughVertices && confidentEnough;
    }
}

function cellsOf(mesh: Mesh) {
    return {
        mesh: meshTitle(mesh),
        api: mesh.api,
        vertices: (mesh.contents !== "cpu-visible" && mesh.vertexCount === 0) ? missing : String(mesh.vertexCount),
        triangles: (mesh.topology === "point-list") ? "points" : String(mesh.triangleCount),
        size: (mesh.bounds !== null) ? sizeOf(mesh.bounds) : missing,
        layout: layoutCell(mesh),
        learned: learnedFrom(mesh),
        buffers: buffersCell(mesh),
    };
}

export function meshTitle(mesh: Mesh): string {
    return (mesh.label !== null) ? `#${mesh.id} ${mesh.label}` : `#${mesh.id}`;
}

export function sizeOf(bounds: Bounds): string {
    return [0, 1, 2].map(axis => compact(bounds.max[axis] - bounds.min[axis])).join(" × ");
}

function layoutCell(mesh: Mesh): string {
    const indices = (mesh.indexFormat !== null) ? `, ${mesh.indexFormat} indices` : "";
    return (mesh.layout !== null) ? `${describeLayout(mesh.layout)}${indices}` : `${mesh.topology}${indices}`;
}

export function learnedFrom(mesh: Mesh): string {
    if (mesh.contents === "gpu-only") {
        return "draw; GPU-only storage, no CPU contents";
    }
    if (mesh.contents === "unlocated") {
        return "draw; bound to memory before Mesh Finder was added, no CPU contents";
    }
    const layout = mesh.layout!;
    if (mesh.evidence === "found") {
        return `buffer contents, guessed (${percent(layout.confidence)})`;
    }
    return (layout.knowledge === "declared") ? `draw, ${layout.source}` : `draw, layout guessed (${percent(layout.confidence)})`;
}

export function whyUnreadable(mesh: Mesh): string {
    return (mesh.contents === "unlocated")
        ? "Its buffers were bound to memory before Mesh Finder was added"
        : "Its buffers are in GPU-only storage";
}

function buffersCell(mesh: Mesh): string {
    const vertices = `vertices ${mesh.vertexBuffer.address}+${mesh.vertexBuffer.offset}`;
    return (mesh.indexBuffer !== null) ? `${vertices}, indices ${mesh.indexBuffer.address}+${mesh.indexBuffer.offset}` : vertices;
}

export function compact(value: number): string {
    return String(Number(value.toPrecision(4)));
}

function percent(confidence: number): string {
    return `${Math.round(confidence * 100)}%`;
}
