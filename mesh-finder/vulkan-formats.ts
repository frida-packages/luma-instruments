import type { AstcFootprint, BlockFormat, PlainFormat, TextureFormat } from "./texture-format.js";

export interface VulkanTextureFormat {
    name: string;
    format: TextureFormat;
}

const plainFormats: [number, string, PlainFormat][] = [
    [2, "VK_FORMAT_R4G4B4A4_UNORM_PACK16", "rgba4444"],
    [4, "VK_FORMAT_R5G6B5_UNORM_PACK16", "rgb565"],
    [6, "VK_FORMAT_R5G5B5A1_UNORM_PACK16", "rgb5a1"],
    [8, "VK_FORMAT_A1R5G5B5_UNORM_PACK16", "a1rgb5"],
    [9, "VK_FORMAT_R8_UNORM", "r8unorm"],
    [15, "VK_FORMAT_R8_SRGB", "r8unorm"],
    [16, "VK_FORMAT_R8G8_UNORM", "rg8unorm"],
    [22, "VK_FORMAT_R8G8_SRGB", "rg8unorm"],
    [23, "VK_FORMAT_R8G8B8_UNORM", "rgb8unorm"],
    [29, "VK_FORMAT_R8G8B8_SRGB", "rgb8unorm"],
    [37, "VK_FORMAT_R8G8B8A8_UNORM", "rgba8unorm"],
    [43, "VK_FORMAT_R8G8B8A8_SRGB", "rgba8unorm"],
    [44, "VK_FORMAT_B8G8R8A8_UNORM", "bgra8unorm"],
    [50, "VK_FORMAT_B8G8R8A8_SRGB", "bgra8unorm"],
    [51, "VK_FORMAT_A8B8G8R8_UNORM_PACK32", "rgba8unorm"],
    [57, "VK_FORMAT_A8B8G8R8_SRGB_PACK32", "rgba8unorm"],
    [64, "VK_FORMAT_A2B10G10R10_UNORM_PACK32", "rgb10a2unorm"],
    [70, "VK_FORMAT_R16_UNORM", "r16unorm"],
    [76, "VK_FORMAT_R16_SFLOAT", "r16float"],
    [77, "VK_FORMAT_R16G16_UNORM", "rg16unorm"],
    [83, "VK_FORMAT_R16G16_SFLOAT", "rg16float"],
    [91, "VK_FORMAT_R16G16B16A16_UNORM", "rgba16unorm"],
    [97, "VK_FORMAT_R16G16B16A16_SFLOAT", "rgba16float"],
    [100, "VK_FORMAT_R32_SFLOAT", "r32float"],
    [103, "VK_FORMAT_R32G32_SFLOAT", "rg32float"],
    [109, "VK_FORMAT_R32G32B32A32_SFLOAT", "rgba32float"],
    [122, "VK_FORMAT_B10G11R11_UFLOAT_PACK32", "rg11b10float"],
    [123, "VK_FORMAT_E5B9G9R9_UFLOAT_PACK32", "rgb9e5float"],
    [1000340000, "VK_FORMAT_A4R4G4B4_UNORM_PACK16", "argb4444"],
    [1000470001, "VK_FORMAT_A8_UNORM", "a8unorm"],
];

const blockFormats: [number, string, BlockFormat][] = [
    [131, "VK_FORMAT_BC1_RGB_UNORM_BLOCK", "bc1"],
    [132, "VK_FORMAT_BC1_RGB_SRGB_BLOCK", "bc1"],
    [133, "VK_FORMAT_BC1_RGBA_UNORM_BLOCK", "bc1"],
    [134, "VK_FORMAT_BC1_RGBA_SRGB_BLOCK", "bc1"],
    [135, "VK_FORMAT_BC2_UNORM_BLOCK", "bc2"],
    [136, "VK_FORMAT_BC2_SRGB_BLOCK", "bc2"],
    [137, "VK_FORMAT_BC3_UNORM_BLOCK", "bc3"],
    [138, "VK_FORMAT_BC3_SRGB_BLOCK", "bc3"],
    [139, "VK_FORMAT_BC4_UNORM_BLOCK", "bc4unorm"],
    [140, "VK_FORMAT_BC4_SNORM_BLOCK", "bc4snorm"],
    [141, "VK_FORMAT_BC5_UNORM_BLOCK", "bc5unorm"],
    [142, "VK_FORMAT_BC5_SNORM_BLOCK", "bc5snorm"],
    [143, "VK_FORMAT_BC6H_UFLOAT_BLOCK", "bc6hufloat"],
    [144, "VK_FORMAT_BC6H_SFLOAT_BLOCK", "bc6hsfloat"],
    [145, "VK_FORMAT_BC7_UNORM_BLOCK", "bc7"],
    [146, "VK_FORMAT_BC7_SRGB_BLOCK", "bc7"],
    [147, "VK_FORMAT_ETC2_R8G8B8_UNORM_BLOCK", "etc2rgb8"],
    [148, "VK_FORMAT_ETC2_R8G8B8_SRGB_BLOCK", "etc2rgb8"],
    [149, "VK_FORMAT_ETC2_R8G8B8A1_UNORM_BLOCK", "etc2rgb8a1"],
    [150, "VK_FORMAT_ETC2_R8G8B8A1_SRGB_BLOCK", "etc2rgb8a1"],
    [151, "VK_FORMAT_ETC2_R8G8B8A8_UNORM_BLOCK", "etc2rgba8"],
    [152, "VK_FORMAT_ETC2_R8G8B8A8_SRGB_BLOCK", "etc2rgba8"],
    [153, "VK_FORMAT_EAC_R11_UNORM_BLOCK", "eacr11"],
    [155, "VK_FORMAT_EAC_R11G11_UNORM_BLOCK", "eacrg11"],
];

const astcFootprints: AstcFootprint[] = ["4x4", "5x4", "5x5", "6x5", "6x6", "8x5", "8x6", "8x8", "10x5", "10x6", "10x8", "10x10", "12x10",
    "12x12"];
const FIRST_ASTC_FORMAT = 157;

const otherFormatNames = new Map<number, string>([
    [0, "VK_FORMAT_UNDEFINED"],
    [30, "VK_FORMAT_B8G8R8_UNORM"],
    [36, "VK_FORMAT_B8G8R8_SRGB"],
    [124, "VK_FORMAT_D16_UNORM"],
    [125, "VK_FORMAT_X8_D24_UNORM_PACK32"],
    [126, "VK_FORMAT_D32_SFLOAT"],
    [127, "VK_FORMAT_S8_UINT"],
    [128, "VK_FORMAT_D16_UNORM_S8_UINT"],
    [129, "VK_FORMAT_D24_UNORM_S8_UINT"],
    [130, "VK_FORMAT_D32_SFLOAT_S8_UINT"],
    [154, "VK_FORMAT_EAC_R11_SNORM_BLOCK"],
    [156, "VK_FORMAT_EAC_R11G11_SNORM_BLOCK"],
]);

export const vulkanTextureFormats = new Map<number, VulkanTextureFormat>([
    ...[...plainFormats, ...blockFormats].map(([code, name, format]): [number, VulkanTextureFormat] => [code, { name, format }]),
    ...astcFootprints.flatMap(footprint => astcFormats(footprint)),
]);

export function vulkanFormatName(code: number): string {
    return vulkanTextureFormats.get(code)?.name ?? otherFormatNames.get(code) ?? `VkFormat ${code}`;
}

function astcFormats(footprint: AstcFootprint): [number, VulkanTextureFormat][] {
    const code = FIRST_ASTC_FORMAT + 2 * astcFootprints.indexOf(footprint);
    const format: TextureFormat = `astc${footprint}`;
    return ["UNORM", "SRGB"].map((encoding, i) => [code + i, { name: `VK_FORMAT_ASTC_${footprint}_${encoding}_BLOCK`, format }]);
}
