import type { GraphicsApis } from "./graphics-apis.js";
import type { Mesh } from "./mesh.js";
import type { MeshCatalog } from "./mesh-catalog.js";
import type { MeshDisplay } from "./mesh-display.js";
import { learnedFrom, meshTitle } from "./mesh-table.js";
import { objOf } from "./obj-export.js";

export interface Reply {
    output(text: string): void;
    error(text: string): void;
}

const LISTED_MESHES = 50;

const help = [
    "show <n>  shows mesh #n",
    "obj <n>   writes mesh #n here as a Wavefront OBJ",
    "list      lists the meshes found so far",
    "scan      looks for buffers again, such as after a new level has loaded",
].join("\n");

export class ViewerCommands {
    constructor(
        private readonly catalog: MeshCatalog,
        private readonly display: MeshDisplay,
        private readonly apis: GraphicsApis,
    ) {
    }

    run(text: string, reply: Reply): void {
        const [verb, argument] = text.trim().replace(/^>\s*/, "").split(/\s+/);
        switch (verb) {
            case "show":
                this.withMesh(argument, reply, mesh => this.display.showMesh(mesh));
                break;
            case "obj":
                this.withMesh(argument, reply, mesh => this.exportObj(mesh, reply));
                break;
            case "list":
                reply.output(this.listing());
                break;
            case "scan":
                this.apis.scan();
                break;
            case "help":
            case "":
                reply.output(help);
                break;
            default:
                this.withMesh(verb, reply, mesh => this.display.showMesh(mesh));
        }
    }

    exportObj(mesh: Mesh, reply: Reply): void {
        const obj = objOf(mesh);
        if (obj.kind === "text") {
            reply.output(obj.text);
        } else {
            reply.error(obj.reason);
        }
    }

    private withMesh(argument: string | undefined, reply: Reply, use: (mesh: Mesh) => void): void {
        const id = Number((argument ?? "").replace(/^#/, ""));
        const mesh = Number.isInteger(id) ? this.catalog.find(id) : undefined;
        if (mesh === undefined) {
            reply.error(`There is no mesh ${argument ?? ""}. Type "list" to see the ones found so far, or "help".`);
            return;
        }
        use(mesh);
    }

    private listing(): string {
        const meshes = this.catalog.all();
        if (meshes.length === 0) {
            return "No meshes found yet.";
        }
        const lines = meshes.slice(0, LISTED_MESHES).map(mesh => `${meshTitle(mesh)}: ${sizeOfMesh(mesh)}, ${learnedFrom(mesh)}`);
        if (meshes.length > LISTED_MESHES) {
            lines.push(`… and ${meshes.length - LISTED_MESHES} more in the table.`);
        }
        return lines.join("\n");
    }
}

function sizeOfMesh(mesh: Mesh): string {
    const vertices = (mesh.vertexCount !== 0) ? `${mesh.vertexCount} vertices` : "vertices unknown";
    const primitives = (mesh.topology === "point-list") ? "points" : `${mesh.triangleCount} triangles`;
    return `${vertices}, ${primitives}`;
}
