import type { Mesh, UnnumberedMesh } from "./mesh.js";

export interface CatalogListener {
    meshAdmitted(mesh: Mesh): void;
    meshRemoved(mesh: Mesh): void;
}

export class MeshCatalog {
    readonly #listener: CatalogListener;
    readonly #byIdentity = new Map<string, Mesh>();
    readonly #byId = new Map<number, Mesh>();
    readonly #drawnBuffers = new Set<string>();
    readonly #scratchBuffers = new Set<string>();
    #nextId = 1;

    constructor(listener: CatalogListener) {
        this.#listener = listener;
    }

    wants(identity: string, rank: number, textureIds: string[]): boolean {
        const existing = this.#byIdentity.get(identity);
        if (existing === undefined) {
            return true;
        }
        const existingRank = rankOf(existing);
        return existingRank < rank || (existingRank === rank && !sameTextures(existing, textureIds));
    }

    admit(candidate: UnnumberedMesh): Mesh | null {
        const existing = this.#byIdentity.get(candidate.identity);
        if (existing !== undefined && !supersedes(candidate, existing)) {
            return null;
        }
        if (candidate.evidence === "found" && this.#overlapsDrawn(candidate)) {
            return null;
        }
        if (this.#scratchBuffers.has(candidate.vertexBuffer.id)) {
            return null;
        }
        const mesh: Mesh = { id: existing?.id ?? this.#nextId++, ...candidate };
        this.#byIdentity.set(mesh.identity, mesh);
        this.#byId.set(mesh.id, mesh);
        this.#listener.meshAdmitted(mesh);
        return mesh;
    }

    noteDrawn(bufferIds: string[]): void {
        const fresh = bufferIds.filter(id => !this.#drawnBuffers.has(id));
        if (fresh.length === 0) {
            return;
        }
        for (const id of fresh) {
            this.#drawnBuffers.add(id);
        }
        for (const other of [...this.#byId.values()]) {
            if (other.evidence === "found" && this.#overlapsDrawn(other)) {
                this.#remove(other);
            }
        }
    }

    noteScratch(bufferId: string): void {
        this.#scratchBuffers.add(bufferId);
        for (const mesh of [...this.#byId.values()]) {
            if (mesh.vertexBuffer.id === bufferId) {
                this.#remove(mesh);
            }
        }
    }

    find(id: number): Mesh | undefined {
        return this.#byId.get(id);
    }

    isDrawn(bufferId: string): boolean {
        return this.#drawnBuffers.has(bufferId);
    }

    all(): Mesh[] {
        return [...this.#byId.values()];
    }

    #remove(mesh: Mesh): void {
        this.#byIdentity.delete(mesh.identity);
        this.#byId.delete(mesh.id);
        this.#listener.meshRemoved(mesh);
    }

    #overlapsDrawn(mesh: UnnumberedMesh): boolean {
        return this.#drawnBuffers.has(mesh.vertexBuffer.id) || (mesh.indexBuffer !== null && this.#drawnBuffers.has(mesh.indexBuffer.id));
    }
}

function supersedes(candidate: UnnumberedMesh, existing: Mesh): boolean {
    const [rank, existingRank] = [rankOf(candidate), rankOf(existing)];
    if (rank !== existingRank) {
        return rank > existingRank;
    }
    return candidate.contents !== "cpu-visible"
        || (!sameTextures(existing, candidate.textures.map(use => use.texture.id)) && readableTextures(candidate) >= readableTextures(existing));
}

function sameTextures(mesh: UnnumberedMesh, textureIds: string[]): boolean {
    return mesh.textures.length === textureIds.length && mesh.textures.every((use, i) => use.texture.id === textureIds[i]);
}

function readableTextures(mesh: UnnumberedMesh): number {
    return mesh.textures.filter(use => use.texture.contents === "cpu-visible").length;
}

export function rankOf(mesh: Pick<UnnumberedMesh, "evidence" | "layout" | "contents">): number {
    if (mesh.evidence === "found") {
        return mesh.layout!.confidence;
    }
    if (mesh.contents !== "cpu-visible") {
        return 1.5;
    }
    return (mesh.layout!.knowledge === "declared") ? 3 : 2 + mesh.layout!.confidence * 0.5;
}
