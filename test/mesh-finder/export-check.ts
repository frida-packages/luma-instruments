/// <reference path="./luma.d.ts" />

import { Buffer } from "buffer";
import { Writable } from "stream";
import type { MeshTexture } from "../../mesh-finder/material.js";
import type { Mesh } from "../../mesh-finder/mesh.js";
import { offerObj } from "../../mesh-finder/obj-export.js";
import type { CapturedTexture } from "../../mesh-finder/texture-catalog.js";
import { offerPng } from "../../mesh-finder/texture-export.js";

interface Offer {
    name: string;
    mediaType: string;
    bytes: Promise<Buffer>;
}

interface Outcome {
    offers: Offer[];
    outputs: string[];
    errors: string[];
}

interface Case {
    what: string;
    check(): Promise<string | null>;
}

const OVERSIZED_VERTICES = 3_000_000;
const BATCHED_VERTICES = 20_000;
const LONGEST_NAME_BYTES = 255;
const PNG_SIGNATURE = "89504e470d0a1a0a";
const ZIP_LOCAL_HEADER = 0x04034b50;
const ZIP_CENTRAL_HEADER = 0x02014b50;
const ZIP_END_OF_DIRECTORY = 0x06054b50;

const cases: Case[] = [
    { what: "a small labeled mesh is offered as model/obj under its title, byte for byte", check: smallMesh },
    { what: "a point cloud is written as one p element", check: pointCloud },
    { what: "a mesh written in many pieces comes out whole", check: manyPieces },
    { what: "a long label is cut to a file name of at most 255 bytes without splitting a character", check: longLabel },
    { what: "a textured mesh is offered as a ZIP of its OBJ with vt lines, its MTL and a PNG per readable texture", check: texturedMesh },
    { what: "png offers a mesh's base color texture, or the one in a slot, as image/png", check: pngOffer },
    { what: "a mesh with nothing readable is refused in the console and offers no file", check: unreadable },
    { what: "a mesh whose OBJ exceeds 64 MiB is refused in the console and offers no file", check: oversized },
];

rpc.exports = {
    async run(): Promise<number> {
        let failures = 0;
        for (const { what, check } of cases) {
            const problem = await check();
            failures += (problem !== null) ? 1 : 0;
            console.log((problem === null) ? `PASS ${what}` : `FAIL ${what}: ${problem}`);
        }
        return failures;
    },
};

async function smallMesh(): Promise<string | null> {
    const mesh = meshOf({
        id: 7,
        label: "Héro/Body: \"lod0\"",
        positions: [0, 0, 0, 1, 0, 0, 0.1, 1.5, -2.25, -1e-7, 3, 1234.5678],
        indices: [0, 1, 2, 0, 2, 3],
    });
    const expected = [
        "# #7 Héro/Body: \"lod0\", found by Mesh Finder in a Metal buffer at 0x10000",
        "o mesh7",
        "v 0 0 0",
        "v 1 0 0",
        "v 0.1 1.5 -2.25",
        "v -1e-7 3 1234.568",
        "f 1 2 3",
        "f 1 3 4",
        "",
    ].join("\n");
    return problemWithOffer(exported(mesh), "#7 Héro/Body: \"lod0\"", "#7 Héro-Body- -lod0-.obj", expected);
}

async function pointCloud(): Promise<string | null> {
    const mesh = meshOf({ id: 2, label: null, positions: [1, 2, 3, 4, 5, 6, 7, 8, 9], indices: null });
    const expected = "# #2, found by Mesh Finder in a Metal buffer at 0x10000\no mesh2\nv 1 2 3\nv 4 5 6\nv 7 8 9\np 1 2 3\n";
    return problemWithOffer(exported(mesh), "#2", "#2.obj", expected);
}

async function manyPieces(): Promise<string | null> {
    const positions = Array.from({ length: BATCHED_VERTICES * 3 }, (_, i) => i / 8);
    const mesh = meshOf({ id: 3, label: "Ribbon", positions, indices: null });
    const lines = ["# #3 Ribbon, found by Mesh Finder in a Metal buffer at 0x10000", "o mesh3"];
    for (let i = 0; i < positions.length; i += 3) {
        lines.push(`v ${positions[i]} ${positions[i + 1]} ${positions[i + 2]}`);
    }
    lines.push(`p ${Array.from({ length: BATCHED_VERTICES }, (_, i) => i + 1).join(" ")}`);
    return problemWithOffer(exported(mesh), "#3 Ribbon", "#3 Ribbon.obj", lines.join("\n") + "\n");
}

async function longLabel(): Promise<string | null> {
    const mesh = meshOf({ id: 1, label: "é".repeat(300), positions: [0, 0, 0], indices: null });
    const outcome = exported(mesh);
    const expectedName = `#1 ${"é".repeat(124)}.obj`;
    if (outcome.offers.length !== 1 || outcome.offers[0].name !== expectedName) {
        return `offered ${JSON.stringify(outcome.offers.map(offer => offer.name))}`;
    }
    const size = Buffer.byteLength(outcome.offers[0].name);
    return (size === LONGEST_NAME_BYTES) ? null : `the name is ${size} bytes`;
}

async function texturedMesh(): Promise<string | null> {
    const mesh = texturedMeshOf();
    const outcome = exported(mesh);
    if (outcome.errors.length !== 0 || outcome.offers.length !== 1) {
        return `the console said ${JSON.stringify(outcome)}`;
    }
    const offer = outcome.offers[0];
    if (offer.name !== "#8 Crate.zip" || offer.mediaType !== "application/zip") {
        return `offered ${JSON.stringify(offer.name)} as ${offer.mediaType}`;
    }
    const archive = archiveOf(await offer.bytes);
    if (typeof archive === "string") {
        return archive;
    }
    const names = ["#8 Crate.obj", "#8 Crate.mtl", "#8 Crate albedo.png", "#8 Crate normalMap.png"];
    if (JSON.stringify([...archive.keys()]) !== JSON.stringify(names)) {
        return `the archive holds ${JSON.stringify([...archive.keys()])}`;
    }
    const obj = [
        "# #8 Crate, found by Mesh Finder in a Metal buffer at 0x10000",
        "mtllib #8 Crate.mtl",
        "o mesh8",
        "usemtl mesh8",
        "v 0 0 0",
        "v 1 0 0",
        "v 0 1 0",
        "vt 0 1",
        "vt 1 1",
        "vt 0.25 0",
        "f 1/1 2/2 3/3",
        "",
    ].join("\n");
    const mtl = "newmtl mesh8\nKa 0 0 0\nKd 1 1 1\nKs 0 0 0\nmap_Kd #8 Crate albedo.png\nnorm #8 Crate normalMap.png\n"
        + "map_Bump #8 Crate normalMap.png\n";
    if (archive.get(names[0])!.toString() !== obj) {
        return `its OBJ is ${JSON.stringify(archive.get(names[0])!.toString())}`;
    }
    if (archive.get(names[1])!.toString() !== mtl) {
        return `its MTL is ${JSON.stringify(archive.get(names[1])!.toString())}`;
    }
    const png = archive.get(names[2])!;
    if (png.subarray(0, 8).toString("hex") !== PNG_SIGNATURE || png.readUInt32BE(16) !== 2 || png.readUInt32BE(20) !== 2) {
        return `its base color is not a 2 × 2 PNG: ${png.subarray(0, 24).toString("hex")}`;
    }
    const said = "Offered #8 Crate for saving as #8 Crate.zip.";
    return (outcome.outputs.length === 1 && outcome.outputs[0] === said) ? null : `the console said ${JSON.stringify(outcome.outputs)}`;
}

async function pngOffer(): Promise<string | null> {
    const mesh = texturedMeshOf();
    const baseColor = offeredPng(mesh, null);
    const inSlot = offeredPng(mesh, 1);
    const missing = offeredPng(mesh, 5);
    const unreadable = offeredPng(mesh, 2);
    if (baseColor.offers.length !== 1 || baseColor.offers[0].name !== "#8 Crate albedo.png" || baseColor.offers[0].mediaType !== "image/png") {
        return `png 8 offered ${JSON.stringify(baseColor.offers)}`;
    }
    if (inSlot.offers.length !== 1 || inSlot.offers[0].name !== "#8 Crate normalMap.png") {
        return `png 8 1 offered ${JSON.stringify(inSlot.offers)}`;
    }
    if (missing.offers.length !== 0 || missing.errors[0] !== "#8 Crate has no texture in slot 5.") {
        return `png 8 5 said ${JSON.stringify(missing)}`;
    }
    if (unreadable.offers.length !== 0 || unreadable.errors.length !== 1) {
        return `png 8 2 said ${JSON.stringify(unreadable)}`;
    }
    const png = await baseColor.offers[0].bytes;
    return (png.subarray(0, 8).toString("hex") === PNG_SIGNATURE) ? null : `png 8 wrote ${png.subarray(0, 8).toString("hex")}`;
}

async function unreadable(): Promise<string | null> {
    const mesh = { ...meshOf({ id: 4, label: null, positions: [], indices: null }), positions: null, contents: "gpu-only" } satisfies Mesh;
    return problemWithRefusal(exported(mesh), "#4 has nothing to export. Its buffers are in GPU-only storage.");
}

async function oversized(): Promise<string | null> {
    const positions = new Float32Array(OVERSIZED_VERTICES * 3).fill(1234.567);
    const mesh = meshOf({ id: 5, label: "Level", positions, indices: null });
    return problemWithRefusal(exported(mesh),
        "#5 Level would make an OBJ of more than the 64 MiB a file offered for saving can be.");
}

function meshOf({ id, label, positions, indices }: {
    id: number;
    label: string | null;
    positions: ArrayLike<number>;
    indices: number[] | null;
}): Mesh {
    const vertexCount = positions.length / 3;
    const placement = { id: "1", address: "0x10000", label, byteLength: positions.length * 4, offset: 0 };
    return {
        id,
        identity: `test-${id}`,
        api: "Metal",
        label,
        evidence: "drawn",
        contents: "cpu-visible",
        topology: (indices !== null) ? "triangle-list" : "point-list",
        positions: Float32Array.from(positions),
        indices: (indices !== null) ? Uint32Array.from(indices) : null,
        texcoords: null,
        texcoordLayout: null,
        textures: [],
        vertexCount,
        triangleCount: (indices !== null) ? indices.length / 3 : 0,
        bounds: null,
        layout: null,
        indexFormat: (indices !== null) ? "uint32" : null,
        vertexBuffer: placement,
        indexBuffer: null,
    };
}

function texturedMeshOf(): Mesh {
    const mesh = meshOf({ id: 8, label: "Crate", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] });
    const albedo = textureOf("a", [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 128]);
    const normal = textureOf("n", [128, 128, 255, 255, 128, 128, 255, 255, 128, 128, 255, 255, 128, 128, 255, 255]);
    const hidden = { ...textureOf("h", []), contents: "gpu-only", bytes: null } satisfies CapturedTexture;
    const textures: MeshTexture[] = [
        { slot: 0, name: "albedo", role: "base-color", texture: albedo },
        { slot: 1, name: "normalMap", role: "normal", texture: normal },
        { slot: 2, name: "shadowMap", role: "other", texture: hidden },
    ];
    return { ...mesh, texcoords: Float32Array.from([0, 0, 1, 0, 0.25, 1]), textures };
}

function textureOf(id: string, rgba: number[]): CapturedTexture {
    return {
        id,
        api: "Metal",
        address: `texture ${id}`,
        label: null,
        width: 2,
        height: 2,
        format: "rgba8unorm",
        formatName: "MTLPixelFormatRGBA8Unorm",
        contents: "cpu-visible",
        bytes: Uint8Array.from(rgba).buffer,
        failure: null,
    };
}

function archiveOf(zip: Buffer): Map<string, Buffer> | string {
    const entries = new Map<string, Buffer>();
    let offset = 0;
    while (zip.readUInt32LE(offset) === ZIP_LOCAL_HEADER) {
        const crc = zip.readUInt32LE(offset + 14);
        const size = zip.readUInt32LE(offset + 18);
        const nameLength = zip.readUInt16LE(offset + 26);
        const start = offset + 30 + nameLength + zip.readUInt16LE(offset + 28);
        const bytes = zip.subarray(start, start + size);
        if (crcOf(bytes) !== crc) {
            return `entry ${entries.size} has CRC ${crc.toString(16)}, not ${crcOf(bytes).toString(16)}`;
        }
        entries.set(zip.subarray(offset + 30, offset + 30 + nameLength).toString(), bytes);
        offset = start + size;
    }
    const directory = offset;
    for (let i = 0; i !== entries.size; i++) {
        if (zip.readUInt32LE(offset) !== ZIP_CENTRAL_HEADER) {
            return `central directory entry ${i} is missing`;
        }
        offset += 46 + zip.readUInt16LE(offset + 28) + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
    }
    const end = zip.readUInt32LE(offset) === ZIP_END_OF_DIRECTORY && zip.readUInt16LE(offset + 10) === entries.size
        && zip.readUInt32LE(offset + 12) === offset - directory && zip.readUInt32LE(offset + 16) === directory
        && offset + 22 === zip.byteLength;
    return end ? entries : "the end of central directory record does not describe the archive";
}

function crcOf(bytes: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit !== 8; bit++) {
            crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function offeredPng(mesh: Mesh, slot: number | null): Outcome {
    const outcome: Outcome = { offers: [], outputs: [], errors: [] };
    offerPng(mesh, slot, {
        output: text => outcome.outputs.push(text),
        error: text => outcome.errors.push(text),
        file: ((file: CustomInstrumentOfferedFile) => {
            outcome.offers.push({ name: file.name, mediaType: file.mediaType, bytes: Promise.resolve(Buffer.from(file.bytes as ArrayBuffer)) });
        }) as CustomInstrumentOfferFile,
    });
    return outcome;
}

function exported(mesh: Mesh): Outcome {
    const outcome: Outcome = { offers: [], outputs: [], errors: [] };
    offerObj(mesh, {
        output: text => outcome.outputs.push(text),
        error: text => outcome.errors.push(text),
        file: ((header: CustomInstrumentOfferedFileHeader) => {
            const sink = collectingSink();
            outcome.offers.push({ name: header.name, mediaType: header.mediaType, bytes: sink.bytes });
            return sink.stream;
        }) as CustomInstrumentOfferFile,
    });
    return outcome;
}

async function problemWithOffer(outcome: Outcome, title: string, name: string, text: string): Promise<string | null> {
    if (outcome.errors.length !== 0) {
        return `refused: ${outcome.errors.join(" ")}`;
    }
    if (outcome.offers.length !== 1) {
        return `offered ${outcome.offers.length} files`;
    }
    const offer = outcome.offers[0];
    if (offer.name !== name || offer.mediaType !== "model/obj") {
        return `offered ${JSON.stringify(offer.name)} as ${offer.mediaType}`;
    }
    const bytes = await offer.bytes;
    const expected = Buffer.from(text);
    if (!bytes.equals(expected)) {
        return `wrote ${bytes.byteLength} bytes, not the ${expected.byteLength} expected: ${JSON.stringify(bytes.subarray(0, 200).toString())}`;
    }
    const said = `Offered ${title} for saving as ${name}.`;
    return (outcome.outputs.length === 1 && outcome.outputs[0] === said) ? null : `the console said ${JSON.stringify(outcome.outputs)}`;
}

function problemWithRefusal(outcome: Outcome, reason: string): string | null {
    if (outcome.offers.length !== 0) {
        return `offered ${outcome.offers.map(offer => offer.name).join(", ")}`;
    }
    return (outcome.errors.length === 1 && outcome.errors[0] === reason && outcome.outputs.length === 0)
        ? null
        : `the console said ${JSON.stringify(outcome)}`;
}

function collectingSink(): { stream: Writable; bytes: Promise<Buffer> } {
    const chunks: Buffer[] = [];
    const stream = new Writable({
        write(chunk: Buffer, _encoding, callback) {
            chunks.push(chunk);
            callback();
        },
    });
    const bytes = new Promise<Buffer>(resolve => stream.on("finish", () => resolve(Buffer.concat(chunks))));
    return { stream, bytes };
}
