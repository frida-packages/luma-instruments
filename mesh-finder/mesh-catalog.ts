import type { Mesh, UnnumberedMesh } from "./mesh.js";

export interface CatalogListener {
    meshAdmitted(mesh: Mesh): void;
    meshRemoved(mesh: Mesh): void;
}

export class MeshCatalog {
    private readonly byIdentity = new Map<string, Mesh>();
    private readonly byId = new Map<number, Mesh>();
    private readonly drawnBuffers = new Set<string>();
    private nextId = 1;

    constructor(private readonly listener: CatalogListener) {
    }

    wants(identity: string, rank: number): boolean {
        const existing = this.byIdentity.get(identity);
        return existing === undefined || rankOf(existing) < rank;
    }

    admit(candidate: UnnumberedMesh): Mesh | null {
        const existing = this.byIdentity.get(candidate.identity);
        if (existing !== undefined && !supersedes(candidate, existing)) {
            return null;
        }
        if (candidate.evidence === "found" && this.overlapsDrawn(candidate)) {
            return null;
        }
        const mesh: Mesh = { id: existing?.id ?? this.nextId++, ...candidate };
        this.byIdentity.set(mesh.identity, mesh);
        this.byId.set(mesh.id, mesh);
        this.listener.meshAdmitted(mesh);
        return mesh;
    }

    noteDrawn(bufferIds: string[]): void {
        const fresh = bufferIds.filter(id => !this.drawnBuffers.has(id));
        if (fresh.length === 0) {
            return;
        }
        for (const id of fresh) {
            this.drawnBuffers.add(id);
        }
        for (const other of [...this.byId.values()]) {
            if (other.evidence === "found" && this.overlapsDrawn(other)) {
                this.byIdentity.delete(other.identity);
                this.byId.delete(other.id);
                this.listener.meshRemoved(other);
            }
        }
    }

    find(id: number): Mesh | undefined {
        return this.byId.get(id);
    }

    isDrawn(bufferId: string): boolean {
        return this.drawnBuffers.has(bufferId);
    }

    all(): Mesh[] {
        return [...this.byId.values()];
    }

    private overlapsDrawn(mesh: UnnumberedMesh): boolean {
        return this.drawnBuffers.has(mesh.vertexBuffer.id) || (mesh.indexBuffer !== null && this.drawnBuffers.has(mesh.indexBuffer.id));
    }
}

function supersedes(candidate: UnnumberedMesh, existing: Mesh): boolean {
    const [rank, existingRank] = [rankOf(candidate), rankOf(existing)];
    return rank > existingRank || (rank === existingRank && candidate.contents !== "cpu-visible");
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
