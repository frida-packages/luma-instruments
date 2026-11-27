/// <reference path="./luma.d.ts" />

import { Buffer } from "buffer";
import { Writable } from "stream";
import { instrument } from "../../mesh-finder/main.js";
import { glTapEntryPointNames } from "../../mesh-finder/gl-tap.js";
import { direct3D11Libraries, openGLLibraries, vulkanLibraries } from "../../mesh-finder/graphics-libraries.js";
import { classesConformingTo, implementationOf } from "../../mesh-finder/objc.js";
import { LinuxGLPlatform } from "../../mesh-finder/opengl-linux.js";
import { findVulkanDrivers } from "../../mesh-finder/vulkan-driver.js";
import { pipelineEntryPointNames } from "../../mesh-finder/vulkan-pipelines.js";
import { tapEntryPointNames } from "../../mesh-finder/vulkan-tap.js";

interface Expectation {
    name: string;
    how: string;
    vertices: number;
    triangles: number;
    contents: "cpu-visible" | "gpu-only" | "unlocated";
    presence: "listed" | "absent";
    min: number[];
    max: number[];
    first: number[][];
    texture?: ExpectedTexture;
    texcoords?: number[][];
}

interface ExpectedTexture {
    width: number;
    height: number;
    format: string;
    corners: number[][];
}

interface ViewState {
    value: { vertices: number; triangles: number; title: string; texture: { width: number; height: number } | null; unshown?: string };
    data: ArrayBuffer | undefined;
}

interface Target {
    uploadLateMesh(): void;
    enter(phase: Phase): void;
}

interface HarnessParameters {
    observeSeconds?: number;
}

type Phase = "attached" | "disposed";

interface Row {
    id: string;
    cells: Record<string, string>;
}

interface Offer {
    name: string;
    mediaType: string;
    bytes: Promise<Buffer>;
}

interface ParsedObj {
    vertices: number[][];
    texcoords: number[][];
    faces: number;
    text: string;
    archive: Map<string, Buffer> | null;
}

const SETTLE_MS = 5000;
const SIGUSR1 = (Process.platform === "darwin") ? 30 : 10;
const COMPARED_BYTES = 16;
const LATE_UPLOAD_MS = 500;
const TOLERANCE = 1e-4;
const TEXEL_TOLERANCE = 1;
const LARGEST_VIEW_TEXTURE_SIDE = 1024;
const PNG_SIGNATURE = "89504e470d0a1a0a";
const ZIP_LOCAL_HEADER = 0x04034b50;
const MOST_STRAYS_NAMED = 8;
const LEFT_BY_EARLIER_INSTANCE = "left-by-an-earlier-instance";
const phases: Record<Phase, number> = { attached: 1, disposed: 2 };

const rows = new Map<string, Row>();
const pristineCode = new Map<string, ArrayBuffer>();
const pristineRanges = new Map<string, string>();
let lastOffer: Offer | null = null;
let lastViewState: ViewState | null = null;
let viewerCleared = false;
const scanStates: boolean[] = [];

const ctx = {
    emit(value: unknown) {
        console.log("emit", JSON.stringify(value));
    },
    widget(id: string) {
        return new Proxy({}, {
            get(_target, method: string) {
                return (...args: any[]) => {
                    if (id === "meshes" && method === "setActionEnabled" && args[0] === "scan") {
                        scanStates.push(args[1]);
                    } else if (id === "meshes" && method === "upsertRow") {
                        rows.set(args[0].id, args[0]);
                    } else if (id === "meshes" && method === "removeRow") {
                        rows.delete(args[0]);
                    } else if (id === "meshes" && method === "clear") {
                        rows.clear();
                    } else if (id === "mesh" && method === "setState") {
                        lastViewState = { value: args[0], data: args[1] };
                    } else if (id === "viewer" && method === "clear") {
                        viewerCleared = true;
                    } else if (id === "viewer" && !String(args[0]).startsWith("Offered ")) {
                        console.log(`viewer.${method}: ${args[0]}`);
                    }
                };
            },
        });
    },
} as unknown as CustomInstrumentContext;

const respond: CustomInstrumentActionResponder = {
    file: ((header: CustomInstrumentOfferedFileHeader) => {
        const chunks: Buffer[] = [];
        const stream = new Writable({
            write(chunk: Buffer, _encoding, callback) {
                chunks.push(chunk);
                callback();
            },
        });
        const bytes = new Promise<Buffer>(resolve => stream.on("finish", () => resolve(Buffer.concat(chunks))));
        lastOffer = { name: header.name, mediaType: header.mediaType, bytes };
        return stream;
    }) as CustomInstrumentOfferFile,
    show() {
    },
};

const quietReply = {
    output: (text: string) => console.log(`reply: ${text}`),
    error: (text: string) => console.log(`reply error: ${text}`),
    value: () => {},
    image: () => {},
    file: respond.file,
    show: respond.show,
};

const config: CustomInstrumentConfig = { settings: { watchDraws: true, guessUndrawn: true, minimumConfidence: 60, minimumVertices: 3 } };

rpc.exports = {
    run(out: string): Promise<number> {
        return run(out, targetOf(Process.platform));
    },
    init(_stage: string, parameters: HarnessParameters) {
        run(null, targetOf(Process.platform), (parameters.observeSeconds ?? 0) * 1000).then(
            failures => finish(failures),
            error => {
                console.log(`harness failed: ${(error as Error).stack}`);
                finish(1);
            });
    },
};

async function run(out: string | null, target: Target, observeMs = 0): Promise<number> {
    const expectations = JSON.parse(`[${Module.getGlobalExportByName("mesh_finder_expectations").readUtf8String()}]`) as Expectation[];
    recordHookedCode();
    rows.set(LEFT_BY_EARLIER_INSTANCE, { id: LEFT_BY_EARLIER_INSTANCE, cells: {} });
    const started = Date.now();
    const handle = await instrument.create(ctx, config, {} as CustomInstrumentRestoredState);
    console.log(`created in ${Date.now() - started} ms`);
    target.enter("attached");
    await new Promise(resolve => setTimeout(resolve, SETTLE_MS / 2 + observeMs));
    target.uploadLateMesh();
    await new Promise(resolve => setTimeout(resolve, LATE_UPLOAD_MS));
    const scanFailures = await checkScan(handle);
    const clearFailures = checkClear(handle);
    const failures = await check(handle, expectations, out);
    target.enter("disposed");
    const changed = changedHookedCode();
    const snapshots = pristineCode.size + pristineRanges.size;
    console.log((changed.length === 0)
        ? `all ${snapshots} snapshots of hooked code and tables are back to their original bytes`
        : `CHANGED after dispose: ${changed.join(", ")}`);
    return failures + changed.length + scanFailures + clearFailures;
}

function targetOf(platform: Platform): Target {
    return (platform === "windows") ? windowsTarget() : signalledTarget();
}

function signalledTarget(): Target {
    const raise = new NativeFunction(Module.getGlobalExportByName("raise"), "int", ["int"]);
    return {
        uploadLateMesh: () => raise(SIGUSR1),
        enter() {
        },
    };
}

function windowsTarget(): Target {
    return {
        uploadLateMesh: () => Module.getGlobalExportByName("mesh_finder_late_upload_requested").writeS32(1),
        enter: phase => Module.getGlobalExportByName("mesh_finder_phase").writeS32(phases[phase]),
    };
}

function finish(failures: number): void {
    Module.getGlobalExportByName("mesh_finder_failures").writeS32(failures);
    Module.getGlobalExportByName("mesh_finder_finish_requested").writeS32(1);
}

function recordHookedCode(): void {
    for (const address of hookCandidates()) {
        pristineCode.set(address.toString(), address.readByteArray(COMPARED_BYTES)!);
    }
    for (const [name, digest] of readOnlyDirect3D11()) {
        pristineRanges.set(name, digest);
    }
}

async function checkScan(handle: CustomInstrumentHandle): Promise<number> {
    const problems: string[] = [];
    if (scanStates.length === 0 || scanStates[0] || !await scanEnabledWithin(SETTLE_MS)) {
        problems.push(`the searches create started did not disable Scan and enable it again: ${JSON.stringify(scanStates)}`);
    }
    handle.onAction!({ widget: "meshes", action: "scan" }, respond);
    if (isScanEnabled()) {
        problems.push("Scan is not disabled while its search runs");
    }
    const replies: string[] = [];
    handle.onConsoleInput!({ widget: "viewer", entryId: "scan", text: "scan" }, { ...quietReply, output: text => replies.push(text) });
    if (!replies.some(text => text.startsWith("Still looking for buffers"))) {
        problems.push(`a typed scan during the search was not refused: ${JSON.stringify(replies)}`);
    }
    if (!await scanEnabledWithin(SETTLE_MS)) {
        problems.push("Scan is not enabled again once the search has finished");
    }
    await handle.updateConfig!({ settings: { ...config.settings, guessUndrawn: false } });
    const refusals: string[] = [];
    handle.onConsoleInput!({ widget: "viewer", entryId: "scan", text: "scan" }, { ...quietReply, output: text => refusals.push(text) });
    if (isScanEnabled() || !refusals.some(text => text.includes("Guess meshes in buffers never drawn"))) {
        problems.push(`with guessing off, Scan is not disabled or a typed scan does not say why: ${JSON.stringify(refusals)}`);
    }
    await handle.updateConfig!(config);
    if (!isScanEnabled()) {
        problems.push("Scan is not enabled again when guessing is turned back on");
    }
    for (const problem of problems) {
        console.log(`FAIL ${problem}`);
    }
    if (problems.length === 0) {
        console.log("PASS Scan is disabled while its search runs and while guessing is off, a typed scan then says why, and Scan is enabled after");
    }
    return problems.length;
}

function isScanEnabled(): boolean {
    return scanStates.at(-1) ?? true;
}

async function scanEnabledWithin(milliseconds: number): Promise<boolean> {
    const deadline = Date.now() + milliseconds;
    while (!isScanEnabled() && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return isScanEnabled();
}

function checkClear(handle: CustomInstrumentHandle): number {
    const rowsBefore = rows.size;
    handle.onAction!({ widget: "viewer", action: "clear" }, respond);
    const cleared = viewerCleared && rows.size === rowsBefore;
    console.log(cleared ? "PASS Clear empties the console and leaves the meshes" : "FAIL Clear did not empty only the console");
    return cleared ? 0 : 1;
}

async function check(handle: CustomInstrumentHandle, expectations: Expectation[], out: string | null): Promise<number> {
    console.log(`\n${rows.size} rows in the table:`);
    const exported = new Map<string, ParsedObj | null>();
    let failures = 0;
    for (const row of rows.values()) {
        console.log(`  ${Object.values(row.cells).join(" | ")}`);
        const offer = offeredObj(handle, row);
        if (offer !== null && !isOfferedAsExpected(offer, row)) {
            failures++;
            console.log(`FAIL ${row.cells.mesh} was offered as ${JSON.stringify(offer.name)}, ${offer.mediaType}`);
        }
        exported.set(row.id, (offer !== null) ? parseExport(offer, await offer.bytes) : null);
    }

    if (rows.has(LEFT_BY_EARLIER_INSTANCE)) {
        failures++;
        console.log("FAIL a row left in the table by an earlier instance is still there");
    }
    for (const expected of expectations) {
        if (expected.presence === "absent") {
            const found = [...rows.values()].find(row => spans(expected, exported.get(row.id)!));
            failures += (found !== undefined) ? 1 : 0;
            console.log((found !== undefined)
                ? `FAIL ${expected.name} (${expected.how}) is listed as ${found.cells.mesh}: ${found.cells.learned}`
                : `PASS ${expected.name} (${expected.how}) is not listed`);
            continue;
        }
        const match = [...rows.values()].find(row => matches(expected, row, exported.get(row.id)!));
        if (match === undefined) {
            failures++;
            console.log(`FAIL ${expected.name} (${expected.how}): no mesh with ${expected.vertices} vertices and `
                + `${expected.triangles} triangles in [${expected.min}]..[${expected.max}]`);
            continue;
        }
        const obj = exported.get(match.id)!;
        if (obj !== null && out !== null) {
            send({ type: "obj", path: `${out}/${expected.name}.obj`, text: obj.text });
        }
        const listings = [...rows.values()].filter(row => matches(expected, row, exported.get(row.id)!)).length;
        if (listings !== 1) {
            failures++;
            console.log(`FAIL ${expected.name} (${expected.how}) is listed ${listings} times`);
            continue;
        }
        const textureProblem = problemWithTexture(expected, match, obj);
        if (textureProblem !== null) {
            failures++;
            console.log(`FAIL ${expected.name} (${expected.how}) as ${match.cells.mesh}: ${textureProblem}`);
            continue;
        }
        const viewProblem = problemShowing(handle, expected, match);
        if (viewProblem !== null) {
            failures++;
            console.log(`FAIL ${expected.name} (${expected.how}) as ${match.cells.mesh}: ${viewProblem}`);
            continue;
        }
        console.log(`PASS ${expected.name} (${expected.how}) as ${match.cells.mesh}: ${match.cells.learned}`);
    }

    const listed = expectations.filter(expected => expected.presence === "listed");
    const strays = [...rows.values()].filter(row => !listed.some(expected => matches(expected, row, exported.get(row.id)!)));
    for (const stray of strays.slice(0, MOST_STRAYS_NAMED)) {
        failures++;
        console.log(`FAIL ${stray.cells.mesh} is listed and nothing expects it: ${stray.cells.learned}, ${stray.cells.buffers}`);
    }
    if (strays.length > MOST_STRAYS_NAMED) {
        console.log(`FAIL and ${strays.length - MOST_STRAYS_NAMED} more rows that nothing expects`);
    }

    handle.onConsoleInput!({ widget: "viewer", entryId: "1", text: "list" }, {
        ...quietReply,
        output: text => console.log(`list:\n${text}`),
        error: text => console.log(`list error: ${text}`),
    });
    handle.dispose!();
    const written = (out !== null) ? `; OBJ files are in ${out}` : "";
    console.log(`\n${expectations.length - failures} of ${expectations.length} expected meshes found${written}`);
    return failures;
}

function changedHookedCode(): string[] {
    const current = readOnlyDirect3D11();
    const ranges = [...pristineRanges].filter(([name, digest]) => current.get(name) !== digest).map(([name]) => name);
    const addresses = [...pristineCode.keys()].map(key => ptr(key)).sort((a, b) => a.compare(b));
    return [...ranges, ...addresses.filter((address, i) => {
        const next = addresses[i + 1];
        const length = (next !== undefined) ? Math.min(COMPARED_BYTES, next.sub(address).toUInt32()) : COMPARED_BYTES;
        const original = hexOf(pristineCode.get(address.toString())!.slice(0, length));
        return hexOf(address.readByteArray(length)!) !== original;
    }).map(address => `${address} (${DebugSymbol.fromAddress(address)})`)];
}

function hookCandidates(): NativePointer[] {
    const candidates: NativePointer[] = [];
    if (Process.platform === "darwin") {
        const encoders = classesConformingTo(["MTLRenderCommandEncoder"], "/System/Library/Extensions/").MTLRenderCommandEncoder;
        const selectors = ["setVertexBuffer:offset:atIndex:", "drawIndexedPrimitives:indexCount:indexType:indexBuffer:indexBufferOffset:"];
        for (const cls of encoders) {
            for (const selector of selectors) {
                const implementation = implementationOf(cls, selector);
                if (implementation !== null) {
                    candidates.push(implementation);
                }
            }
        }
        const gl = Process.findModuleByName("libGL.dylib");
        for (const name of ["glDrawElements", "glDrawArrays", "glBufferData", "glVertexAttribPointer", "glUnmapBuffer", "glTexImage2D",
            "glCompressedTexImage2D", "glCompressedTexSubImage2D", "glDeleteTextures"]) {
            const address = gl?.findExportByName(name) ?? null;
            if (address !== null) {
                candidates.push(address);
            }
        }
    }
    const modules = Process.enumerateModules();
    if (Process.platform === "linux" && modules.some(module => openGLLibraries.linux.triggers.test(module.name))) {
        const platform = new LinuxGLPlatform();
        candidates.push(...glTapEntryPointNames.flatMap(name => platform.hookTargets(name)));
        platform.dispose();
    }
    if (modules.some(module => vulkanLibraries.loader.test(module.name))) {
        for (const driver of findVulkanDrivers([...tapEntryPointNames, ...pipelineEntryPointNames])) {
            candidates.push(...driver.entryPoints.values());
        }
    }
    return [...new Map(candidates.map(address => [address.toString(), address])).values()];
}

function readOnlyDirect3D11(): Map<string, string> {
    const ranges = new Map<string, string>();
    const d3d11 = Process.enumerateModules().find(module => direct3D11Libraries.runtime.test(module.name));
    for (const range of d3d11?.enumerateRanges("r--").filter(range => !range.protection.includes("w")) ?? []) {
        const kind = range.protection.includes("x") ? "code" : "read-only data, with its vtables,";
        ranges.set(`${d3d11!.name} ${kind} at ${range.base}`, digestOf(range.base.readByteArray(range.size)!));
    }
    return ranges;
}

function offeredObj(handle: CustomInstrumentHandle, row: Row): Offer | null {
    lastOffer = null;
    handle.onAction!({ widget: "meshes", action: "show", item: row.id }, respond);
    handle.onAction!({ widget: "mesh", action: "obj" }, respond);
    return lastOffer;
}

function isOfferedAsExpected(offer: Offer, row: Row): boolean {
    return (offer.name === `${row.cells.mesh}.obj` && offer.mediaType === "model/obj")
        || (offer.name === `${row.cells.mesh}.zip` && offer.mediaType === "application/zip");
}

function parseExport(offer: Offer, bytes: Buffer): ParsedObj {
    if (offer.mediaType !== "application/zip") {
        return parseObj(bytes.toString(), null);
    }
    const archive = storedEntries(bytes);
    const objName = [...archive.keys()].find(name => name.endsWith(".obj"));
    return parseObj((objName !== undefined) ? archive.get(objName)!.toString() : "", archive);
}

function storedEntries(zip: Buffer): Map<string, Buffer> {
    const entries = new Map<string, Buffer>();
    let offset = 0;
    while (offset + 30 <= zip.byteLength && zip.readUInt32LE(offset) === ZIP_LOCAL_HEADER) {
        const size = zip.readUInt32LE(offset + 18);
        const nameLength = zip.readUInt16LE(offset + 26);
        const extraLength = zip.readUInt16LE(offset + 28);
        const start = offset + 30 + nameLength + extraLength;
        entries.set(zip.subarray(offset + 30, offset + 30 + nameLength).toString(), zip.subarray(start, start + size));
        offset = start + size;
    }
    return entries;
}

function parseObj(text: string, archive: Map<string, Buffer> | null): ParsedObj {
    const vertices: number[][] = [];
    const texcoords: number[][] = [];
    let faces = 0;
    for (const line of text.split("\n")) {
        if (line.startsWith("v ")) {
            vertices.push(line.slice(2).split(" ").map(Number));
        } else if (line.startsWith("vt ")) {
            texcoords.push(line.slice(3).split(" ").map(Number));
        } else if (line.startsWith("f ")) {
            faces++;
        }
    }
    return { vertices, texcoords, faces, text, archive };
}

function spans(expected: Expectation, obj: ParsedObj | null): boolean {
    if (obj === null || obj.vertices.length === 0) {
        return false;
    }
    const [min, max] = boundsOf(obj);
    return close(min, expected.min) && close(max, expected.max);
}

function matches(expected: Expectation, row: Row, obj: ParsedObj | null): boolean {
    if (expected.contents !== "cpu-visible") {
        const reason = (expected.contents === "gpu-only") ? "GPU-only" : "before Mesh Finder was added";
        return obj === null && row.cells.learned.includes(reason) && row.cells.triangles === String(expected.triangles);
    }
    if (obj === null || obj.vertices.length !== expected.vertices || obj.faces !== expected.triangles) {
        return false;
    }
    const [min, max] = boundsOf(obj);
    return close(min, expected.min) && close(max, expected.max) && expected.first.every((vertex, i) => close(obj.vertices[i], vertex));
}

function problemWithTexture(expected: Expectation, row: Row, obj: ParsedObj | null): string | null {
    if (expected.texture === undefined || obj === null) {
        return null;
    }
    if (!row.cells.textures.includes(` ${expected.texture.format}`)) {
        return `its Textures cell says ${JSON.stringify(row.cells.textures)}, not ${expected.texture.format}`;
    }
    if (obj.archive === null) {
        return "it was offered as a plain OBJ, without its texture";
    }
    if (expected.texcoords !== undefined) {
        const flipped = expected.texcoords.map(([u, v]) => [u, 1 - v]);
        if (obj.texcoords.length !== expected.vertices || !flipped.every((uv, i) => close(obj.texcoords[i], uv))) {
            return `its OBJ has ${obj.texcoords.length} vt lines, the first ${JSON.stringify(obj.texcoords.slice(0, flipped.length))}`;
        }
    }
    const mtlName = [...obj.archive.keys()].find(name => name.endsWith(".mtl"));
    const mapped = (mtlName !== undefined) ? /^map_Kd (.+)$/m.exec(obj.archive.get(mtlName)!.toString())?.[1] : undefined;
    const png = (mapped !== undefined) ? obj.archive.get(mapped) : undefined;
    if (png === undefined) {
        return `its archive holds ${JSON.stringify([...obj.archive.keys()])} and no PNG its MTL names as map_Kd`;
    }
    const { width, height } = expected.texture;
    if (png.subarray(0, 8).toString("hex") !== PNG_SIGNATURE || png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) {
        return `its map_Kd ${mapped} is not a ${width} × ${height} PNG`;
    }
    return null;
}

function problemShowing(handle: CustomInstrumentHandle, expected: Expectation, row: Row): string | null {
    lastViewState = null;
    handle.onAction!({ widget: "meshes", action: "show", item: row.id }, respond);
    if (expected.contents !== "cpu-visible") {
        const told = lastViewState as ViewState | null;
        if (told === null || told.data !== undefined) {
            return "a mesh with no CPU contents was not shown as empty";
        }
        return (typeof told.value.unshown === "string") ? null : "the viewer was not told why the mesh has nothing to show";
    }
    const shown = lastViewState as ViewState | null;
    if (shown === null) {
        return "Show handed nothing to the viewer";
    }
    const { vertices, triangles } = shown.value;
    if (vertices !== expected.vertices || triangles !== expected.triangles) {
        return `the viewer was told ${vertices} vertices and ${triangles} triangles`;
    }
    if (shown.data === undefined) {
        return "the viewer was handed no data";
    }
    const plainSize = (vertices + triangles) * 12;
    const texture = shown.value.texture;
    const skinSize = (texture !== null) ? vertices * 20 + texture.width * texture.height * 4 : 0;
    if (shown.data.byteLength !== plainSize + skinSize) {
        return `the viewer was handed ${shown.data.byteLength} bytes for ${vertices} vertices and ${triangles} triangles`;
    }
    const positions = new Float32Array(shown.data, 0, vertices * 3);
    const firstVertices = expected.first.map((_, i) => Array.from(positions.subarray(i * 3, i * 3 + 3)));
    if (!expected.first.every((vertex, i) => close(firstVertices[i], vertex))) {
        return `the viewer's first vertices are ${JSON.stringify(firstVertices)}`;
    }
    if (new Uint32Array(shown.data, vertices * 12, triangles * 3).some(index => index >= vertices)) {
        return "the viewer was handed an index out of range";
    }
    return problemWithSkin(expected, shown.value, shown.data, plainSize);
}

function problemWithSkin(expected: Expectation, shown: ViewState["value"], data: ArrayBuffer, offset: number): string | null {
    const texture = shown.texture;
    if (expected.texture === undefined) {
        return (texture === null) ? null : "the viewer was handed a texture for a mesh drawn with none";
    }
    if (texture === null) {
        return "the viewer was handed no texture";
    }
    const { width, height, corners } = expected.texture;
    const fits = Math.max(width, height) <= LARGEST_VIEW_TEXTURE_SIDE;
    if (fits && (texture.width !== width || texture.height !== height)) {
        return `the viewer was handed a ${texture.width} × ${texture.height} texture`;
    }
    const vertices = shown.vertices;
    const interleaved = new Float32Array(data, offset, vertices * 5);
    const shownTexcoords = (expected.texcoords ?? []).map((_, i) => Array.from(interleaved.subarray(i * 5 + 3, i * 5 + 5)));
    if (!(expected.texcoords ?? []).every((uv, i) => close(shownTexcoords[i], uv))) {
        return `the viewer's first UVs are ${JSON.stringify(shownTexcoords)}`;
    }
    if (!fits) {
        return null;
    }
    const words = new Uint32Array(data, offset + vertices * 20, width * height);
    const at = (x: number, y: number) => {
        const word = words[y * width + x];
        return [(word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff, word >>> 24];
    };
    const shownCorners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
    const same = corners.every((texel, i) => texel.every((value, k) => Math.abs(value - shownCorners[i][k]) <= TEXEL_TOLERANCE));
    return same ? null : `the viewer's texture corners are ${JSON.stringify(shownCorners)}, not ${JSON.stringify(corners)}`;
}

function hexOf(bytes: ArrayBuffer): string {
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

function digestOf(bytes: ArrayBuffer): string {
    let hash = 0x811c9dc5;
    for (const word of new Uint32Array(bytes, 0, bytes.byteLength >> 2)) {
        hash = Math.imul(hash ^ word, 0x01000193);
    }
    return `${(hash >>> 0).toString(16)}x${bytes.byteLength}`;
}

function boundsOf(obj: ParsedObj): [number[], number[]] {
    const min = [0, 1, 2].map(axis => Math.min(...obj.vertices.map(vertex => vertex[axis])));
    const max = [0, 1, 2].map(axis => Math.max(...obj.vertices.map(vertex => vertex[axis])));
    return [min, max];
}

function close(actual: number[], expected: number[]): boolean {
    return actual.every((value, i) => Math.abs(value - expected[i]) <= TOLERANCE * Math.max(1, Math.abs(expected[i])));
}
