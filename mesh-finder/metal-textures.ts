import type { BufferAccess, GpuTexture } from "./graphics-backend.js";
import { metalPixelFormat, type MetalPixelFormat } from "./metal-pixel-formats.js";
import { objcSend, selector, stringFrom } from "./objc.js";
import { textureByteLength, type TextureFormat } from "./texture-format.js";

interface TextureFacts {
    label: string | null;
    width: number;
    height: number;
    pixelFormat: MetalPixelFormat;
    access: BufferAccess;
}

const GPU_ONLY_STORAGE_MODES = new Set([2, 3]);
const MULTISAMPLE_TYPES = new Set([4, 8]);

let selectorTable: ReturnType<typeof selectorsByName> | null = null;
let copyBytes: ReturnType<typeof getBytesFunction> | null = null;

export function metalTextureOf(object: NativePointer): MetalTexture {
    const names = selectors();
    return new MetalTexture(object, {
        label: stringFrom(objcSend.pointer(object, names.label)),
        width: objcSend.uint64(object, names.width).toNumber(),
        height: objcSend.uint64(object, names.height).toNumber(),
        pixelFormat: metalPixelFormat(objcSend.uint64(object, names.pixelFormat).toNumber()),
        access: accessOf(object),
    });
}

export class MetalTexture implements GpuTexture {
    readonly api = "Metal";
    readonly id: string;
    readonly address: string;
    readonly label: string | null;
    readonly width: number;
    readonly height: number;
    readonly format: TextureFormat | null;
    readonly formatName: string;
    readonly access: BufferAccess;
    readonly #object: NativePointer;

    constructor(object: NativePointer, facts: TextureFacts) {
        this.#object = object;
        this.id = `Metal:texture:${object}`;
        this.address = object.toString();
        this.label = facts.label;
        this.width = facts.width;
        this.height = facts.height;
        this.format = facts.pixelFormat.format;
        this.formatName = facts.pixelFormat.name;
        this.access = facts.access;
    }

    read(): ArrayBuffer {
        if (this.access === "gpu-only") {
            throw new Error(`${this.address} cannot be read by the CPU`);
        }
        if (this.format === null) {
            throw new Error(`${this.address} is in ${this.formatName}, which is not read`);
        }
        const bytesPerRow = textureByteLength(this.format, this.width, 1);
        const length = textureByteLength(this.format, this.width, this.height);
        const bytes = Memory.alloc(length);
        copyBytes ??= getBytesFunction();
        copyBytes(this.#object, selectors().getBytes, bytes, bytesPerRow, length, [[0, 0, 0], [this.width, this.height, 1]], 0, 0);
        return bytes.readByteArray(length)!;
    }
}

function accessOf(object: NativePointer): BufferAccess {
    const names = selectors();
    const readable = !GPU_ONLY_STORAGE_MODES.has(objcSend.uint64(object, names.storageMode).toNumber())
        && !MULTISAMPLE_TYPES.has(objcSend.uint64(object, names.textureType).toNumber())
        && !objcSend.flag(object, names.isFramebufferOnly);
    return readable ? "cpu-readable" : "gpu-only";
}

function getBytesFunction() {
    const region: NativeFunctionArgumentType = [["uint64", "uint64", "uint64"], ["uint64", "uint64", "uint64"]];
    return new NativeFunction(Module.getGlobalExportByName("objc_msgSend"), "void",
        ["pointer", "pointer", "pointer", "uint64", "uint64", region, "uint64", "uint64"]);
}

function selectors() {
    selectorTable ??= selectorsByName();
    return selectorTable;
}

function selectorsByName() {
    return {
        label: selector("label"),
        width: selector("width"),
        height: selector("height"),
        pixelFormat: selector("pixelFormat"),
        storageMode: selector("storageMode"),
        textureType: selector("textureType"),
        isFramebufferOnly: selector("isFramebufferOnly"),
        getBytes: selector("getBytes:bytesPerRow:bytesPerImage:fromRegion:mipmapLevel:slice:"),
    };
}
