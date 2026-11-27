import { baseColorTexture, type MeshTexture } from "./material.js";
import { describeLayout, type Bounds, type Mesh } from "./mesh.js";
import { compact, learnedFrom, meshTitle, sizeOf, textureText, whyUnreadable } from "./mesh-table.js";
import { decodedPixels } from "./texture-catalog.js";
import { fitForView, type ViewPixels } from "./texture-kernels.js";

type MeshView = CustomInstrumentWidgetMap["mesh"];

export type Picture = { kind: "shown" } | { kind: "not-shown"; reason: string };

interface Skin {
    texcoords: Float32Array;
    image: ViewPixels;
}

const LARGEST_VIEW_DATA = 64 * 1048576;
const LARGEST_VIEW_TEXTURE_SIDE = 1024;
const BYTES_PER_VERTEX = 12;
const BYTES_PER_TRIANGLE = 12;
const BYTES_PER_SKINNED_VERTEX = 20;
const BYTES_PER_PIXEL = 4;

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
        const triangles = (mesh.indices !== null) ? mesh.indices.length / 3 : 0;
        const skin = (mesh.positions !== null && triangles !== 0) ? skinOf(mesh) : null;
        const picture = pictureOf(mesh, triangles, skin);
        if (picture.kind === "not-shown") {
            this.#view.setState({ vertices: 0, triangles: 0, title, details, unshown: picture.reason });
            return picture;
        }
        const texture = (skin !== null) ? { width: skin.image.width, height: skin.image.height } : null;
        this.#view.setState({ vertices: mesh.vertexCount, triangles, title, details, texture }, viewDataOf(mesh, triangles, skin));
        this.#view.sendEvent({ say: learnedFrom(mesh) });
        return picture;
    }
}

function skinOf(mesh: Mesh): Skin | null {
    const baseColor = baseColorTexture(mesh.textures);
    if (mesh.texcoords === null || baseColor === undefined) {
        return null;
    }
    const { texture } = baseColor;
    return {
        texcoords: mesh.texcoords,
        image: fitForView(decodedPixels(texture), texture.width, texture.height, LARGEST_VIEW_TEXTURE_SIDE),
    };
}

function pictureOf(mesh: Mesh, triangles: number, skin: Skin | null): Picture {
    if (mesh.positions === null) {
        return { kind: "not-shown", reason: `Nothing to show. ${whyUnreadable(mesh)}.` };
    }
    const size = viewDataSize(mesh, triangles, skin);
    if (size > LARGEST_VIEW_DATA) {
        const contents = (skin !== null) ? "its positions, indices, UVs and texture" : "its positions and indices";
        return {
            kind: "not-shown",
            reason: `Too large to show: ${contents} take ${mebibytes(size)} MiB, `
                + `more than the ${mebibytes(LARGEST_VIEW_DATA)} MiB a view can be handed.`,
        };
    }
    return { kind: "shown" };
}

function viewDataOf(mesh: Mesh, triangles: number, skin: Skin | null): ArrayBuffer {
    const data = new ArrayBuffer(viewDataSize(mesh, triangles, skin));
    new Float32Array(data, 0, mesh.vertexCount * 3).set(mesh.positions!);
    if (mesh.indices !== null) {
        new Uint32Array(data, mesh.vertexCount * BYTES_PER_VERTEX, triangles * 3).set(mesh.indices);
    }
    if (skin !== null) {
        writeSkin(data, plainSize(mesh, triangles), mesh.positions!, skin);
    }
    return data;
}

function viewDataSize(mesh: Mesh, triangles: number, skin: Skin | null): number {
    return plainSize(mesh, triangles) + ((skin !== null) ? skinSize(mesh, skin) : 0);
}

function plainSize(mesh: Mesh, triangles: number): number {
    return mesh.vertexCount * BYTES_PER_VERTEX + triangles * BYTES_PER_TRIANGLE;
}

function skinSize(mesh: Mesh, skin: Skin): number {
    return mesh.vertexCount * BYTES_PER_SKINNED_VERTEX + skin.image.width * skin.image.height * BYTES_PER_PIXEL;
}

function writeSkin(data: ArrayBuffer, offset: number, positions: Float32Array, skin: Skin): void {
    const vertexCount = positions.length / 3;
    const interleaved = new Float32Array(data, offset, vertexCount * 5);
    for (let i = 0; i !== vertexCount; i++) {
        interleaved.set(positions.subarray(i * 3, i * 3 + 3), i * 5);
        interleaved.set(skin.texcoords.subarray(i * 2, i * 2 + 2), i * 5 + 3);
    }
    new Uint8Array(data, offset + vertexCount * BYTES_PER_SKINNED_VERTEX).set(new Uint8Array(skin.image.pixels));
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
    if (mesh.texcoordLayout !== null) {
        details.push(["UVs", `${describeLayout(mesh.texcoordLayout)}; ${mesh.texcoordLayout.source}`]);
    }
    details.push(["Vertex buffer", placementText(mesh.vertexBuffer)]);
    if (mesh.indexBuffer !== null) {
        details.push(["Index buffer", placementText(mesh.indexBuffer)]);
    }
    details.push(...mesh.textures.map(textureDetail));
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

function textureDetail(use: MeshTexture): [string, string] {
    const { texture } = use;
    const label = (texture.label !== null) ? ` "${texture.label}"` : "";
    return [`Texture ${textureText(use)}`, `${texture.address}${label}, ${texture.formatName}, ${contentsText(use)}`];
}

function contentsText({ texture, role }: MeshTexture): string {
    switch (texture.contents) {
        case "cpu-visible":
            return (role === "base-color") ? "base color" : (role === "normal") ? "normal map" : "captured";
        case "gpu-only":
            return "in GPU-only storage, nothing to read";
        case "unlocated":
            return "filled before Mesh Finder was added, nothing to read";
        case "unsupported":
            return "in a format Mesh Finder cannot decode";
        case "too-large":
            return "too large to read";
        case "unreadable":
            return `could not be read: ${texture.failure}`;
    }
}

function mebibytes(size: number): string {
    return compact(size / 1048576);
}

function point(coordinates: [number, number, number]): string {
    return `(${coordinates.map(compact).join(", ")})`;
}
