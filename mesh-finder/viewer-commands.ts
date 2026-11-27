import type { GraphicsApis } from "./graphics-apis.js";
import type { Mesh } from "./mesh.js";
import type { MeshCatalog } from "./mesh-catalog.js";
import type { MeshDisplay } from "./mesh-display.js";
import { learnedFrom, meshTitle } from "./mesh-table.js";
import { offerObj } from "./obj-export.js";
import { offerPng } from "./texture-export.js";

export interface Reply {
    output(text: string): void;
    error(text: string): void;
    file: CustomInstrumentOfferFile;
}

const LISTED_MESHES = 50;

const help = [
    "show <n>  shows mesh #n",
    "obj <n>   offers mesh #n as a Wavefront OBJ file to save, in a ZIP with its MTL and PNG textures when it has any",
    "png <n>   offers the base color texture of mesh #n as a PNG file to save; png <n> <slot> the one in that slot",
    "list      lists the meshes found so far",
    "scan      looks for buffers again, such as after a new level has loaded",
].join("\n");

export class ViewerCommands {
    readonly #catalog: MeshCatalog;
    readonly #display: MeshDisplay;
    readonly #apis: GraphicsApis;

    constructor(
        catalog: MeshCatalog,
        display: MeshDisplay,
        apis: GraphicsApis,
    ) {
        this.#catalog = catalog;
        this.#display = display;
        this.#apis = apis;
    }

    run(text: string, reply: Reply): void {
        const [verb, argument, detail] = text.trim().replace(/^>\s*/, "").split(/\s+/);
        switch (verb) {
            case "show":
                this.#withMesh(argument, reply, mesh => this.#show(mesh, reply));
                break;
            case "obj":
                this.#withMesh(argument, reply, mesh => offerObj(mesh, reply));
                break;
            case "png":
                this.#withMesh(argument, reply, mesh => offerPng(mesh, (detail !== undefined) ? Number(detail) : null, reply));
                break;
            case "list":
                reply.output(this.#listing());
                break;
            case "scan":
                this.#scan(reply);
                break;
            case "help":
            case "":
                reply.output(help);
                break;
            default:
                this.#withMesh(verb, reply, mesh => this.#show(mesh, reply));
        }
    }

    #show(mesh: Mesh, reply: Reply): void {
        const picture = this.#display.showMesh(mesh);
        if (picture.kind === "not-shown") {
            reply.error(`${meshTitle(mesh)}: ${picture.reason}`);
        }
    }

    #withMesh(argument: string | undefined, reply: Reply, use: (mesh: Mesh) => void): void {
        const id = Number((argument ?? "").replace(/^#/, ""));
        const mesh = Number.isInteger(id) ? this.#catalog.find(id) : undefined;
        if (mesh === undefined) {
            reply.error(`There is no mesh ${argument ?? ""}. Type "list" to see the ones found so far, or "help".`);
            return;
        }
        use(mesh);
    }

    #listing(): string {
        const meshes = this.#catalog.all();
        if (meshes.length === 0) {
            return "No meshes found yet.";
        }
        const lines = meshes.slice(0, LISTED_MESHES).map(mesh => `${meshTitle(mesh)}: ${sizeOfMesh(mesh)}, ${learnedFrom(mesh)}`);
        if (meshes.length > LISTED_MESHES) {
            lines.push(`… and ${meshes.length - LISTED_MESHES} more in the table.`);
        }
        return lines.join("\n");
    }

    #scan(reply: Reply): void {
        const refusal = this.#apis.scanRefusal();
        if (refusal !== null) {
            reply.output(refusal);
            return;
        }
        this.#apis.scan();
    }
}

function sizeOfMesh(mesh: Mesh): string {
    const vertices = (mesh.vertexCount !== 0) ? `${mesh.vertexCount} vertices` : "vertices unknown";
    const primitives = (mesh.topology === "point-list") ? "points" : `${mesh.triangleCount} triangles`;
    return `${vertices}, ${primitives}`;
}
