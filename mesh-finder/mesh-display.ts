import { describeLayout, type Bounds, type Mesh } from "./mesh.js";
import { compact, learnedFrom, meshTitle, sizeOf, whyUnreadable } from "./mesh-table.js";

type MeshView = CustomInstrumentWidgetMap["mesh"];

export type Picture = { kind: "shown" } | { kind: "not-shown"; reason: string };

const LARGEST_VIEW_DATA = 64 * 1048576;
const BYTES_PER_VERTEX = 12;
const BYTES_PER_TRIANGLE = 12;

export class MeshDisplay {
    readonly #view: MeshView;
    #selected: Mesh | null = null;

    constructor(view: MeshView) {
        this.#view = view;
        view.setActionEnabled("obj", false);
    }

    get selected(): Mesh | null {
        return this.#selected;
    }

    showMesh(mesh: Mesh): Picture {
        this.#selected = mesh;
        this.#view.setActionEnabled("obj", true);
        const title = `${meshTitle(mesh)} · ${mesh.api}`;
        const details = detailsOf(mesh);
        const picture = pictureOf(mesh);
        if (picture.kind === "not-shown") {
            this.#view.setState({ vertices: 0, triangles: 0, title, details, unshown: picture.reason });
            return picture;
        }
        const triangles = (mesh.indices !== null) ? mesh.indices.length / 3 : 0;
        this.#view.setState({ vertices: mesh.vertexCount, triangles, title, details }, viewDataOf(mesh, triangles));
        this.#view.sendEvent({ say: learnedFrom(mesh) });
        return picture;
    }
}

function pictureOf(mesh: Mesh): Picture {
    if (mesh.positions === null) {
        return { kind: "not-shown", reason: `Nothing to show. ${whyUnreadable(mesh)}.` };
    }
    const size = viewDataSize(mesh, (mesh.indices !== null) ? mesh.indices.length / 3 : 0);
    if (size > LARGEST_VIEW_DATA) {
        return {
            kind: "not-shown",
            reason: `Too large to show: its positions and indices take ${mebibytes(size)} MiB, `
                + `more than the ${mebibytes(LARGEST_VIEW_DATA)} MiB a view can be handed.`,
        };
    }
    return { kind: "shown" };
}

function viewDataOf(mesh: Mesh, triangles: number): ArrayBuffer {
    const data = new ArrayBuffer(viewDataSize(mesh, triangles));
    new Float32Array(data, 0, mesh.vertexCount * 3).set(mesh.positions!);
    if (mesh.indices !== null) {
        new Uint32Array(data, mesh.vertexCount * BYTES_PER_VERTEX, triangles * 3).set(mesh.indices);
    }
    return data;
}

function viewDataSize(mesh: Mesh, triangles: number): number {
    return mesh.vertexCount * BYTES_PER_VERTEX + triangles * BYTES_PER_TRIANGLE;
}

function detailsOf(mesh: Mesh): [string, string][] {
    const details: [string, string][] = [
        ["Found", (mesh.evidence === "drawn") ? "seen drawn" : "in memory, never seen drawn"],
        ["Contents", countsOf(mesh)],
    ];
    if (mesh.bounds !== null) {
        details.push(["Bounds", boundsOf(mesh.bounds)]);
    }
    if (mesh.layout !== null) {
        details.push(["Positions", `${describeLayout(mesh.layout)}; ${mesh.layout.source}`]);
    }
    details.push(["Vertex buffer", placementText(mesh.vertexBuffer)]);
    if (mesh.indexBuffer !== null) {
        details.push(["Index buffer", placementText(mesh.indexBuffer)]);
    }
    return details;
}

function countsOf(mesh: Mesh): string {
    const indices = (mesh.indexFormat !== null) ? `, ${mesh.indexFormat} indices` : ", not indexed";
    const vertices = (mesh.vertexCount !== 0) ? `${mesh.vertexCount} vertices, ` : "";
    const primitives = (mesh.topology === "point-list") ? "drawn as points" : `${mesh.triangleCount} triangles`;
    return `${vertices}${primitives} (${mesh.topology}${indices})`;
}

function boundsOf(bounds: Bounds): string {
    const center = [0, 1, 2].map(axis => (bounds.min[axis] + bounds.max[axis]) / 2) as [number, number, number];
    return `${point(bounds.min)} to ${point(bounds.max)}, size ${sizeOf(bounds)}, center ${point(center)}`;
}

function placementText(placement: Mesh["vertexBuffer"]): string {
    const label = (placement.label !== null) ? ` "${placement.label}"` : "";
    const size = (placement.byteLength !== 0) ? `${placement.byteLength} bytes` : "size unknown";
    return `${placement.address}${label}, ${size}, used from offset ${placement.offset}`;
}

function mebibytes(size: number): string {
    return compact(size / 1048576);
}

function point(coordinates: [number, number, number]): string {
    return `(${coordinates.map(compact).join(", ")})`;
}
