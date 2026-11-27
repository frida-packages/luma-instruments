import { comMethod, release } from "./com-methods.js";
import { API, DebugNames } from "./d3d11-buffers.js";
import { ShaderResourceViewDesc, Texture2DDesc } from "./d3d11-descriptions.pat";
import { textureSlots, viewSlots } from "./d3d11-runtime.js";
import { dxgiFormatName, textureFormatOf } from "./d3d11-texture-formats.js";
import type { BufferAccess, GpuTexture } from "./graphics-backend.js";
import { textureByteLength, type TextureFormat } from "./texture-format.js";

export interface TextureDescription {
    width: number;
    height: number;
    format: TextureFormat | null;
    formatName: string;
    resourceFormat: number;
    packing: TexturePacking | null;
    label: string | null;
}

export interface TexturePacking {
    rowBytes: number;
    rows: number;
}

export interface RetainedTexture {
    handle: NativePointer;
    description: TextureDescription;
}

export interface TextureContents {
    readTexture(texture: RetainedTexture): ArrayBuffer;
}

const SRV_DIMENSION_TEXTURE2D = 4;

export class D3D11Texture implements GpuTexture {
    readonly api = API;
    readonly id: string;
    readonly address: string;
    readonly label: string | null;
    readonly width: number;
    readonly height: number;
    readonly format: TextureFormat | null;
    readonly formatName: string;
    readonly access: BufferAccess = "cpu-readable";
    readonly #retained: RetainedTexture;
    readonly #contents: TextureContents;

    constructor(retained: RetainedTexture, contents: TextureContents) {
        const { description } = retained;
        this.#retained = retained;
        this.#contents = contents;
        this.id = `${API}:${retained.handle}`;
        this.address = retained.handle.toString();
        this.label = description.label;
        this.width = description.width;
        this.height = description.height;
        this.format = description.format;
        this.formatName = description.formatName;
    }

    read(): ArrayBuffer {
        return this.#contents.readTexture(this.#retained);
    }
}

export class TextureDescriber {
    readonly #view = ShaderResourceViewDesc.at(Memory.alloc(ShaderResourceViewDesc.size));
    readonly #resource = Memory.alloc(Process.pointerSize);
    readonly #description = Texture2DDesc.at(Memory.alloc(Texture2DDesc.size));
    readonly #names = new DebugNames();

    retain(view: NativePointer): RetainedTexture | null {
        const viewDescription = this.#view;
        comMethod(view, viewSlots.getDesc, "void", ["pointer"])(view, viewDescription.$address);
        if (viewDescription.viewDimension !== SRV_DIMENSION_TEXTURE2D) {
            return null;
        }
        comMethod(view, viewSlots.getResource, "void", ["pointer"])(view, this.#resource);
        const handle = this.#resource.readPointer();
        return { handle, description: this.#describe(handle, viewDescription.format) };
    }

    #describe(handle: NativePointer, viewFormat: number): TextureDescription {
        const description = this.#description;
        comMethod(handle, textureSlots.getDesc, "void", ["pointer"])(handle, description.$address);
        const { width, height } = description;
        const format = textureFormatOf(viewFormat);
        return {
            width,
            height,
            format,
            formatName: dxgiFormatName(viewFormat),
            resourceFormat: description.format,
            packing: (format !== null) ? packingOf(format, width, height) : null,
            label: this.#names.of(handle),
        };
    }
}

export function releaseTextures(textures: RetainedTexture[]): void {
    for (const { handle } of textures) {
        release(handle);
    }
}

function packingOf(format: TextureFormat, width: number, height: number): TexturePacking {
    const rowBytes = textureByteLength(format, width, 1);
    return { rowBytes, rows: textureByteLength(format, width, height) / rowBytes };
}
