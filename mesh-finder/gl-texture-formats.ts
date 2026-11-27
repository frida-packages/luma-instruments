import type { AstcFootprint, TextureFormat } from "./texture-format.js";

export interface GLInternalFormat {
    name: string;
    format: TextureFormat | null;
    kind: GLFormatKind;
    transfer: PixelTransfer | null;
}

export type GLFormatKind = "plain" | "renderable" | "compressed";

export interface PixelTransfer {
    format: number;
    type: number;
}

type PlainEntry = [code: number, name: string, format: TextureFormat | null, transferFormat: number, transferType: number,
    kind?: GLFormatKind];

const GL_RED = 0x1903;
const GL_RG = 0x8227;
const GL_RGB = 0x1907;
const GL_RGBA = 0x1908;
const GL_BGRA = 0x80e1;
const GL_ALPHA = 0x1906;
const GL_UNSIGNED_BYTE = 0x1401;
const GL_UNSIGNED_SHORT = 0x1403;
const GL_FLOAT = 0x1406;
const GL_HALF_FLOAT = 0x140b;
const GL_HALF_FLOAT_OES = 0x8d61;
const GL_UNSIGNED_SHORT_4_4_4_4 = 0x8033;
const GL_UNSIGNED_SHORT_5_5_5_1 = 0x8034;
const GL_UNSIGNED_SHORT_5_6_5 = 0x8363;
const GL_UNSIGNED_INT_2_10_10_10_REV = 0x8368;
const GL_UNSIGNED_INT_10F_11F_11F_REV = 0x8c3b;
const GL_UNSIGNED_INT_5_9_9_9_REV = 0x8c3e;
const GL_RGBA8 = 0x8058;
const GL_RGB8 = 0x8051;
const GL_RGBA4 = 0x8056;
const GL_RGB5_A1 = 0x8057;
const GL_RGB565 = 0x8d62;
const GL_R8 = 0x8229;
const GL_RG8 = 0x822b;
const GL_RGBA16F = 0x881a;
const GL_RGB16F = 0x881b;
const GL_RGBA32F = 0x8814;
const GL_RGB32F = 0x8815;
const GL_BGRA8_EXT = 0x93a1;

const plainEntries: PlainEntry[] = [
    [GL_R8, "GL_R8", "r8unorm", GL_RED, GL_UNSIGNED_BYTE, "renderable"],
    [GL_RG8, "GL_RG8", "rg8unorm", GL_RG, GL_UNSIGNED_BYTE, "renderable"],
    [GL_RGB8, "GL_RGB8", "rgb8unorm", GL_RGB, GL_UNSIGNED_BYTE, "renderable"],
    [0x8c41, "GL_SRGB8", "rgb8unorm", GL_RGB, GL_UNSIGNED_BYTE],
    [GL_RGBA8, "GL_RGBA8", "rgba8unorm", GL_RGBA, GL_UNSIGNED_BYTE, "renderable"],
    [0x8c43, "GL_SRGB8_ALPHA8", "rgba8unorm", GL_RGBA, GL_UNSIGNED_BYTE, "renderable"],
    [GL_BGRA8_EXT, "GL_BGRA8_EXT", "bgra8unorm", GL_BGRA, GL_UNSIGNED_BYTE, "renderable"],
    [GL_RGB565, "GL_RGB565", "rgb565", GL_RGB, GL_UNSIGNED_SHORT_5_6_5, "renderable"],
    [GL_RGBA4, "GL_RGBA4", "rgba4444", GL_RGBA, GL_UNSIGNED_SHORT_4_4_4_4, "renderable"],
    [GL_RGB5_A1, "GL_RGB5_A1", "rgb5a1", GL_RGBA, GL_UNSIGNED_SHORT_5_5_5_1, "renderable"],
    [0x8059, "GL_RGB10_A2", "rgb10a2unorm", GL_RGBA, GL_UNSIGNED_INT_2_10_10_10_REV, "renderable"],
    [0x8c3a, "GL_R11F_G11F_B10F", "rg11b10float", GL_RGB, GL_UNSIGNED_INT_10F_11F_11F_REV],
    [0x8c3d, "GL_RGB9_E5", "rgb9e5float", GL_RGB, GL_UNSIGNED_INT_5_9_9_9_REV],
    [0x822a, "GL_R16", "r16unorm", GL_RED, GL_UNSIGNED_SHORT],
    [0x822c, "GL_RG16", "rg16unorm", GL_RG, GL_UNSIGNED_SHORT],
    [0x8054, "GL_RGB16", "rgba16unorm", GL_RGBA, GL_UNSIGNED_SHORT],
    [0x805b, "GL_RGBA16", "rgba16unorm", GL_RGBA, GL_UNSIGNED_SHORT],
    [0x822d, "GL_R16F", "r16float", GL_RED, GL_HALF_FLOAT],
    [0x822f, "GL_RG16F", "rg16float", GL_RG, GL_HALF_FLOAT],
    [GL_RGB16F, "GL_RGB16F", "rgba16float", GL_RGBA, GL_HALF_FLOAT],
    [GL_RGBA16F, "GL_RGBA16F", "rgba16float", GL_RGBA, GL_HALF_FLOAT],
    [0x822e, "GL_R32F", "r32float", GL_RED, GL_FLOAT],
    [0x8230, "GL_RG32F", "rg32float", GL_RG, GL_FLOAT],
    [GL_RGB32F, "GL_RGB32F", "rgba32float", GL_RGBA, GL_FLOAT],
    [GL_RGBA32F, "GL_RGBA32F", "rgba32float", GL_RGBA, GL_FLOAT],
    [GL_RED, "GL_RED", "r8unorm", GL_RED, GL_UNSIGNED_BYTE, "renderable"],
    [GL_RG, "GL_RG", "rg8unorm", GL_RG, GL_UNSIGNED_BYTE, "renderable"],
    [GL_RGB, "GL_RGB", "rgb8unorm", GL_RGB, GL_UNSIGNED_BYTE, "renderable"],
    [3, "3", "rgb8unorm", GL_RGB, GL_UNSIGNED_BYTE],
    [GL_RGBA, "GL_RGBA", "rgba8unorm", GL_RGBA, GL_UNSIGNED_BYTE, "renderable"],
    [4, "4", "rgba8unorm", GL_RGBA, GL_UNSIGNED_BYTE],
    [GL_BGRA, "GL_BGRA", "bgra8unorm", GL_BGRA, GL_UNSIGNED_BYTE, "renderable"],
    [GL_ALPHA, "GL_ALPHA", "a8unorm", GL_ALPHA, GL_UNSIGNED_BYTE],
    [0x803c, "GL_ALPHA8", "a8unorm", GL_ALPHA, GL_UNSIGNED_BYTE],
];

const compressedEntries: [code: number, name: string, format: TextureFormat | null][] = [
    [0x83f0, "GL_COMPRESSED_RGB_S3TC_DXT1_EXT", "bc1"],
    [0x83f1, "GL_COMPRESSED_RGBA_S3TC_DXT1_EXT", "bc1"],
    [0x83f2, "GL_COMPRESSED_RGBA_S3TC_DXT3_EXT", "bc2"],
    [0x83f3, "GL_COMPRESSED_RGBA_S3TC_DXT5_EXT", "bc3"],
    [0x8c4c, "GL_COMPRESSED_SRGB_S3TC_DXT1_EXT", "bc1"],
    [0x8c4d, "GL_COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT", "bc1"],
    [0x8c4e, "GL_COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT", "bc2"],
    [0x8c4f, "GL_COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT", "bc3"],
    [0x8dbb, "GL_COMPRESSED_RED_RGTC1", "bc4unorm"],
    [0x8dbc, "GL_COMPRESSED_SIGNED_RED_RGTC1", "bc4snorm"],
    [0x8dbd, "GL_COMPRESSED_RG_RGTC2", "bc5unorm"],
    [0x8dbe, "GL_COMPRESSED_SIGNED_RG_RGTC2", "bc5snorm"],
    [0x8e8c, "GL_COMPRESSED_RGBA_BPTC_UNORM", "bc7"],
    [0x8e8d, "GL_COMPRESSED_SRGB_ALPHA_BPTC_UNORM", "bc7"],
    [0x8e8e, "GL_COMPRESSED_RGB_BPTC_SIGNED_FLOAT", "bc6hsfloat"],
    [0x8e8f, "GL_COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT", "bc6hufloat"],
    [0x8d64, "GL_ETC1_RGB8_OES", "etc2rgb8"],
    [0x9270, "GL_COMPRESSED_R11_EAC", "eacr11"],
    [0x9271, "GL_COMPRESSED_SIGNED_R11_EAC", null],
    [0x9272, "GL_COMPRESSED_RG11_EAC", "eacrg11"],
    [0x9273, "GL_COMPRESSED_SIGNED_RG11_EAC", null],
    [0x9274, "GL_COMPRESSED_RGB8_ETC2", "etc2rgb8"],
    [0x9275, "GL_COMPRESSED_SRGB8_ETC2", "etc2rgb8"],
    [0x9276, "GL_COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2", "etc2rgb8a1"],
    [0x9277, "GL_COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2", "etc2rgb8a1"],
    [0x9278, "GL_COMPRESSED_RGBA8_ETC2_EAC", "etc2rgba8"],
    [0x9279, "GL_COMPRESSED_SRGB8_ALPHA8_ETC2_EAC", "etc2rgba8"],
    [0x8c00, "GL_COMPRESSED_RGB_PVRTC_4BPPV1_IMG", null],
    [0x8c01, "GL_COMPRESSED_RGB_PVRTC_2BPPV1_IMG", null],
    [0x8c02, "GL_COMPRESSED_RGBA_PVRTC_4BPPV1_IMG", null],
    [0x8c03, "GL_COMPRESSED_RGBA_PVRTC_2BPPV1_IMG", null],
];

const astcFootprints: AstcFootprint[] = ["4x4", "5x4", "5x5", "6x5", "6x6", "8x5", "8x6", "8x8", "10x5", "10x6", "10x8", "10x10",
    "12x10", "12x12"];
const GL_COMPRESSED_RGBA_ASTC_4x4 = 0x93b0;
const GL_COMPRESSED_SRGB8_ALPHA8_ASTC_4x4 = 0x93d0;

const internalFormats = new Map<number, GLInternalFormat>([
    ...plainEntries.map(([code, name, format, transferFormat, transferType, kind]): [number, GLInternalFormat] =>
        [code, { name, format, kind: kind ?? "plain", transfer: { format: transferFormat, type: transferType } }]),
    ...compressedEntries.map(([code, name, format]): [number, GLInternalFormat] =>
        [code, { name, format, kind: "compressed", transfer: null }]),
    ...astcFootprints.flatMap((footprint, i): [number, GLInternalFormat][] => [
        [GL_COMPRESSED_RGBA_ASTC_4x4 + i, { name: `GL_COMPRESSED_RGBA_ASTC_${footprint}_KHR`, format: `astc${footprint}`,
            kind: "compressed", transfer: null }],
        [GL_COMPRESSED_SRGB8_ALPHA8_ASTC_4x4 + i, { name: `GL_COMPRESSED_SRGB8_ALPHA8_ASTC_${footprint}_KHR`,
            format: `astc${footprint}`, kind: "compressed", transfer: null }],
    ]),
]);

const unsizedFormats = new Set([GL_RED, GL_RG, GL_RGB, GL_RGBA, GL_BGRA, GL_ALPHA]);

const sizedByTransfer = new Map<string, number>([
    [`${GL_RED}:${GL_UNSIGNED_BYTE}`, GL_R8],
    [`${GL_RG}:${GL_UNSIGNED_BYTE}`, GL_RG8],
    [`${GL_RGB}:${GL_UNSIGNED_BYTE}`, GL_RGB8],
    [`${GL_RGB}:${GL_UNSIGNED_SHORT_5_6_5}`, GL_RGB565],
    [`${GL_RGB}:${GL_HALF_FLOAT}`, GL_RGB16F],
    [`${GL_RGB}:${GL_HALF_FLOAT_OES}`, GL_RGB16F],
    [`${GL_RGB}:${GL_FLOAT}`, GL_RGB32F],
    [`${GL_RGBA}:${GL_UNSIGNED_BYTE}`, GL_RGBA8],
    [`${GL_RGBA}:${GL_UNSIGNED_SHORT_4_4_4_4}`, GL_RGBA4],
    [`${GL_RGBA}:${GL_UNSIGNED_SHORT_5_5_5_1}`, GL_RGB5_A1],
    [`${GL_RGBA}:${GL_HALF_FLOAT}`, GL_RGBA16F],
    [`${GL_RGBA}:${GL_HALF_FLOAT_OES}`, GL_RGBA16F],
    [`${GL_RGBA}:${GL_FLOAT}`, GL_RGBA32F],
    [`${GL_BGRA}:${GL_UNSIGNED_BYTE}`, GL_BGRA8_EXT],
]);

export function internalFormatOf(code: number): GLInternalFormat {
    return internalFormats.get(code)
        ?? { name: `0x${code.toString(16).padStart(4, "0")}`, format: null, kind: "plain", transfer: null };
}

export function sizedFormatOf(internalFormat: number, format: number, type: number): number {
    return unsizedFormats.has(internalFormat) ? (sizedByTransfer.get(`${format}:${type}`) ?? internalFormat) : internalFormat;
}
