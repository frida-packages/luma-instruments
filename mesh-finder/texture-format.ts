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
