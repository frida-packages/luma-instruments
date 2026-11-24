import { describeLayout, type Bounds, type Mesh } from "./mesh.js";
import { compact, learnedFrom, meshTitle, sizeOf, whyUnreadable } from "./mesh-table.js";

type MeshView = CustomInstrumentWidgetMap["mesh"];
type Console = CustomInstrumentWidgetMap["viewer"];

type Picture = { kind: "shown" } | { kind: "not-shown"; reason: string };

const LARGEST_VIEW_DATA = 64 * 1048576;
const BYTES_PER_VERTEX = 12;
const BYTES_PER_TRIANGLE = 12;

export class MeshDisplay {
    readonly #view: MeshView;
    readonly #console: Console;

    constructor(view: MeshView, console: Console) {
        this.#view = view;
        this.#console = console;
    }

    showMesh(mesh: Mesh): void {
        const picture = this.#picture(mesh);
        if (picture.kind === "not-shown") {
            this.#console.appendError(picture.reason);
        }
        this.#console.appendOutput(summaryOf(mesh, picture));
    }

    #picture(mesh: Mesh): Picture {
        if (mesh.positions === null) {
            return { kind: "not-shown", reason: `${meshTitle(mesh)} has nothing to show. ${whyUnreadable(mesh)}.` };
        }
        const triangles = (mesh.indices !== null) ? mesh.indices.length / 3 : 0;
        const size = mesh.vertexCount * BYTES_PER_VERTEX + triangles * BYTES_PER_TRIANGLE;
        if (size > LARGEST_VIEW_DATA) {
            return {
                kind: "not-shown",
                reason: `${meshTitle(mesh)} is too large to show: its positions and indices take ${mebibytes(size)} MiB, `
                    + `more than the ${mebibytes(LARGEST_VIEW_DATA)} MiB a view can be handed.`,
            };
        }
        const data = new ArrayBuffer(size);
        new Float32Array(data, 0, mesh.vertexCount * 3).set(mesh.positions);
        if (mesh.indices !== null) {
            new Uint32Array(data, mesh.vertexCount * BYTES_PER_VERTEX, triangles * 3).set(mesh.indices);
        }
        this.#view.setState({ vertices: mesh.vertexCount, triangles, title: `${meshTitle(mesh)} · ${mesh.api}` }, data);
        this.#view.sendEvent({ say: learnedFrom(mesh) });
        return { kind: "shown" };
    }
}

function summaryOf(mesh: Mesh, picture: Picture): string {
    const evidence = (mesh.evidence === "drawn") ? "seen drawn" : "found in memory, never seen drawn";
    const lines = [`${meshTitle(mesh)}: ${mesh.api} mesh, ${evidence}`];
    if (picture.kind === "not-shown") {
        lines.push(countsOf(mesh));
    }
    if (mesh.bounds !== null) {
        lines.push(boundsOf(mesh.bounds));
    }
    if (mesh.layout !== null) {
        lines.push(`Positions: ${describeLayout(mesh.layout)}; ${mesh.layout.source}`);
    }
    lines.push(`Vertex buffer: ${placementText(mesh.vertexBuffer)}`);
    if (mesh.indexBuffer !== null) {
        lines.push(`Index buffer: ${placementText(mesh.indexBuffer)}`);
    }
    return lines.join("\n");
}

function countsOf(mesh: Mesh): string {
    const indices = (mesh.indexFormat !== null) ? `, ${mesh.indexFormat} indices` : ", not indexed";
    const vertices = (mesh.vertexCount !== 0) ? `${mesh.vertexCount} vertices, ` : "";
    const primitives = (mesh.topology === "point-list") ? "drawn as points" : `${mesh.triangleCount} triangles`;
    return `${vertices}${primitives} (${mesh.topology}${indices})`;
}

function boundsOf(bounds: Bounds): string {
    const center = [0, 1, 2].map(axis => (bounds.min[axis] + bounds.max[axis]) / 2) as [number, number, number];
    return `Bounds: ${point(bounds.min)} to ${point(bounds.max)}, size ${sizeOf(bounds)}, center ${point(center)}`;
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
