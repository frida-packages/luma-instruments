import { Buffer } from "buffer";
import type { MeshTexture } from "./material.js";
import type { Mesh } from "./mesh.js";
import { meshTitle, whyUnreadable } from "./mesh-table.js";
import { pngOf, textureStem } from "./texture-export.js";
import type { Reply } from "./viewer-commands.js";
import { zipArchive, type ArchiveEntry } from "./zip-archive.js";

type MeshExport = { kind: "file"; name: string; mediaType: string; pieces: Buffer[] } | { kind: "refused"; reason: string };

interface Material {
    name: string;
    textures: TextureFile[];
}

interface TextureFile {
    use: MeshTexture;
    name: string;
}

const OBJ_MEDIA_TYPE = "model/obj";
const ZIP_MEDIA_TYPE = "application/zip";

const LARGEST_EXPORT_BYTES = 64 * 1048576;
const FRAGMENTS_PER_PIECE = 16384;
const LONGEST_NAME_BYTES = 255;
const OBJ_EXTENSION = ".obj";
const MTL_EXTENSION = ".mtl";
const ZIP_EXTENSION = ".zip";
const PNG_EXTENSION = ".png";
const LONGEST_TEXTURE_STEM_BYTES = 64;
const UNSAFE_IN_FILE_NAMES = /[\\/<>:"|?*\x00-\x1f\x7f]/g;

const mtlMaps: Record<MeshTexture["role"], string[]> = { "base-color": ["map_Kd"], "normal": ["norm", "map_Bump"], "other": [] };

export function offerObj(mesh: Mesh, reply: Reply): void {
    const exported = exportOf(mesh);
    if (exported.kind === "refused") {
        reply.error(exported.reason);
        return;
    }
    const file = reply.file({ name: exported.name, mediaType: exported.mediaType });
    for (const piece of exported.pieces) {
        file.write(piece);
    }
    file.end();
    reply.output(`Offered ${meshTitle(mesh)} for saving as ${exported.name}.`);
}

function exportOf(mesh: Mesh): MeshExport {
    if (mesh.positions === null) {
        return { kind: "refused", reason: `${meshTitle(mesh)} has nothing to export. ${whyUnreadable(mesh)}.` };
    }
    const readable = uniqueReadable(mesh.textures);
    return (readable.length === 0) ? plainObj(mesh, mesh.positions) : texturedArchive(mesh, mesh.positions, readable);
}

function uniqueReadable(textures: MeshTexture[]): MeshTexture[] {
    const seen = new Set<string>();
    return textures.filter(use => {
        const fresh = use.texture.contents === "cpu-visible" && !seen.has(use.texture.id);
        seen.add(use.texture.id);
        return fresh;
    });
}

function plainObj(mesh: Mesh, positions: Float32Array): MeshExport {
    const header = Buffer.from(objHeader(mesh, null));
    const body = piecesWithin(LARGEST_EXPORT_BYTES - header.byteLength, objBody(mesh, positions));
    if (body === null) {
        return tooLarge(mesh, "an OBJ");
    }
    return { kind: "file", name: fileStem(meshTitle(mesh), OBJ_EXTENSION) + OBJ_EXTENSION, mediaType: OBJ_MEDIA_TYPE,
        pieces: [header, ...body] };
}

function texturedArchive(mesh: Mesh, positions: Float32Array, readable: MeshTexture[]): MeshExport {
    const stem = fileStem(meshTitle(mesh), ` ${"x".repeat(LONGEST_TEXTURE_STEM_BYTES)}${PNG_EXTENSION}`);
    const material: Material = { name: `mesh${mesh.id}`, textures: textureFilesOf(stem, readable) };
    const header = Buffer.from(objHeader(mesh, `${stem}${MTL_EXTENSION}`) + `usemtl ${material.name}\n`);
    const body = piecesWithin(LARGEST_EXPORT_BYTES - header.byteLength, objBody(mesh, positions));
    if (body === null) {
        return tooLarge(mesh, "an archive");
    }
    const entries: ArchiveEntry[] = [
        { name: `${stem}${OBJ_EXTENSION}`, bytes: Buffer.concat([header, ...body]) },
        { name: `${stem}${MTL_EXTENSION}`, bytes: Buffer.from(mtlOf(material)) },
        ...material.textures.map(file => ({ name: file.name, bytes: Buffer.from(pngOf(file.use.texture)) })),
    ];
    if (entries.reduce((sum, entry) => sum + entry.bytes.byteLength, 0) > LARGEST_EXPORT_BYTES) {
        return tooLarge(mesh, "an archive");
    }
    return { kind: "file", name: fileStem(meshTitle(mesh), ZIP_EXTENSION) + ZIP_EXTENSION, mediaType: ZIP_MEDIA_TYPE,
        pieces: zipArchive(entries, new Date()) };
}

function objHeader(mesh: Mesh, mtl: string | null): string {
    const library = (mtl !== null) ? `mtllib ${mtl}\n` : "";
    return `# ${meshTitle(mesh)}, found by Mesh Finder in a ${mesh.api} buffer at ${mesh.vertexBuffer.address}\n${library}o mesh${mesh.id}\n`;
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
    const { texcoords, indices } = mesh;
    if (texcoords !== null) {
        for (let i = 0; i < texcoords.length; i += 2) {
            yield `vt ${number(texcoords[i])} ${number(1 - texcoords[i + 1])}\n`;
        }
    }
    if (indices !== null) {
        const corner = (texcoords !== null) ? (index: number) => `${index}/${index}` : (index: number) => String(index);
        for (let i = 0; i < indices.length; i += 3) {
            yield `f ${corner(indices[i] + 1)} ${corner(indices[i + 1] + 1)} ${corner(indices[i + 2] + 1)}\n`;
        }
    } else {
        yield "p";
        for (let i = 1; i <= mesh.vertexCount; i++) {
            yield ` ${i}`;
        }
        yield "\n";
    }
}

function tooLarge(mesh: Mesh, what: string): MeshExport {
    return { kind: "refused", reason: `${meshTitle(mesh)} would make ${what} of more than `
        + `the ${LARGEST_EXPORT_BYTES / 1048576} MiB a file offered for saving can be.` };
}

export function fileStem(title: string, extension: string): string {
    return prefixWithin(LONGEST_NAME_BYTES - extension.length, title.replace(UNSAFE_IN_FILE_NAMES, "-"));
}

function textureFilesOf(stem: string, readable: MeshTexture[]): TextureFile[] {
    const taken = new Set<string>();
    return readable.map(use => {
        const plain = prefixWithin(LONGEST_TEXTURE_STEM_BYTES, textureStem(use).replace(UNSAFE_IN_FILE_NAMES, "-"));
        const unique = taken.has(plain) ? `${plain} ${use.slot}` : plain;
        taken.add(unique);
        return { use, name: `${stem} ${unique}${PNG_EXTENSION}` };
    });
}

function mtlOf(material: Material): string {
    const maps = material.textures.flatMap(({ use, name }) => mtlMaps[use.role].map(map => `${map} ${name}\n`));
    return `newmtl ${material.name}\nKa 0 0 0\nKd 1 1 1\nKs 0 0 0\n${maps.join("")}`;
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
