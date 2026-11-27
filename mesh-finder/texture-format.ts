export type PlainFormat =
    | "r8unorm"
    | "a8unorm"
    | "rg8unorm"
    | "rgb8unorm"
    | "rgba8unorm"
    | "bgra8unorm"
    | "bgrx8unorm"
    | "rgb565"
    | "rgba4444"
    | "argb4444"
    | "rgb5a1"
    | "a1rgb5"
    | "rgb10a2unorm"
    | "rg11b10float"
    | "rgb9e5float"
    | "r16unorm"
    | "rg16unorm"
    | "rgba16unorm"
    | "r16float"
    | "rg16float"
    | "rgba16float"
    | "r32float"
    | "rg32float"
    | "rgba32float";

export type BlockFormat =
    | "bc1"
    | "bc2"
    | "bc3"
    | "bc4unorm"
    | "bc4snorm"
    | "bc5unorm"
    | "bc5snorm"
    | "bc6hufloat"
    | "bc6hsfloat"
    | "bc7"
    | "etc2rgb8"
    | "etc2rgb8a1"
    | "etc2rgba8"
    | "eacr11"
    | "eacrg11"
    | AstcFormat;

export type AstcFormat = `astc${AstcFootprint}`;

export type AstcFootprint =
    | "4x4" | "5x4" | "5x5" | "6x5" | "6x6" | "8x5" | "8x6" | "8x8"
    | "10x5" | "10x6" | "10x8" | "10x10" | "12x10" | "12x12";

export type TextureFormat = PlainFormat | BlockFormat;

export interface TextureFootprint {
    width: number;
    height: number;
    bytes: number;
}

const plainTexelBytes: Record<PlainFormat, number> = {
    r8unorm: 1,
    a8unorm: 1,
    rg8unorm: 2,
    rgb8unorm: 3,
    rgba8unorm: 4,
    bgra8unorm: 4,
    bgrx8unorm: 4,
    rgb565: 2,
    rgba4444: 2,
    argb4444: 2,
    rgb5a1: 2,
    a1rgb5: 2,
    rgb10a2unorm: 4,
    rg11b10float: 4,
    rgb9e5float: 4,
    r16unorm: 2,
    rg16unorm: 4,
    rgba16unorm: 8,
    r16float: 2,
    rg16float: 4,
    rgba16float: 8,
    r32float: 4,
    rg32float: 8,
    rgba32float: 16,
};

const eightByteBlocks = new Set<TextureFormat>(["bc1", "bc4unorm", "bc4snorm", "etc2rgb8", "etc2rgb8a1", "eacr11"]);

export function textureByteLength(format: TextureFormat, width: number, height: number): number {
    const footprint = textureFootprint(format);
    return Math.ceil(width / footprint.width) * Math.ceil(height / footprint.height) * footprint.bytes;
}

export function textureFootprint(format: TextureFormat): TextureFootprint {
    if (format in plainTexelBytes) {
        return { width: 1, height: 1, bytes: plainTexelBytes[format as PlainFormat] };
    }
    if (format.startsWith("astc")) {
        const [width, height] = format.slice(4).split("x").map(Number);
        return { width, height, bytes: 16 };
    }
    return { width: 4, height: 4, bytes: eightByteBlocks.has(format) ? 8 : 16 };
}
