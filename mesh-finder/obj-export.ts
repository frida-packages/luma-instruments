import type { Mesh } from "./mesh.js";
import { meshTitle, whyUnreadable } from "./mesh-table.js";

export type ObjExport = { kind: "text"; text: string } | { kind: "refused"; reason: string };

const LARGEST_OBJ_BYTES = 16 * 1048576;
const BYTES_PER_VERTEX_LINE = 32;
const BYTES_PER_FACE_LINE = 24;

export function objOf(mesh: Mesh): ObjExport {
    if (mesh.positions === null) {
        return { kind: "refused", reason: `${meshTitle(mesh)} has nothing to export. ${whyUnreadable(mesh)}.` };
    }
    const estimate = mesh.vertexCount * BYTES_PER_VERTEX_LINE + mesh.triangleCount * BYTES_PER_FACE_LINE;
    if (estimate > LARGEST_OBJ_BYTES) {
        return { kind: "refused", reason: `${meshTitle(mesh)} would make an OBJ of about ${Math.round(estimate / 1048576)} MiB, `
            + `more than the ${LARGEST_OBJ_BYTES / 1048576} MiB Mesh Finder writes to the console.` };
    }
    const lines = [
        `# ${meshTitle(mesh)}, found by Mesh Finder in a ${mesh.api} buffer at ${mesh.vertexBuffer.address}`,
        `o mesh${mesh.id}`,
    ];
    const { positions, indices } = mesh;
    for (let i = 0; i < positions.length; i += 3) {
        lines.push(`v ${number(positions[i])} ${number(positions[i + 1])} ${number(positions[i + 2])}`);
    }
    if (indices !== null) {
        for (let i = 0; i < indices.length; i += 3) {
            lines.push(`f ${indices[i] + 1} ${indices[i + 1] + 1} ${indices[i + 2] + 1}`);
        }
    } else {
        lines.push(`p ${Array.from({ length: mesh.vertexCount }, (_, i) => i + 1).join(" ")}`);
    }
    return { kind: "text", text: lines.join("\n") + "\n" };
}

function number(value: number): string {
    return String(Number(value.toPrecision(7)));
}
