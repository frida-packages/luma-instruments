import type { AstcFootprint, TextureFormat } from "./texture-format.js";

export interface MetalPixelFormat {
    name: string;
    format: TextureFormat | null;
}

const supportedFormats: [value: number, name: string, format: TextureFormat][] = [
    [1, "A8Unorm", "a8unorm"],
    [10, "R8Unorm", "r8unorm"],
    [11, "R8Unorm_sRGB", "r8unorm"],
    [20, "R16Unorm", "r16unorm"],
    [25, "R16Float", "r16float"],
    [30, "RG8Unorm", "rg8unorm"],
    [31, "RG8Unorm_sRGB", "rg8unorm"],
    [40, "B5G6R5Unorm", "rgb565"],
    [41, "A1BGR5Unorm", "rgb5a1"],
    [42, "ABGR4Unorm", "rgba4444"],
    [43, "BGR5A1Unorm", "a1rgb5"],
    [45, "RGB8Unorm", "rgb8unorm"],
    [55, "R32Float", "r32float"],
    [60, "RG16Unorm", "rg16unorm"],
    [65, "RG16Float", "rg16float"],
    [70, "RGBA8Unorm", "rgba8unorm"],
    [71, "RGBA8Unorm_sRGB", "rgba8unorm"],
    [80, "BGRA8Unorm", "bgra8unorm"],
    [81, "BGRA8Unorm_sRGB", "bgra8unorm"],
    [90, "RGB10A2Unorm", "rgb10a2unorm"],
    [92, "RG11B10Float", "rg11b10float"],
    [93, "RGB9E5Float", "rgb9e5float"],
    [105, "RG32Float", "rg32float"],
    [110, "RGBA16Unorm", "rgba16unorm"],
    [115, "RGBA16Float", "rgba16float"],
    [125, "RGBA32Float", "rgba32float"],
    [130, "BC1_RGBA", "bc1"],
    [131, "BC1_RGBA_sRGB", "bc1"],
    [132, "BC2_RGBA", "bc2"],
    [133, "BC2_RGBA_sRGB", "bc2"],
    [134, "BC3_RGBA", "bc3"],
    [135, "BC3_RGBA_sRGB", "bc3"],
    [140, "BC4_RUnorm", "bc4unorm"],
    [141, "BC4_RSnorm", "bc4snorm"],
    [142, "BC5_RGUnorm", "bc5unorm"],
    [143, "BC5_RGSnorm", "bc5snorm"],
    [150, "BC6H_RGBFloat", "bc6hsfloat"],
    [151, "BC6H_RGBUfloat", "bc6hufloat"],
    [152, "BC7_RGBAUnorm", "bc7"],
    [153, "BC7_RGBAUnorm_sRGB", "bc7"],
    [170, "EAC_R11Unorm", "eacr11"],
    [174, "EAC_RG11Unorm", "eacrg11"],
    [178, "EAC_RGBA8", "etc2rgba8"],
    [179, "EAC_RGBA8_sRGB", "etc2rgba8"],
    [180, "ETC2_RGB8", "etc2rgb8"],
    [181, "ETC2_RGB8_sRGB", "etc2rgb8"],
    [182, "ETC2_RGB8A1", "etc2rgb8a1"],
    [183, "ETC2_RGB8A1_sRGB", "etc2rgb8a1"],
];

const astcFootprints: [srgb: number, ldr: number, hdr: number, footprint: AstcFootprint][] = [
    [186, 204, 222, "4x4"], [187, 205, 223, "5x4"], [188, 206, 224, "5x5"], [189, 207, 225, "6x5"], [190, 208, 226, "6x6"],
    [192, 210, 228, "8x5"], [193, 211, 229, "8x6"], [194, 212, 230, "8x8"], [195, 213, 231, "10x5"], [196, 214, 232, "10x6"],
    [197, 215, 233, "10x8"], [198, 216, 234, "10x10"], [199, 217, 235, "12x10"], [200, 218, 236, "12x12"],
];

const unsupportedFormats: [value: number, name: string][] = [
    [12, "R8Snorm"], [13, "R8Uint"], [14, "R8Sint"], [22, "R16Snorm"], [23, "R16Uint"], [24, "R16Sint"],
    [32, "RG8Snorm"], [33, "RG8Uint"], [34, "RG8Sint"], [46, "RGB8Snorm"], [47, "RGB8Uint"], [48, "RGB8Sint"],
    [53, "R32Uint"], [54, "R32Sint"], [62, "RG16Snorm"], [63, "RG16Uint"], [64, "RG16Sint"],
    [72, "RGBA8Snorm"], [73, "RGBA8Uint"], [74, "RGBA8Sint"],
    [91, "RGB10A2Uint"], [94, "BGR10A2Unorm"], [95, "RGB16Unorm"], [96, "RGB16Snorm"], [97, "RGB16Uint"], [98, "RGB16Sint"],
    [99, "RGB16Float"], [103, "RG32Uint"], [104, "RG32Sint"], [112, "RGBA16Snorm"], [113, "RGBA16Uint"], [114, "RGBA16Sint"],
    [120, "RGB32Uint"], [121, "RGB32Sint"], [122, "RGB32Float"], [123, "RGBA32Uint"], [124, "RGBA32Sint"],
    [160, "PVRTC_RGB_2BPP"], [161, "PVRTC_RGB_2BPP_sRGB"], [162, "PVRTC_RGB_4BPP"], [163, "PVRTC_RGB_4BPP_sRGB"],
    [164, "PVRTC_RGBA_2BPP"], [165, "PVRTC_RGBA_2BPP_sRGB"], [166, "PVRTC_RGBA_4BPP"], [167, "PVRTC_RGBA_4BPP_sRGB"],
    [172, "EAC_R11Snorm"], [176, "EAC_RG11Snorm"], [240, "GBGR422"], [241, "BGRG422"],
    [250, "Depth16Unorm"], [252, "Depth32Float"], [253, "Stencil8"], [255, "Depth24Unorm_Stencil8"],
    [260, "Depth32Float_Stencil8"], [261, "X32_Stencil8"], [262, "X24_Stencil8"],
    [552, "BGRA10_XR"], [553, "BGRA10_XR_sRGB"], [554, "BGR10_XR"], [555, "BGR10_XR_sRGB"],
];

const pixelFormats = new Map<number, MetalPixelFormat>([
    ...supportedFormats.map(([value, name, format]) => entryOf(value, name, format)),
    ...astcFootprints.flatMap(([srgb, ldr, hdr, footprint]) => [
        entryOf(srgb, `ASTC_${footprint}_sRGB`, `astc${footprint}`),
        entryOf(ldr, `ASTC_${footprint}_LDR`, `astc${footprint}`),
        entryOf(hdr, `ASTC_${footprint}_HDR`, null),
    ]),
    ...unsupportedFormats.map(([value, name]) => entryOf(value, name, null)),
]);

export function metalPixelFormat(value: number): MetalPixelFormat {
    return pixelFormats.get(value) ?? { name: `MTLPixelFormat(${value})`, format: null };
}

function entryOf(value: number, name: string, format: TextureFormat | null): [number, MetalPixelFormat] {
    return [value, { name: `MTLPixelFormat${name}`, format }];
}
