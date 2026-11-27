import type { BufferAccess, GpuTexture, TextureBinding } from "./graphics-backend.js";
import { internalFormatOf, sizedFormatOf, type GLInternalFormat } from "./gl-texture-formats.js";
import type { GLTap, GLTapPlatform, GLTextureFacts, GLTextureUpload } from "./gl-tap.js";
import type { GLFlavor } from "./opengl.js";
import { textureByteLength, type TextureFormat } from "./texture-format.js";

export interface GLProfile {
    api: string;
    flavor: GLFlavor;
    major: number;
    minor: number;
}

interface Sampler {
    unit: number;
    name: string;
}

interface BoundTexture {
    texture: number;
    level: LevelFacts | null;
}

interface LevelFacts {
    width: number;
    height: number;
    internalFormat: number;
}

interface TextureDescription {
    api: string;
    id: string;
    address: string;
    width: number;
    height: number;
    format: TextureFormat | null;
    formatName: string;
    access: BufferAccess;
}

interface TextureShadow {
    generation: number;
    width: number;
    format: TextureFormat;
    bytes: ArrayBuffer;
}

interface BlockSize {
    width: number;
    height: number;
}

const GL_TEXTURE_2D = 0x0de1;
const GL_TEXTURE_BINDING_2D = 0x8069;
const GL_TEXTURE0 = 0x84c0;
const GL_ACTIVE_TEXTURE = 0x84e0;
const GL_TEXTURE_WIDTH = 0x1000;
const GL_TEXTURE_HEIGHT = 0x1001;
const GL_TEXTURE_INTERNAL_FORMAT = 0x1003;
const GL_TEXTURE_COMPRESSED_IMAGE_SIZE = 0x86a0;
const GL_ACTIVE_UNIFORMS = 0x8b86;
const GL_SAMPLER_2D = 0x8b5e;
const GL_PACK_ROW_LENGTH = 0x0d02;
const GL_PACK_SKIP_ROWS = 0x0d03;
const GL_PACK_SKIP_PIXELS = 0x0d04;
const GL_PACK_ALIGNMENT = 0x0d05;
const GL_PIXEL_PACK_BUFFER = 0x88eb;
const GL_PIXEL_PACK_BUFFER_BINDING = 0x88ed;
const GL_PIXEL_UNPACK_BUFFER_BINDING = 0x88ef;
const GL_FRAMEBUFFER = 0x8d40;
const GL_READ_FRAMEBUFFER = 0x8ca8;
const GL_FRAMEBUFFER_BINDING = 0x8ca6;
const GL_READ_FRAMEBUFFER_BINDING = 0x8caa;
const GL_COLOR_ATTACHMENT0 = 0x8ce0;
const GL_FRAMEBUFFER_COMPLETE = 0x8cd5;
const GL_RGBA = 0x1908;
const GL_UNSIGNED_BYTE = 0x1401;
const LONGEST_UNIFORM_NAME = 256;
const READ_BACK_FORMAT: TextureFormat = "rgba8unorm";
const UNKNOWN_FORMAT = "unknown";

export class GLTextures {
    readonly #tap: GLTap;
    readonly #gl: TextureFunctions;
    readonly #shadows = new Map<string, TextureShadow>();

    constructor(platform: GLTapPlatform, tap: GLTap) {
        this.#tap = tap;
        this.#gl = new TextureFunctions(platform);
    }

    bindingsOf(shareGroup: NativePointer, program: number, profile: GLProfile): TextureBinding[] {
        if (program === 0) {
            return [];
        }
        const samplers = this.#gl.samplers(program);
        const units = samplers.map(sampler => sampler.unit);
        this.#tap.noteSamplers(shareGroup, program, units);
        const bound = this.#gl.boundTextures(units, this.#gl.canQueryLevels(profile));
        return samplers.flatMap((sampler, i) => {
            const texture = (bound[i].texture !== 0) ? this.#textureOf(shareGroup, bound[i], profile) : null;
            return (texture !== null) ? [{ slot: sampler.unit, name: sampler.name, texture }] : [];
        });
    }

    onUpload(upload: GLTextureUpload, profile: GLProfile): void {
        const { format, kind } = internalFormatOf(upload.internalFormat);
        if (profile.flavor !== "es" || upload.generation === 0 || format === null || kind !== "compressed") {
            return;
        }
        const key = shadowKey(upload.shareGroup, upload.texture);
        if (upload.kind === "compressed-sub-image") {
            const shadow = this.#shadows.get(key);
            if (shadow !== undefined && shadow.generation === upload.generation && !this.#gl.unpackBufferBound(profile)) {
                patchBlocks(shadow, upload);
            }
            return;
        }
        if (upload.kind === "compressed-image" && (upload.data.isNull() || this.#gl.unpackBufferBound(profile))) {
            this.#shadows.delete(key);
            return;
        }
        const bytes = new ArrayBuffer(textureByteLength(format, upload.width, upload.height));
        if (upload.kind === "compressed-image") {
            new Uint8Array(bytes).set(new Uint8Array(upload.data.readByteArray(Math.min(upload.size, bytes.byteLength))!));
        }
        this.#shadows.set(key, { generation: upload.generation, width: upload.width, format, bytes });
        this.#tap.shadowTexture(upload.shareGroup, upload.texture);
    }

    onDeleted(shareGroup: NativePointer, texture: number): void {
        this.#shadows.delete(shadowKey(shareGroup, texture));
    }

    #textureOf(shareGroup: NativePointer, bound: BoundTexture, profile: GLProfile): GLTexture | null {
        const facts = this.#tap.textureFacts(shareGroup, bound.texture);
        const generation = facts?.generation ?? 0;
        const level = (profile.flavor === "es" && facts !== null) ? levelOf(facts) : bound.level;
        if (level !== null && (level.width === 0 || level.height === 0)) {
            return null;
        }
        const texture = bound.texture;
        const described = (access: BufferAccess, format: TextureFormat | null, formatName: string): TextureDescription => ({
            api: profile.api,
            id: `${profile.api}:${shareGroup}:texture ${texture}:${generation}`,
            address: `texture ${texture}`,
            width: level?.width ?? 0,
            height: level?.height ?? 0,
            format,
            formatName,
            access,
        });
        if (level === null) {
            return new GLTexture(described("unlocated", null, UNKNOWN_FORMAT), unreadable(texture));
        }
        const internal = internalFormatOf(level.internalFormat);
        if (profile.flavor === "desktop") {
            return new GLTexture(described("cpu-readable", internal.format, internal.name),
                () => this.#gl.readImage(texture, level, internal, profile));
        }
        if (internal.kind === "compressed") {
            const shadow = this.#shadows.get(shadowKey(shareGroup, texture));
            return (shadow !== undefined && shadow.generation === generation && generation !== 0)
                ? new GLTexture(described("cpu-readable", internal.format, internal.name), () => shadow.bytes.slice(0))
                : new GLTexture(described("unlocated", internal.format, internal.name), unreadable(texture));
        }
        if (internal.kind === "renderable") {
            return new GLTexture(described("cpu-readable", READ_BACK_FORMAT, internal.name),
                () => this.#gl.readThroughFramebuffer(texture, level, profile));
        }
        return new GLTexture(described("gpu-only", internal.format, internal.name), unreadable(texture));
    }
}

class GLTexture implements GpuTexture {
    readonly api: string;
    readonly id: string;
    readonly address: string;
    readonly label = null;
    readonly width: number;
    readonly height: number;
    readonly format: TextureFormat | null;
    readonly formatName: string;
    readonly access: BufferAccess;
    readonly #read: () => ArrayBuffer;

    constructor(description: TextureDescription, read: () => ArrayBuffer) {
        this.api = description.api;
        this.id = description.id;
        this.address = description.address;
        this.width = description.width;
        this.height = description.height;
        this.format = description.format;
        this.formatName = description.formatName;
        this.access = description.access;
        this.#read = read;
    }

    read(): ArrayBuffer {
        return this.#read();
    }
}

class TextureFunctions {
    readonly #getIntegerv: NativeFunction<void, [number, NativePointerValue]>;
    readonly #activeTexture: NativeFunction<void, [number]>;
    readonly #bindTexture: NativeFunction<void, [number, number]>;
    readonly #bindBuffer: NativeFunction<void, [number, number]>;
    readonly #pixelStorei: NativeFunction<void, [number, number]>;
    readonly #getTexLevelParameteriv: NativeFunction<void, [number, number, number, NativePointerValue]> | null;
    readonly #getTexImage: NativeFunction<void, [number, number, number, number, NativePointerValue]> | null;
    readonly #getCompressedTexImage: NativeFunction<void, [number, number, NativePointerValue]> | null;
    readonly #getProgramiv: NativeFunction<void, [number, number, NativePointerValue]>;
    readonly #getActiveUniform: NativeFunction<void, [number, number, number, NativePointerValue, NativePointerValue,
        NativePointerValue, NativePointerValue]>;
    readonly #getUniformLocation: NativeFunction<number, [number, NativePointerValue]>;
    readonly #getUniformiv: NativeFunction<void, [number, number, NativePointerValue]>;
    readonly #genFramebuffers: NativeFunction<void, [number, NativePointerValue]>;
    readonly #deleteFramebuffers: NativeFunction<void, [number, NativePointerValue]>;
    readonly #bindFramebuffer: NativeFunction<void, [number, number]>;
    readonly #framebufferTexture2D: NativeFunction<void, [number, number, number, number, number]>;
    readonly #checkFramebufferStatus: NativeFunction<number, [number]>;
    readonly #readPixels: NativeFunction<void, [number, number, number, number, number, number, NativePointerValue]>;
    readonly #scratch = Memory.alloc(LONGEST_UNIFORM_NAME + 32);

    constructor(platform: GLTapPlatform) {
        const entry = (name: string) => platform.entryPoint(name)!;
        const optional = (name: string) => platform.entryPoint(name);
        this.#getIntegerv = new NativeFunction(entry("glGetIntegerv"), "void", ["uint32", "pointer"]);
        this.#activeTexture = new NativeFunction(entry("glActiveTexture"), "void", ["uint32"]);
        this.#bindTexture = new NativeFunction(entry("glBindTexture"), "void", ["uint32", "uint32"]);
        this.#bindBuffer = new NativeFunction(entry("glBindBuffer"), "void", ["uint32", "uint32"]);
        this.#pixelStorei = new NativeFunction(entry("glPixelStorei"), "void", ["uint32", "int"]);
        const getTexLevelParameteriv = optional("glGetTexLevelParameteriv");
        const getTexImage = optional("glGetTexImage");
        const getCompressedTexImage = optional("glGetCompressedTexImage");
        this.#getTexLevelParameteriv = (getTexLevelParameteriv !== null)
            ? new NativeFunction(getTexLevelParameteriv, "void", ["uint32", "int", "uint32", "pointer"])
            : null;
        this.#getTexImage = (getTexImage !== null)
            ? new NativeFunction(getTexImage, "void", ["uint32", "int", "uint32", "uint32", "pointer"])
            : null;
        this.#getCompressedTexImage = (getCompressedTexImage !== null)
            ? new NativeFunction(getCompressedTexImage, "void", ["uint32", "int", "pointer"])
            : null;
        this.#getProgramiv = new NativeFunction(entry("glGetProgramiv"), "void", ["uint32", "uint32", "pointer"]);
        this.#getActiveUniform = new NativeFunction(entry("glGetActiveUniform"), "void",
            ["uint32", "uint32", "int", "pointer", "pointer", "pointer", "pointer"]);
        this.#getUniformLocation = new NativeFunction(entry("glGetUniformLocation"), "int", ["uint32", "pointer"]);
        this.#getUniformiv = new NativeFunction(entry("glGetUniformiv"), "void", ["uint32", "int", "pointer"]);
        this.#genFramebuffers = new NativeFunction(entry("glGenFramebuffers"), "void", ["int", "pointer"]);
        this.#deleteFramebuffers = new NativeFunction(entry("glDeleteFramebuffers"), "void", ["int", "pointer"]);
        this.#bindFramebuffer = new NativeFunction(entry("glBindFramebuffer"), "void", ["uint32", "uint32"]);
        this.#framebufferTexture2D = new NativeFunction(entry("glFramebufferTexture2D"), "void",
            ["uint32", "uint32", "uint32", "uint32", "int"]);
        this.#checkFramebufferStatus = new NativeFunction(entry("glCheckFramebufferStatus"), "uint32", ["uint32"]);
        this.#readPixels = new NativeFunction(entry("glReadPixels"), "void",
            ["int", "int", "int", "int", "uint32", "uint32", "pointer"]);
    }

    samplers(program: number): Sampler[] {
        this.#getProgramiv(program, GL_ACTIVE_UNIFORMS, this.#scratch);
        const count = this.#scratch.readS32();
        const name = this.#scratch.add(32);
        const samplers: Sampler[] = [];
        for (let index = 0; index < count; index++) {
            this.#getActiveUniform(program, index, LONGEST_UNIFORM_NAME, this.#scratch, this.#scratch.add(4), this.#scratch.add(8), name);
            if (this.#scratch.add(8).readU32() !== GL_SAMPLER_2D) {
                continue;
            }
            const size = this.#scratch.add(4).readS32();
            const reported = name.readUtf8String()!;
            const elements = (size > 1)
                ? Array.from({ length: size }, (_, element) => `${reported.replace(/\[0\]$/, "")}[${element}]`)
                : [reported];
            for (const element of elements) {
                samplers.push({ unit: this.#unitOf(program, element), name: element });
            }
        }
        return samplers;
    }

    canQueryLevels(profile: GLProfile): boolean {
        const version = profile.major * 10 + profile.minor;
        return this.#getTexLevelParameteriv !== null && (profile.flavor === "desktop" || version >= 31);
    }

    boundTextures(units: number[], withLevels: boolean): BoundTexture[] {
        const active = this.#integer(GL_ACTIVE_TEXTURE);
        try {
            return units.map(unit => {
                this.#activeTexture(GL_TEXTURE0 + unit);
                const texture = this.#integer(GL_TEXTURE_BINDING_2D);
                return { texture, level: (withLevels && texture !== 0) ? this.#levelFacts() : null };
            });
        } finally {
            this.#activeTexture(active);
        }
    }

    unpackBufferBound(profile: GLProfile): boolean {
        return (profile.flavor === "desktop" || profile.major >= 3) && this.#integer(GL_PIXEL_UNPACK_BUFFER_BINDING) !== 0;
    }

    readImage(texture: number, level: LevelFacts, internal: GLInternalFormat, profile: GLProfile): ArrayBuffer {
        const format = internal.format;
        if (format === null || (internal.kind !== "compressed" && (internal.transfer === null || this.#getTexImage === null))
            || (internal.kind === "compressed" && this.#getCompressedTexImage === null)) {
            throw new Error(`texture ${texture} is in ${internal.name}, which cannot be read back`);
        }
        const length = textureByteLength(format, level.width, level.height);
        return this.#withTexture(texture, () => this.#withPackState(profile, () => {
            if (internal.kind === "compressed") {
                const bytes = new ArrayBuffer(Math.max(this.#levelParameter(GL_TEXTURE_COMPRESSED_IMAGE_SIZE), length));
                this.#getCompressedTexImage!(GL_TEXTURE_2D, 0, bytes.unwrap());
                return bytes.slice(0, length);
            }
            const bytes = new ArrayBuffer(length);
            this.#getTexImage!(GL_TEXTURE_2D, 0, internal.transfer!.format, internal.transfer!.type, bytes.unwrap());
            return bytes;
        }));
    }

    readThroughFramebuffer(texture: number, level: LevelFacts, profile: GLProfile): ArrayBuffer {
        const target = (profile.major >= 3) ? GL_READ_FRAMEBUFFER : GL_FRAMEBUFFER;
        const previous = this.#integer((profile.major >= 3) ? GL_READ_FRAMEBUFFER_BINDING : GL_FRAMEBUFFER_BINDING);
        this.#genFramebuffers(1, this.#scratch);
        const framebuffer = this.#scratch.readU32();
        this.#bindFramebuffer(target, framebuffer);
        try {
            this.#framebufferTexture2D(target, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texture, 0);
            if (this.#checkFramebufferStatus(target) !== GL_FRAMEBUFFER_COMPLETE) {
                throw new Error(`texture ${texture} cannot be attached to a framebuffer to be read back`);
            }
            const bytes = new ArrayBuffer(textureByteLength(READ_BACK_FORMAT, level.width, level.height));
            this.#withPackState(profile, () => this.#readPixels(0, 0, level.width, level.height, GL_RGBA, GL_UNSIGNED_BYTE, bytes.unwrap()));
            return bytes;
        } finally {
            this.#bindFramebuffer(target, previous);
            this.#scratch.writeU32(framebuffer);
            this.#deleteFramebuffers(1, this.#scratch);
        }
    }

    #unitOf(program: number, name: string): number {
        const location = this.#getUniformLocation(program, Memory.allocUtf8String(name));
        this.#getUniformiv(program, location, this.#scratch);
        return this.#scratch.readS32();
    }

    #integer(name: number): number {
        this.#getIntegerv(name, this.#scratch);
        return this.#scratch.readU32();
    }

    #levelFacts(): LevelFacts {
        return {
            width: this.#levelParameter(GL_TEXTURE_WIDTH),
            height: this.#levelParameter(GL_TEXTURE_HEIGHT),
            internalFormat: this.#levelParameter(GL_TEXTURE_INTERNAL_FORMAT),
        };
    }

    #levelParameter(parameter: number): number {
        this.#getTexLevelParameteriv!(GL_TEXTURE_2D, 0, parameter, this.#scratch);
        return this.#scratch.readS32();
    }

    #withTexture<T>(texture: number, use: () => T): T {
        const previous = this.#integer(GL_TEXTURE_BINDING_2D);
        this.#bindTexture(GL_TEXTURE_2D, texture);
        try {
            return use();
        } finally {
            this.#bindTexture(GL_TEXTURE_2D, previous);
        }
    }

    #withPackState<T>(profile: GLProfile, use: () => T): T {
        const full = profile.flavor === "desktop" || profile.major >= 3;
        const parameters = full ? [GL_PACK_ALIGNMENT, GL_PACK_ROW_LENGTH, GL_PACK_SKIP_ROWS, GL_PACK_SKIP_PIXELS] : [GL_PACK_ALIGNMENT];
        const saved = parameters.map(parameter => this.#integer(parameter));
        const packBuffer = full ? this.#integer(GL_PIXEL_PACK_BUFFER_BINDING) : 0;
        parameters.forEach(parameter => this.#pixelStorei(parameter, (parameter === GL_PACK_ALIGNMENT) ? 1 : 0));
        if (packBuffer !== 0) {
            this.#bindBuffer(GL_PIXEL_PACK_BUFFER, 0);
        }
        try {
            return use();
        } finally {
            parameters.forEach((parameter, i) => this.#pixelStorei(parameter, saved[i]));
            if (packBuffer !== 0) {
                this.#bindBuffer(GL_PIXEL_PACK_BUFFER, packBuffer);
            }
        }
    }
}

function shadowKey(shareGroup: NativePointer, texture: number): string {
    return `${shareGroup}:${texture}`;
}

function patchBlocks(shadow: TextureShadow, upload: GLTextureUpload): void {
    const block = blockSizeOf(shadow.format);
    const blockBytes = textureByteLength(shadow.format, 1, 1);
    const rowBytes = Math.ceil(upload.width / block.width) * blockBytes;
    const rows = Math.ceil(upload.height / block.height);
    const shadowRowBytes = Math.ceil(shadow.width / block.width) * blockBytes;
    const source = new Uint8Array(upload.data.readByteArray(Math.min(upload.size, rowBytes * rows))!);
    const target = new Uint8Array(shadow.bytes);
    const left = (upload.x / block.width) * blockBytes;
    for (let row = 0; row !== rows; row++) {
        target.set(source.subarray(row * rowBytes, (row + 1) * rowBytes), (upload.y / block.height + row) * shadowRowBytes + left);
    }
}

function blockSizeOf(format: TextureFormat): BlockSize {
    if (format.startsWith("astc")) {
        const [width, height] = format.slice(4).split("x").map(Number);
        return { width, height };
    }
    return { width: 4, height: 4 };
}

function levelOf(facts: GLTextureFacts): LevelFacts {
    return { width: facts.width, height: facts.height, internalFormat: sizedFormatOf(facts.internalFormat, facts.format, facts.type) };
}

function unreadable(texture: number): () => ArrayBuffer {
    return () => {
        throw new Error(`the contents of texture ${texture} were not seen`);
    };
}
