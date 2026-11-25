import { Buffer } from "buffer";
import type { Mesh } from "./mesh.js";
import { meshTitle, whyUnreadable } from "./mesh-table.js";
import type { Reply } from "./viewer-commands.js";

type ObjExport = { kind: "file"; name: string; pieces: Buffer[] } | { kind: "refused"; reason: string };

const OBJ_MEDIA_TYPE = "model/obj";

const LARGEST_OBJ_BYTES = 64 * 1048576;
const FRAGMENTS_PER_PIECE = 16384;
const LONGEST_NAME_BYTES = 255;
const OBJ_EXTENSION = ".obj";
const UNSAFE_IN_FILE_NAMES = /[\\/<>:"|?*\x00-\x1f\x7f]/g;

export function offerObj(mesh: Mesh, reply: Reply): void {
    const obj = objOf(mesh);
    if (obj.kind === "refused") {
        reply.error(obj.reason);
        return;
    }
    const file = reply.file({ name: obj.name, mediaType: OBJ_MEDIA_TYPE });
    for (const piece of obj.pieces) {
        file.write(piece);
    }
    file.end();
    reply.output(`Offered ${meshTitle(mesh)} for saving as ${obj.name}.`);
}

function objOf(mesh: Mesh): ObjExport {
    if (mesh.positions === null) {
        return { kind: "refused", reason: `${meshTitle(mesh)} has nothing to export. ${whyUnreadable(mesh)}.` };
    }
    const header = Buffer.from(objHeader(mesh));
    const body = piecesWithin(LARGEST_OBJ_BYTES - header.byteLength, objBody(mesh, mesh.positions));
    if (body === null) {
        return { kind: "refused", reason: `${meshTitle(mesh)} would make an OBJ of more than `
            + `the ${LARGEST_OBJ_BYTES / 1048576} MiB a file offered for saving can be.` };
    }
    return { kind: "file", name: objFileName(mesh), pieces: [header, ...body] };
}

function objHeader(mesh: Mesh): string {
    return `# ${meshTitle(mesh)}, found by Mesh Finder in a ${mesh.api} buffer at ${mesh.vertexBuffer.address}\no mesh${mesh.id}\n`;
}

function piecesWithin(limit: number, asciiText: Iterable<string>): Buffer[] | null {
    const pieces: Buffer[] = [];
    let size = 0;
    for (const batch of batched(asciiText)) {
        const piece = asciiBytes(batch);
        size += piece.byteLength;
        if (size > limit) {
            return null;
        }
        pieces.push(piece);
    }
    return pieces;
}

function* objBody(mesh: Mesh, positions: Float32Array): Generator<string> {
    for (let i = 0; i < positions.length; i += 3) {
        yield `v ${number(positions[i])} ${number(positions[i + 1])} ${number(positions[i + 2])}\n`;
    }
    const { indices } = mesh;
    if (indices !== null) {
        for (let i = 0; i < indices.length; i += 3) {
            yield `f ${indices[i] + 1} ${indices[i + 1] + 1} ${indices[i + 2] + 1}\n`;
        }
    } else {
        yield "p";
        for (let i = 1; i <= mesh.vertexCount; i++) {
            yield ` ${i}`;
        }
        yield "\n";
    }
}

function objFileName(mesh: Mesh): string {
    const plainTitle = meshTitle(mesh).replace(UNSAFE_IN_FILE_NAMES, "-");
    return prefixWithin(LONGEST_NAME_BYTES - OBJ_EXTENSION.length, plainTitle) + OBJ_EXTENSION;
}

function* batched(fragments: Iterable<string>): Generator<string> {
    let batch: string[] = [];
    for (const fragment of fragments) {
        batch.push(fragment);
        if (batch.length === FRAGMENTS_PER_PIECE) {
            yield batch.join("");
            batch = [];
        }
    }
    if (batch.length !== 0) {
        yield batch.join("");
    }
}

function asciiBytes(text: string): Buffer {
    return Buffer.from(Memory.allocUtf8String(text).readByteArray(text.length)!);
}

function number(value: number): string {
    return String(Number(value.toPrecision(7)));
}

function prefixWithin(limit: number, text: string): string {
    let prefix = "";
    let size = 0;
    for (const character of text) {
        size += Buffer.byteLength(character);
        if (size > limit) {
            break;
        }
        prefix += character;
    }
    return prefix;
}
