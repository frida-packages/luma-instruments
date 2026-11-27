import type {
    BufferAccess,
    BufferSearch,
    DrawCall,
    GeometryObserver,
    GpuBuffer,
    GraphicsBackend,
    IndexFormat,
    AttributeLayout,
    Topology,
    VertexStream,
} from "./graphics-backend.js";
import { GLTap, type GLDraw, type GLTapPlatform, type GLUpload } from "./gl-tap.js";
import { GLTextures, type GLProfile } from "./gl-textures.js";
import { positionAttribute, texcoordAttribute } from "./vertex-attributes.js";
import { attributeFormat, type ComponentType, type AttributeFormat } from "./vertex-format.js";

export type GLFlavor = "desktop" | "es";

export interface GLPlatform extends GLTapPlatform {
    flavorOfCurrentContext(): GLFlavor;
    watchLibraries(added: () => void): void;
    dispose(): void;
}

interface Attribute {
    location: number;
    buffer: number;
    offset: number;
    stride: number;
    format: AttributeFormat | null;
}

type ShadowReport = "unreported" | "reported";

interface Shadow {
    shareGroup: NativePointer;
    flavor: GLFlavor;
    name: number;
    bytes: ArrayBuffer;
    report: ShadowReport;
}

interface PendingSearch {
    resolve(search: BufferSearch): void;
    giveUp: ReturnType<typeof setTimeout>;
}

const GL_VERSION = 0x1f02;
const GL_ARRAY_BUFFER = 0x8892;
const GL_ARRAY_BUFFER_BINDING = 0x8894;
const GL_BUFFER_SIZE = 0x8764;
const GL_BUFFER_MAPPED = 0x88bc;
const GL_MAP_READ_BIT = 0x0001;
const GL_ACTIVE_ATTRIBUTES = 0x8b89;
const GL_VERTEX_ATTRIB_ARRAY_ENABLED = 0x8622;
const GL_VERTEX_ATTRIB_ARRAY_SIZE = 0x8623;
const GL_VERTEX_ATTRIB_ARRAY_STRIDE = 0x8624;
const GL_VERTEX_ATTRIB_ARRAY_TYPE = 0x8625;
const GL_VERTEX_ATTRIB_ARRAY_NORMALIZED = 0x886a;
const GL_VERTEX_ATTRIB_ARRAY_BUFFER_BINDING = 0x889f;
const GL_VERTEX_ATTRIB_ARRAY_POINTER = 0x8645;
const ATTRIBUTE_SLOTS = 16;
const LONGEST_ATTRIBUTE_NAME = 256;
const SEARCH_GIVE_UP_AFTER_MISSES = 4096;
const LARGEST_BUFFER_NAME = 1 << 20;
const SHADOW_SETTLE_MS = 250;
const FRAME_WAIT_MS = 3000;

const apiNames: Record<GLFlavor, string> = { desktop: "OpenGL", es: "OpenGL ES" };

const topologies = new Map<number, Topology>([[0, "point-list"], [4, "triangle-list"], [5, "triangle-strip"], [6, "triangle-fan"]]);
const indexFormats = new Map<number, IndexFormat>([[0x1401, "uint8"], [0x1403, "uint16"], [0x1405, "uint32"]]);
const componentSizes = new Map<number, number>([[0x1400, 1], [0x1401, 1], [0x1402, 2], [0x1403, 2], [0x1406, 4], [0x140b, 2]]);

export class GLBackend implements GraphicsBackend {
    readonly api = "OpenGL";
    readonly #platform: GLPlatform;
    readonly #observer: GeometryObserver;
    readonly #gl: GLFunctions;
    readonly #tap: GLTap;
    readonly #textures: GLTextures;
    readonly #shadows = new Map<string, Shadow>();
    readonly #profiles = new Map<string, GLProfile>();
    readonly #pendingSearches: PendingSearch[] = [];
    #shadowFlush: ReturnType<typeof setTimeout> | null = null;

    constructor(platform: GLPlatform, observer: GeometryObserver) {
        this.#platform = platform;
        this.#observer = observer;
        this.#gl = new GLFunctions(platform);
        this.#tap = new GLTap(platform, {
            newDraw: draw => this.#onDraw(draw),
            frame: shareGroup => this.#onFrame(shareGroup),
            upload: upload => this.#onUpload(upload),
            deleted: (shareGroup, buffer) => this.#shadows.delete(shadowKey(shareGroup, buffer)),
            textureUpload: upload => this.#textures.onUpload(upload, this.#profileOf(upload.shareGroup)),
            textureDeleted: (shareGroup, texture) => this.#textures.onDeleted(shareGroup, texture),
        });
        this.#textures = new GLTextures(platform, this.#tap);
        platform.watchLibraries(() => this.#tap.hookEntryPoints());
    }

    watchDraws(): void {
        this.#tap.observeDraws("observed");
    }

    unwatchDraws(): void {
        this.#tap.observeDraws("ignored");
    }

    findBuffers(): Promise<BufferSearch> {
        return new Promise(resolve => {
            const search: PendingSearch = { resolve, giveUp: setTimeout(() => this.#giveUp(search), FRAME_WAIT_MS) };
            this.#pendingSearches.push(search);
            this.#tap.requestFrame();
        });
    }

    dispose(): void {
        for (const search of this.#pendingSearches) {
            clearTimeout(search.giveUp);
        }
        this.#platform.dispose();
        this.#tap.dispose();
        if (this.#shadowFlush !== null) {
            clearTimeout(this.#shadowFlush);
        }
    }

    #onDraw(draw: GLDraw): void {
        const call = this.#drawCallOf(draw, new Map());
        if (call !== null) {
            this.#observer.observeDraw(call);
        }
    }

    #drawCallOf(draw: GLDraw, known: Map<number, GLBuffer | null>): DrawCall | null {
        const topology = topologies.get(draw.mode);
        if (topology === undefined) {
            return null;
        }
        const indexFormat = (draw.type !== 0) ? indexFormats.get(draw.type) : undefined;
        if (draw.type !== 0 && (indexFormat === undefined || draw.elementBuffer === 0)) {
            return null;
        }
        const attributes = this.#gl.enabledAttributes().filter(attribute => attribute.buffer !== 0);
        const streams: VertexStream[] = attributes.flatMap(attribute => {
            const buffer = this.#bufferNamed(draw.shareGroup, attribute.buffer, known);
            return (buffer !== null) ? [{ slot: attribute.location, buffer, offset: attribute.offset, stride: attribute.stride }] : [];
        });
        const indexBuffer = (indexFormat !== undefined) ? this.#bufferNamed(draw.shareGroup, draw.elementBuffer, known) : null;
        if (indexFormat !== undefined && indexBuffer === null) {
            return null;
        }
        const profile = this.#profileOf(draw.shareGroup);
        const names = this.#gl.attributeNames(draw.program);
        return {
            api: profile.api,
            topology,
            streams,
            bystanders: [],
            position: layoutOf(positionAttribute(attributes, names), names),
            texcoord: layoutOf(texcoordAttribute(attributes, names), names),
            textures: this.#textures.bindingsOf(draw.shareGroup, draw.program, profile),
            indices: (indexFormat !== undefined)
                ? { buffer: indexBuffer!, offset: draw.indices, format: indexFormat, count: draw.count }
                : null,
            firstVertex: draw.first,
            vertexCount: (indexFormat === undefined) ? draw.count : 0,
            baseVertex: draw.baseVertex,
            noteSlotGuess() {
            },
        };
    }

    #onFrame(shareGroup: NativePointer): void {
        const searches = this.#pendingSearches.splice(0);
        const buffers = this.#liveBuffers(shareGroup);
        this.#observer.observeBuffers(buffers);
        for (const search of searches) {
            clearTimeout(search.giveUp);
            search.resolve({ buffers: buffers.length, detail: `buffer names in share group ${shareGroup}, read on the GL thread` });
        }
    }

    #liveBuffers(shareGroup: NativePointer): GpuBuffer[] {
        const buffers: GpuBuffer[] = [];
        let misses = 0;
        for (let name = 1; name < LARGEST_BUFFER_NAME && misses < SEARCH_GIVE_UP_AFTER_MISSES; name++) {
            if (!this.#gl.isBuffer(name)) {
                misses++;
                continue;
            }
            misses = 0;
            const buffer = this.#bufferNamed(shareGroup, name, new Map());
            if (buffer !== null) {
                buffers.push(buffer);
            }
        }
        return buffers;
    }

    #onUpload(upload: GLUpload): void {
        const key = shadowKey(upload.shareGroup, upload.buffer);
        let shadow = this.#shadows.get(key);
        if (upload.kind === "data") {
            shadow = { shareGroup: upload.shareGroup, flavor: this.#flavorOf(upload.shareGroup), name: upload.buffer,
                bytes: new ArrayBuffer(upload.length), report: "unreported" };
            if (!upload.data.isNull()) {
                new Uint8Array(shadow.bytes).set(new Uint8Array(upload.data.readByteArray(upload.length)!));
            }
            this.#shadows.set(key, shadow);
            this.#tap.shadow(upload.shareGroup, upload.buffer);
        } else if (shadow !== undefined) {
            const room = shadow.bytes.byteLength - upload.offset;
            const length = Math.min((upload.length !== 0) ? upload.length : room, room);
            new Uint8Array(shadow.bytes, upload.offset, length).set(new Uint8Array(upload.data.readByteArray(length)!));
        } else {
            return;
        }
        shadow.report = "unreported";
        this.#scheduleShadowFlush();
    }

    #scheduleShadowFlush(): void {
        if (this.#shadowFlush !== null) {
            clearTimeout(this.#shadowFlush);
        }
        this.#shadowFlush = setTimeout(() => {
            this.#shadowFlush = null;
            const fresh = [...this.#shadows.values()].filter(shadow => shadow.report === "unreported");
            for (const shadow of fresh) {
                shadow.report = "reported";
            }
            this.#observer.observeBuffers(fresh.map(shadow =>
                new GLBuffer(shadow.flavor, shadow.shareGroup, shadow.name, shadow.bytes.byteLength, shadow.bytes, this.#gl)));
        }, SHADOW_SETTLE_MS);
    }

    #giveUp(search: PendingSearch): void {
        this.#pendingSearches.splice(this.#pendingSearches.indexOf(search), 1);
        search.resolve({ buffers: 0, detail: `no frame was drawn within ${FRAME_WAIT_MS / 1000} s; scan again once it draws` });
    }

    #bufferNamed(shareGroup: NativePointer, name: number, known: Map<number, GLBuffer | null>): GLBuffer | null {
        let buffer = known.get(name);
        if (buffer === undefined) {
            const shadow = this.#shadows.get(shadowKey(shareGroup, name))?.bytes ?? null;
            const size = (shadow !== null) ? shadow.byteLength : this.#gl.readableSize(name);
            buffer = (size !== null) ? new GLBuffer(this.#flavorOf(shareGroup), shareGroup, name, size, shadow, this.#gl) : null;
            known.set(name, buffer);
        }
        return buffer;
    }

    #flavorOf(shareGroup: NativePointer): GLFlavor {
        return this.#profileOf(shareGroup).flavor;
    }

    #profileOf(shareGroup: NativePointer): GLProfile {
        const key = shareGroup.toString();
        let profile = this.#profiles.get(key);
        if (profile === undefined) {
            const flavor = this.#platform.flavorOfCurrentContext();
            const [major, minor] = this.#gl.version();
            profile = { api: apiNames[flavor], flavor, major, minor };
            this.#profiles.set(key, profile);
        }
        return profile;
    }
}

class GLBuffer implements GpuBuffer {
    readonly api: string;
    readonly id: string;
    readonly address: string;
    readonly label = null;
    readonly byteLength: number;
    readonly access: BufferAccess = "cpu-readable";
    readonly #flavor: GLFlavor;
    readonly #name: number;
    readonly #shadow: ArrayBuffer | null;
    readonly #gl: GLFunctions;

    constructor(
        flavor: GLFlavor,
        shareGroup: NativePointer,
        name: number,
        byteLength: number,
        shadow: ArrayBuffer | null,
        gl: GLFunctions,
    ) {
        this.#flavor = flavor;
        this.#name = name;
        this.#shadow = shadow;
        this.#gl = gl;
        this.api = apiNames[flavor];
        this.id = `${this.api}:${shareGroup}:${name}`;
        this.address = `buffer ${name}`;
        this.byteLength = byteLength;
    }

    get creationOrder(): number {
        return this.#name;
    }

    read(offset: number, length: number): ArrayBuffer {
        if (offset < 0 || length < 0 || offset + length > this.byteLength) {
            throw new Error(`read of ${length} bytes at ${offset} is outside ${this.address}, which holds ${this.byteLength}`);
        }
        return (this.#shadow !== null)
            ? this.#shadow.slice(offset, offset + length)
            : this.#gl.readBack(this.#name, offset, length, this.#flavor);
    }
}

class GLFunctions {
    readonly #getIntegerv: NativeFunction<void, [number, NativePointerValue]>;
    readonly #isBufferNamed: NativeFunction<number, [number]>;
    readonly #bindBuffer: NativeFunction<void, [number, number]>;
    readonly #getBufferParameteriv: NativeFunction<void, [number, number, NativePointerValue]>;
    readonly #getBufferSubData: NativeFunction<void, [number, number, number, NativePointerValue]> | null;
    readonly #mapBufferRange: NativeFunction<NativePointer, [number, number, number, number]> | null;
    readonly #unmapBuffer: NativeFunction<number, [number]>;
    readonly #getVertexAttribiv: NativeFunction<void, [number, number, NativePointerValue]>;
    readonly #getVertexAttribPointerv: NativeFunction<void, [number, number, NativePointerValue]>;
    readonly #getProgramiv: NativeFunction<void, [number, number, NativePointerValue]>;
    readonly #getActiveAttrib: NativeFunction<void, [number, number, number, NativePointerValue, NativePointerValue,
        NativePointerValue, NativePointerValue]>;
    readonly #getAttribLocation: NativeFunction<number, [number, NativePointerValue]>;
    readonly #getString: NativeFunction<NativePointer, [number]>;
    readonly #scratch = Memory.alloc(LONGEST_ATTRIBUTE_NAME + 32);

    constructor(platform: GLPlatform) {
        const entry = (name: string) => platform.entryPoint(name)!;
        this.#getIntegerv = new NativeFunction(entry("glGetIntegerv"), "void", ["uint32", "pointer"]);
        this.#isBufferNamed = new NativeFunction(entry("glIsBuffer"), "uint8", ["uint32"]);
        this.#bindBuffer = new NativeFunction(entry("glBindBuffer"), "void", ["uint32", "uint32"]);
        this.#getBufferParameteriv = new NativeFunction(entry("glGetBufferParameteriv"), "void", ["uint32", "uint32", "pointer"]);
        const getBufferSubData = platform.entryPoint("glGetBufferSubData");
        const mapBufferRange = platform.entryPoint("glMapBufferRange");
        this.#getBufferSubData = (getBufferSubData !== null)
            ? new NativeFunction(getBufferSubData, "void", ["uint32", "long", "long", "pointer"])
            : null;
        this.#mapBufferRange = (mapBufferRange !== null)
            ? new NativeFunction(mapBufferRange, "pointer", ["uint32", "long", "long", "uint32"])
            : null;
        this.#unmapBuffer = new NativeFunction(entry("glUnmapBuffer"), "uint8", ["uint32"]);
        this.#getVertexAttribiv = new NativeFunction(entry("glGetVertexAttribiv"), "void", ["uint32", "uint32", "pointer"]);
        this.#getVertexAttribPointerv = new NativeFunction(entry("glGetVertexAttribPointerv"), "void", ["uint32", "uint32", "pointer"]);
        this.#getProgramiv = new NativeFunction(entry("glGetProgramiv"), "void", ["uint32", "uint32", "pointer"]);
        this.#getActiveAttrib = new NativeFunction(entry("glGetActiveAttrib"), "void",
            ["uint32", "uint32", "int", "pointer", "pointer", "pointer", "pointer"]);
        this.#getAttribLocation = new NativeFunction(entry("glGetAttribLocation"), "int", ["uint32", "pointer"]);
        this.#getString = new NativeFunction(entry("glGetString"), "pointer", ["uint32"]);
    }

    enabledAttributes(): Attribute[] {
        const attributes: Attribute[] = [];
        for (let location = 0; location !== ATTRIBUTE_SLOTS; location++) {
            if (this.#attribute(location, GL_VERTEX_ATTRIB_ARRAY_ENABLED) === 0) {
                continue;
            }
            const size = this.#attribute(location, GL_VERTEX_ATTRIB_ARRAY_SIZE);
            const type = this.#attribute(location, GL_VERTEX_ATTRIB_ARRAY_TYPE);
            const stride = this.#attribute(location, GL_VERTEX_ATTRIB_ARRAY_STRIDE);
            const buffer = this.#attribute(location, GL_VERTEX_ATTRIB_ARRAY_BUFFER_BINDING);
            this.#getVertexAttribPointerv(location, GL_VERTEX_ATTRIB_ARRAY_POINTER, this.#scratch);
            attributes.push({
                location,
                buffer,
                offset: this.#scratch.readPointer().toUInt32(),
                stride: (stride !== 0) ? stride : size * (componentSizes.get(type) ?? 4),
                format: glFormat(type, size, this.#attribute(location, GL_VERTEX_ATTRIB_ARRAY_NORMALIZED) !== 0),
            });
        }
        return attributes;
    }

    readableSize(name: number): number | null {
        return this.#withArrayBuffer(name, () => {
            const size = this.#bufferParameter(GL_BUFFER_SIZE);
            return (size > 0 && this.#bufferParameter(GL_BUFFER_MAPPED) === 0) ? size : null;
        });
    }

    version(): number[] {
        const [, major, minor] = /(\d+)\.(\d+)/.exec(this.#getString(GL_VERSION).readUtf8String()!)!;
        return [Number(major), Number(minor)];
    }

    attributeNames(program: number): Map<number, string> {
        const names = new Map<number, string>();
        if (program === 0) {
            return names;
        }
        this.#getProgramiv(program, GL_ACTIVE_ATTRIBUTES, this.#scratch);
        const count = this.#scratch.readS32();
        const name = this.#scratch.add(32);
        for (let index = 0; index < count; index++) {
            this.#getActiveAttrib(program, index, LONGEST_ATTRIBUTE_NAME, this.#scratch, this.#scratch.add(4), this.#scratch.add(8), name);
            const location = this.#getAttribLocation(program, name);
            if (location >= 0) {
                names.set(location, name.readUtf8String()!);
            }
        }
        return names;
    }

    isBuffer(name: number): boolean {
        return this.#isBufferNamed(name) !== 0;
    }

    readBack(name: number, offset: number, length: number, flavor: GLFlavor): ArrayBuffer {
        const bytes = new ArrayBuffer(length);
        this.#withArrayBuffer(name, () => {
            if (flavor === "desktop" && this.#getBufferSubData !== null) {
                this.#getBufferSubData(GL_ARRAY_BUFFER, offset, length, bytes.unwrap());
            } else if (this.#mapBufferRange === null) {
                throw new Error(`buffer ${name} cannot be read back without glMapBufferRange`);
            } else {
                const mapped = this.#mapBufferRange(GL_ARRAY_BUFFER, offset, length, GL_MAP_READ_BIT);
                if (mapped.isNull()) {
                    throw new Error(`buffer ${name} could not be mapped for reading`);
                }
                new Uint8Array(bytes).set(new Uint8Array(mapped.readByteArray(length)!));
                this.#unmapBuffer(GL_ARRAY_BUFFER);
            }
        });
        return bytes;
    }

    #attribute(location: number, parameter: number): number {
        this.#getVertexAttribiv(location, parameter, this.#scratch);
        return this.#scratch.readS32();
    }

    #withArrayBuffer<T>(name: number, use: () => T): T {
        this.#getIntegerv(GL_ARRAY_BUFFER_BINDING, this.#scratch);
        const previous = this.#scratch.readU32();
        this.#bindBuffer(GL_ARRAY_BUFFER, name);
        try {
            return use();
        } finally {
            this.#bindBuffer(GL_ARRAY_BUFFER, previous);
        }
    }

    #bufferParameter(parameter: number): number {
        this.#getBufferParameteriv(GL_ARRAY_BUFFER, parameter, this.#scratch);
        return this.#scratch.readS32();
    }
}

function shadowKey(shareGroup: NativePointer, buffer: number): string {
    return `${shareGroup}:${buffer}`;
}

function layoutOf(chosen: Attribute | undefined, names: Map<number, string>): AttributeLayout | null {
    if (chosen === undefined) {
        return null;
    }
    const name = names.get(chosen.location);
    return {
        slot: chosen.location,
        stride: chosen.stride,
        offset: 0,
        format: chosen.format!,
        source: `glVertexAttribPointer attribute ${chosen.location}${(name !== undefined) ? ` "${name}"` : ""}`,
    };
}

function glFormat(type: number, size: number, normalized: boolean): AttributeFormat | null {
    const component: ComponentType | undefined = {
        0x1400: normalized ? "snorm8" : undefined,
        0x1401: normalized ? "unorm8" : undefined,
        0x1402: normalized ? "snorm16" : "sint16",
        0x1403: normalized ? "unorm16" : "uint16",
        0x1406: "float32",
        0x140b: "float16",
    }[type] as ComponentType | undefined;
    return (component !== undefined) ? attributeFormat(component, size) : null;
}
