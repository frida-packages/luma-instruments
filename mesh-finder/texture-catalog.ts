import type { BufferAccess, GpuTexture } from "./graphics-backend.js";
import { textureByteLength, type TextureFormat } from "./texture-format.js";
import { decodeTexture } from "./texture-kernels.js";

export type TextureContents = "cpu-visible" | Exclude<BufferAccess, "cpu-readable"> | "unsupported" | "too-large" | "unreadable";

export interface CapturedTexture {
    id: string;
    api: string;
    address: string;
    label: string | null;
    width: number;
    height: number;
    format: TextureFormat | null;
    formatName: string;
    contents: TextureContents;
    bytes: ArrayBuffer | null;
    failure: string | null;
}

export const LARGEST_TEXTURE_BYTES = 64 * 1048576;

export class TextureCatalog {
    readonly #byId = new Map<string, CapturedTexture>();

    capture(texture: GpuTexture): CapturedTexture {
        let captured = this.#byId.get(texture.id);
        if (captured === undefined) {
            captured = captureOf(texture);
            this.#byId.set(texture.id, captured);
        }
        return captured;
    }
}

function captureOf(texture: GpuTexture): CapturedTexture {
    const captured: CapturedTexture = {
        id: texture.id,
        api: texture.api,
        address: texture.address,
        label: texture.label,
        width: texture.width,
        height: texture.height,
        format: texture.format,
        formatName: texture.formatName,
        contents: "cpu-visible",
        bytes: null,
        failure: null,
    };
    if (texture.access !== "cpu-readable") {
        captured.contents = texture.access;
    } else if (texture.format === null) {
        captured.contents = "unsupported";
    } else if (textureByteLength(texture.format, texture.width, texture.height) > LARGEST_TEXTURE_BYTES) {
        captured.contents = "too-large";
    } else {
        readInto(captured, texture);
    }
    return captured;
}

function readInto(captured: CapturedTexture, texture: GpuTexture): void {
    try {
        captured.bytes = texture.read();
    } catch (error) {
        captured.contents = "unreadable";
        captured.failure = (error as Error).message;
    }
}

export function decodedPixels(texture: CapturedTexture): Uint8Array {
    return decodeTexture(texture.bytes!, texture.format!, texture.width, texture.height);
}
