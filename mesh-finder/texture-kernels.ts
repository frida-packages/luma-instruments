import type { TextureFormat } from "./texture-format.js";

export interface ViewPixels {
    pixels: ArrayBuffer;
    width: number;
    height: number;
}

const source = `
#include <glib.h>
#include <string.h>

typedef enum
{
  R8UNORM, A8UNORM, RG8UNORM, RGB8UNORM, RGBA8UNORM, BGRA8UNORM, BGRX8UNORM,
  RGB565, RGBA4444, ARGB4444, RGB5A1, A1RGB5, RGB10A2UNORM, RG11B10FLOAT, RGB9E5FLOAT,
  R16UNORM, RG16UNORM, RGBA16UNORM, R16FLOAT, RG16FLOAT, RGBA16FLOAT, R32FLOAT, RG32FLOAT, RGBA32FLOAT,
  BC1, BC2, BC3, BC4UNORM, BC4SNORM, BC5UNORM, BC5SNORM, BC6HUFLOAT, BC6HSFLOAT, BC7,
  ETC2RGB8, ETC2RGB8A1, ETC2RGBA8, EACR11, EACRG11,
  ASTC4X4, ASTC5X4, ASTC5X5, ASTC6X5, ASTC6X6, ASTC8X5, ASTC8X6, ASTC8X8,
  ASTC10X5, ASTC10X6, ASTC10X8, ASTC10X10, ASTC12X10, ASTC12X12
} Format;

#define FIRST_BLOCK_FORMAT BC1
#define LARGEST_BLOCK_TEXELS (12 * 12)
#define ERROR_COLOR 0xffff00ffu
#define OPAQUE_BLACK 0xff000000u
#define TRANSPARENT_BLACK 0
#define BC6H_DIRECT_TWO_REGION_MODE 9
#define BC6H_FIRST_ONE_REGION_MODE 10
#define BC6H_TWO_REGION_HEADER_BITS 82
#define BC6H_ONE_REGION_HEADER_BITS 65
#define BC6H_PARTITION_FIELD 12
#define ETC_DIFFERENTIAL_BIT 2u
#define ETC_FLIP_BIT 1u
#define ASTC_VOID_EXTENT 0x1fc
#define ASTC_GRID_PADDING 16
#define ASTC_LARGEST_WEIGHTS 64
#define ASTC_FEWEST_WEIGHT_BITS 24
#define ASTC_MOST_WEIGHT_BITS 96
#define ASTC_MOST_COLOR_VALUES 18
#define ASTC_SMALLEST_COLOR_RANGE 4
#define ASTC_LARGEST_COLOR_RANGE 20
#define ASTC_SMALL_BLOCK_TEXELS 31
#define ASTC_SINGLE_PARTITION_COLOR_START 17
#define ASTC_PARTITIONED_COLOR_START 29
#define ASTC_SINGLE_PARTITION_COLOR_BITS 111
#define ASTC_PARTITIONED_COLOR_BITS 99
#define ASTC_PLANE_SELECTOR_BITS 2
#define ASTC_PRECISION_BITS 12
#define NO_PLANE 4
#define PNG_OVERHEAD 64
#define STORED_OVERHEAD 6
#define WINDOW_SIZE 32768
#define WINDOW_MASK (WINDOW_SIZE - 1)
#define HASH_BITS 15
#define HASH_SIZE (1 << HASH_BITS)
#define NO_POSITION 0xffffffffu
#define SHORTEST_MATCH 4
#define LONGEST_MATCH 258
#define LONGEST_CHAIN 8
#define GOOD_MATCH 32
#define LONGEST_INSERTED_MATCH 16
#define BLOCK_TOKENS 32768
#define LONGEST_STORED 65535
#define END_OF_BLOCK 256
#define LITERAL_LENGTH_SYMBOLS 286
#define DISTANCE_SYMBOLS 30
#define CODE_LENGTH_SYMBOLS 19
#define LONGEST_CODE 15
#define LONGEST_CODE_LENGTH_CODE 7
#define ADLER_MODULUS 65521
#define ADLER_RUN 5552

typedef struct { guint8 width; guint8 height; guint8 size; } BlockShape;
typedef struct { guint8 subsets; guint8 partition_bits; guint8 rotation_bits; guint8 selector_bits; guint8 color_bits;
    guint8 alpha_bits; guint8 endpoint_pbits; guint8 shared_pbits; guint8 index_bits; guint8 second_index_bits; } Bc7Mode;
typedef struct { guint32 width; guint32 height; gboolean dual_plane; guint32 range; } AstcGrid;
typedef struct { guint16 symbol; guint16 distance; } Token;
typedef struct { guint8 * out; gsize length; guint64 bits; guint32 bit_count; } BitWriter;
typedef struct { guint16 codes[288]; guint8 lengths[288]; } Huffman;
typedef struct { Huffman literals; Huffman distances; Huffman runs; } BlockCodes;
typedef struct { guint32 symbols[LITERAL_LENGTH_SYMBOLS]; guint32 weights[LITERAL_LENGTH_SYMBOLS];
    guint32 parents[2 * LITERAL_LENGTH_SYMBOLS]; guint32 node_weights[2 * LITERAL_LENGTH_SYMBOLS];
    guint32 depths[2 * LITERAL_LENGTH_SYMBOLS]; } CodeScratch;
typedef struct { guint32 entries[256]; } CrcTable;
typedef struct { guint8 length_symbols[LONGEST_MATCH + 1]; guint8 near_distance_symbols[512]; guint8 far_distance_symbols[256];
    Huffman fixed_literals; Huffman fixed_distances; } DeflateTables;

static const guint16 two_subset_partitions[64] = {
  0xcccc, 0x8888, 0xeeee, 0xecc8, 0xc880, 0xfeec, 0xfec8, 0xec80,
  0xc800, 0xffec, 0xfe80, 0xe800, 0xffe8, 0xff00, 0xfff0, 0xf000,
  0xf710, 0x008e, 0x7100, 0x08ce, 0x008c, 0x7310, 0x3100, 0x8cce,
  0x088c, 0x3110, 0x6666, 0x366c, 0x17e8, 0x0ff0, 0x718e, 0x399c,
  0xaaaa, 0xf0f0, 0x5a5a, 0x33cc, 0x3c3c, 0x55aa, 0x9696, 0xa55a,
  0x73ce, 0x13c8, 0x324c, 0x3bdc, 0x6996, 0xc33c, 0x9966, 0x0660,
  0x0272, 0x04e4, 0x4e40, 0x2720, 0xc936, 0x936c, 0x39c6, 0x639c,
  0x9336, 0x9cc6, 0x817e, 0xe718, 0xccf0, 0x0fcc, 0x7744, 0xee22
};

static const guint32 three_subset_partitions[64] = {
  0xaa685050, 0x6a5a5040, 0x5a5a4200, 0x5450a0a8, 0xa5a50000, 0xa0a05050, 0x5555a0a0, 0x5a5a5050,
  0xaa550000, 0xaa555500, 0xaaaa5500, 0x90909090, 0x94949494, 0xa4a4a4a4, 0xa9a59450, 0x2a0a4250,
  0xa5945040, 0x0a425054, 0xa5a5a500, 0x55a0a0a0, 0xa8a85454, 0x6a6a4040, 0xa4a45000, 0x1a1a0500,
  0x0050a4a4, 0xaaa59090, 0x14696914, 0x69691400, 0xa08585a0, 0xaa821414, 0x50a4a450, 0x6a5a0200,
  0xa9a58000, 0x5090a0a8, 0xa8a09050, 0x24242424, 0x00aa5500, 0x24924924, 0x24499224, 0x50a50a50,
  0x500aa550, 0xaaaa4444, 0x66660000, 0xa5a0a5a0, 0x50a050a0, 0x69286928, 0x44aaaa44, 0x66666600,
  0xaa444444, 0x54a854a8, 0x95809580, 0x96969600, 0xa85454a8, 0x80959580, 0xaa141414, 0x96960000,
  0xaaaa1414, 0xa05050a0, 0xa0a5a5a0, 0x96000000, 0x40804080, 0xa9a8a9a8, 0xaaaaaa44, 0x2a4a5254
};

static const guint8 second_subset_anchors[64] = {
  15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
  15, 2, 8, 2, 2, 8, 8, 15, 2, 8, 2, 2, 8, 8, 2, 2,
  15, 15, 6, 8, 2, 8, 15, 15, 2, 8, 2, 2, 2, 15, 15, 6,
  6, 2, 6, 8, 15, 15, 2, 2, 15, 15, 15, 15, 15, 2, 2, 15
};

static const guint8 three_subset_second_anchors[64] = {
  3, 3, 15, 15, 8, 3, 15, 15, 8, 8, 6, 6, 6, 5, 3, 3,
  3, 3, 8, 15, 3, 3, 6, 10, 5, 8, 8, 6, 8, 5, 15, 15,
  8, 15, 3, 5, 6, 10, 8, 15, 15, 3, 15, 5, 15, 15, 15, 15,
  3, 15, 5, 5, 5, 8, 5, 10, 5, 10, 8, 13, 15, 12, 3, 3
};

static const guint8 three_subset_third_anchors[64] = {
  15, 8, 8, 3, 15, 15, 3, 8, 15, 15, 15, 15, 15, 15, 15, 8,
  15, 8, 15, 3, 15, 8, 15, 8, 3, 15, 6, 10, 15, 15, 10, 8,
  15, 3, 15, 10, 10, 8, 9, 10, 6, 15, 8, 15, 3, 6, 6, 8,
  15, 3, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 3, 15, 15, 8
};

static const guint8 bc6h_layouts[14][80] = {
  { 100, 164, 180, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 16, 17, 18, 19, 20, 116, 96, 97, 98, 99, 80, 81, 82, 83, 84, 176, 112, 113, 114, 115, 144, 145, 146, 147, 148, 177, 160, 161, 162, 163, 32, 33, 34, 35, 36, 178, 48, 49, 50, 51, 52, 179, 192, 193, 194, 195, 196 },
  { 101, 116, 117, 0, 1, 2, 3, 4, 5, 6, 176, 177, 164, 64, 65, 66, 67, 68, 69, 70, 165, 178, 100, 128, 129, 130, 131, 132, 133, 134, 179, 181, 180, 16, 17, 18, 19, 20, 21, 96, 97, 98, 99, 80, 81, 82, 83, 84, 85, 112, 113, 114, 115, 144, 145, 146, 147, 148, 149, 160, 161, 162, 163, 32, 33, 34, 35, 36, 37, 48, 49, 50, 51, 52, 53, 192, 193, 194, 195, 196 },
  { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 16, 17, 18, 19, 20, 10, 96, 97, 98, 99, 80, 81, 82, 83, 74, 176, 112, 113, 114, 115, 144, 145, 146, 147, 138, 177, 160, 161, 162, 163, 32, 33, 34, 35, 36, 178, 48, 49, 50, 51, 52, 179, 192, 193, 194, 195, 196, 255, 255, 255 },
  { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 16, 17, 18, 19, 10, 116, 96, 97, 98, 99, 80, 81, 82, 83, 84, 74, 112, 113, 114, 115, 144, 145, 146, 147, 138, 177, 160, 161, 162, 163, 32, 33, 34, 35, 176, 178, 48, 49, 50, 51, 100, 179, 192, 193, 194, 195, 196, 255, 255, 255 },
  { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 16, 17, 18, 19, 10, 164, 96, 97, 98, 99, 80, 81, 82, 83, 74, 176, 112, 113, 114, 115, 144, 145, 146, 147, 148, 138, 160, 161, 162, 163, 32, 33, 34, 35, 177, 178, 48, 49, 50, 51, 180, 179, 192, 193, 194, 195, 196, 255, 255, 255 },
  { 0, 1, 2, 3, 4, 5, 6, 7, 8, 164, 64, 65, 66, 67, 68, 69, 70, 71, 72, 100, 128, 129, 130, 131, 132, 133, 134, 135, 136, 180, 16, 17, 18, 19, 20, 116, 96, 97, 98, 99, 80, 81, 82, 83, 84, 176, 112, 113, 114, 115, 144, 145, 146, 147, 148, 177, 160, 161, 162, 163, 32, 33, 34, 35, 36, 178, 48, 49, 50, 51, 52, 179, 192, 193, 194, 195, 196, 255, 255, 255 },
  { 0, 1, 2, 3, 4, 5, 6, 7, 116, 164, 64, 65, 66, 67, 68, 69, 70, 71, 178, 100, 128, 129, 130, 131, 132, 133, 134, 135, 179, 180, 16, 17, 18, 19, 20, 21, 96, 97, 98, 99, 80, 81, 82, 83, 84, 176, 112, 113, 114, 115, 144, 145, 146, 147, 148, 177, 160, 161, 162, 163, 32, 33, 34, 35, 36, 37, 48, 49, 50, 51, 52, 53, 192, 193, 194, 195, 196, 255, 255, 255 },
  { 0, 1, 2, 3, 4, 5, 6, 7, 176, 164, 64, 65, 66, 67, 68, 69, 70, 71, 101, 100, 128, 129, 130, 131, 132, 133, 134, 135, 117, 180, 16, 17, 18, 19, 20, 116, 96, 97, 98, 99, 80, 81, 82, 83, 84, 85, 112, 113, 114, 115, 144, 145, 146, 147, 148, 177, 160, 161, 162, 163, 32, 33, 34, 35, 36, 178, 48, 49, 50, 51, 52, 179, 192, 193, 194, 195, 196, 255, 255, 255 },
  { 0, 1, 2, 3, 4, 5, 6, 7, 177, 164, 64, 65, 66, 67, 68, 69, 70, 71, 165, 100, 128, 129, 130, 131, 132, 133, 134, 135, 181, 180, 16, 17, 18, 19, 20, 116, 96, 97, 98, 99, 80, 81, 82, 83, 84, 176, 112, 113, 114, 115, 144, 145, 146, 147, 148, 149, 160, 161, 162, 163, 32, 33, 34, 35, 36, 178, 48, 49, 50, 51, 52, 179, 192, 193, 194, 195, 196, 255, 255, 255 },
  { 0, 1, 2, 3, 4, 5, 116, 176, 177, 164, 64, 65, 66, 67, 68, 69, 101, 165, 178, 100, 128, 129, 130, 131, 132, 133, 117, 179, 181, 180, 16, 17, 18, 19, 20, 21, 96, 97, 98, 99, 80, 81, 82, 83, 84, 85, 112, 113, 114, 115, 144, 145, 146, 147, 148, 149, 160, 161, 162, 163, 32, 33, 34, 35, 36, 37, 48, 49, 50, 51, 52, 53, 192, 193, 194, 195, 196, 255, 255, 255 },
  { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255 },
  { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 16, 17, 18, 19, 20, 21, 22, 23, 24, 10, 80, 81, 82, 83, 84, 85, 86, 87, 88, 74, 144, 145, 146, 147, 148, 149, 150, 151, 152, 138, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255 },
  { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 16, 17, 18, 19, 20, 21, 22, 23, 11, 10, 80, 81, 82, 83, 84, 85, 86, 87, 75, 74, 144, 145, 146, 147, 148, 149, 150, 151, 139, 138, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255 },
  { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 16, 17, 18, 19, 15, 14, 13, 12, 11, 10, 80, 81, 82, 83, 79, 78, 77, 76, 75, 74, 144, 145, 146, 147, 143, 142, 141, 140, 139, 138, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255 }
};

static const guint8 astc_weight_values[142] = {
  0, 64, 0, 32, 64, 0, 21, 43, 64, 0, 16, 32, 48, 64, 0, 64,
  12, 52, 25, 39, 0, 9, 18, 27, 37, 46, 55, 64, 0, 64, 7, 57,
  14, 50, 21, 43, 28, 36, 0, 64, 17, 47, 5, 59, 23, 41, 11, 53,
  28, 36, 0, 4, 8, 12, 17, 21, 25, 29, 35, 39, 43, 47, 52, 56,
  60, 64, 0, 64, 16, 48, 3, 61, 19, 45, 6, 58, 23, 41, 9, 55,
  26, 38, 13, 51, 29, 35, 0, 64, 8, 56, 16, 48, 24, 40, 2, 62,
  11, 53, 19, 45, 27, 37, 5, 59, 13, 51, 22, 42, 30, 34, 0, 2,
  4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 34, 36,
  38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64
};

static const guint8 astc_weight_offsets[12] = { 0, 2, 5, 9, 14, 20, 28, 38, 50, 66, 86, 110 };

static const guint8 astc_color_values[1192] = {
  0, 255, 51, 204, 102, 153, 0, 36, 73, 109, 146, 182, 219, 255, 0, 255,
  28, 227, 56, 199, 84, 171, 113, 142, 0, 255, 69, 186, 23, 232, 92, 163,
  46, 209, 116, 139, 0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187,
  204, 221, 238, 255, 0, 255, 67, 188, 13, 242, 80, 175, 27, 228, 94, 161,
  40, 215, 107, 148, 54, 201, 121, 134, 0, 255, 33, 222, 66, 189, 99, 156,
  11, 244, 44, 211, 77, 178, 110, 145, 22, 233, 55, 200, 88, 167, 121, 134,
  0, 8, 16, 24, 33, 41, 49, 57, 66, 74, 82, 90, 99, 107, 115, 123,
  132, 140, 148, 156, 165, 173, 181, 189, 198, 206, 214, 222, 231, 239, 247, 255,
  0, 255, 32, 223, 65, 190, 97, 158, 6, 249, 39, 216, 71, 184, 104, 151,
  13, 242, 45, 210, 78, 177, 110, 145, 19, 236, 52, 203, 84, 171, 117, 138,
  26, 229, 58, 197, 91, 164, 123, 132, 0, 255, 16, 239, 32, 223, 48, 207,
  65, 190, 81, 174, 97, 158, 113, 142, 5, 250, 21, 234, 38, 217, 54, 201,
  70, 185, 86, 169, 103, 152, 119, 136, 11, 244, 27, 228, 43, 212, 59, 196,
  76, 179, 92, 163, 108, 147, 124, 131, 0, 4, 8, 12, 16, 20, 24, 28,
  32, 36, 40, 44, 48, 52, 56, 60, 65, 69, 73, 77, 81, 85, 89, 93,
  97, 101, 105, 109, 113, 117, 121, 125, 130, 134, 138, 142, 146, 150, 154, 158,
  162, 166, 170, 174, 178, 182, 186, 190, 195, 199, 203, 207, 211, 215, 219, 223,
  227, 231, 235, 239, 243, 247, 251, 255, 0, 255, 16, 239, 32, 223, 48, 207,
  64, 191, 80, 175, 96, 159, 112, 143, 3, 252, 19, 236, 35, 220, 51, 204,
  67, 188, 83, 172, 100, 155, 116, 139, 6, 249, 22, 233, 38, 217, 54, 201,
  71, 184, 87, 168, 103, 152, 119, 136, 9, 246, 25, 230, 42, 213, 58, 197,
  74, 181, 90, 165, 106, 149, 122, 133, 13, 242, 29, 226, 45, 210, 61, 194,
  77, 178, 93, 162, 109, 146, 125, 130, 0, 255, 8, 247, 16, 239, 24, 231,
  32, 223, 40, 215, 48, 207, 56, 199, 64, 191, 72, 183, 80, 175, 88, 167,
  96, 159, 104, 151, 112, 143, 120, 135, 2, 253, 10, 245, 18, 237, 26, 229,
  35, 220, 43, 212, 51, 204, 59, 196, 67, 188, 75, 180, 83, 172, 91, 164,
  99, 156, 107, 148, 115, 140, 123, 132, 5, 250, 13, 242, 21, 234, 29, 226,
  37, 218, 45, 210, 53, 202, 61, 194, 70, 185, 78, 177, 86, 169, 94, 161,
  102, 153, 110, 145, 118, 137, 126, 129, 0, 2, 4, 6, 8, 10, 12, 14,
  16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46,
  48, 50, 52, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 78,
  80, 82, 84, 86, 88, 90, 92, 94, 96, 98, 100, 102, 104, 106, 108, 110,
  112, 114, 116, 118, 120, 122, 124, 126, 129, 131, 133, 135, 137, 139, 141, 143,
  145, 147, 149, 151, 153, 155, 157, 159, 161, 163, 165, 167, 169, 171, 173, 175,
  177, 179, 181, 183, 185, 187, 189, 191, 193, 195, 197, 199, 201, 203, 205, 207,
  209, 211, 213, 215, 217, 219, 221, 223, 225, 227, 229, 231, 233, 235, 237, 239,
  241, 243, 245, 247, 249, 251, 253, 255, 0, 255, 8, 247, 16, 239, 24, 231,
  32, 223, 40, 215, 48, 207, 56, 199, 64, 191, 72, 183, 80, 175, 88, 167,
  96, 159, 104, 151, 112, 143, 120, 135, 1, 254, 9, 246, 17, 238, 25, 230,
  33, 222, 41, 214, 49, 206, 57, 198, 65, 190, 73, 182, 81, 174, 89, 166,
  97, 158, 105, 150, 113, 142, 121, 134, 3, 252, 11, 244, 19, 236, 27, 228,
  35, 220, 43, 212, 51, 204, 59, 196, 67, 188, 75, 180, 83, 172, 91, 164,
  99, 156, 107, 148, 115, 140, 123, 132, 4, 251, 12, 243, 20, 235, 28, 227,
  36, 219, 44, 211, 52, 203, 60, 195, 68, 187, 76, 179, 84, 171, 92, 163,
  100, 155, 108, 147, 116, 139, 124, 131, 6, 249, 14, 241, 22, 233, 30, 225,
  38, 217, 46, 209, 54, 201, 62, 193, 70, 185, 78, 177, 86, 169, 94, 161,
  102, 153, 110, 145, 118, 137, 126, 129, 0, 255, 4, 251, 8, 247, 12, 243,
  16, 239, 20, 235, 24, 231, 28, 227, 32, 223, 36, 219, 40, 215, 44, 211,
  48, 207, 52, 203, 56, 199, 60, 195, 64, 191, 68, 187, 72, 183, 76, 179,
  80, 175, 84, 171, 88, 167, 92, 163, 96, 159, 100, 155, 104, 151, 108, 147,
  112, 143, 116, 139, 120, 135, 124, 131, 1, 254, 5, 250, 9, 246, 13, 242,
  17, 238, 21, 234, 25, 230, 29, 226, 33, 222, 37, 218, 41, 214, 45, 210,
  49, 206, 53, 202, 57, 198, 61, 194, 65, 190, 69, 186, 73, 182, 77, 178,
  81, 174, 85, 170, 89, 166, 93, 162, 97, 158, 101, 154, 105, 150, 109, 146,
  113, 142, 117, 138, 121, 134, 125, 130, 2, 253, 6, 249, 10, 245, 14, 241,
  18, 237, 22, 233, 26, 229, 30, 225, 34, 221, 38, 217, 42, 213, 46, 209,
  50, 205, 54, 201, 58, 197, 62, 193, 66, 189, 70, 185, 74, 181, 78, 177,
  82, 173, 86, 169, 90, 165, 94, 161, 98, 157, 102, 153, 106, 149, 110, 145,
  114, 141, 118, 137, 122, 133, 126, 129, 0, 1, 2, 3, 4, 5, 6, 7,
  8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
  24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
  40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55,
  56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71,
  72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87,
  88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103,
  104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119,
  120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135,
  136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151,
  152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167,
  168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183,
  184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199,
  200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215,
  216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231,
  232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247,
  248, 249, 250, 251, 252, 253, 254, 255
};

static const guint16 astc_color_offsets[17] = { 0, 6, 14, 24, 36, 52, 72, 96, 128, 168, 216, 280, 360, 456, 584, 744, 936 };

static const guint8 texel_sizes[] = { 1, 1, 2, 3, 4, 4, 4, 2, 2, 2, 2, 2, 4, 4, 4, 2, 4, 8, 2, 4, 8, 4, 8, 16 };

static const BlockShape block_shapes[] = {
  { 4, 4, 8 }, { 4, 4, 16 }, { 4, 4, 16 }, { 4, 4, 8 }, { 4, 4, 8 }, { 4, 4, 16 }, { 4, 4, 16 }, { 4, 4, 16 },
  { 4, 4, 16 }, { 4, 4, 16 },
  { 4, 4, 8 }, { 4, 4, 8 }, { 4, 4, 16 }, { 4, 4, 8 }, { 4, 4, 16 },
  { 4, 4, 16 }, { 5, 4, 16 }, { 5, 5, 16 }, { 6, 5, 16 }, { 6, 6, 16 }, { 8, 5, 16 }, { 8, 6, 16 }, { 8, 8, 16 },
  { 10, 5, 16 }, { 10, 6, 16 }, { 10, 8, 16 }, { 10, 10, 16 }, { 12, 10, 16 }, { 12, 12, 16 },
};

static const Bc7Mode bc7_modes[8] = {
  { 3, 4, 0, 0, 4, 0, 1, 0, 3, 0 },
  { 2, 6, 0, 0, 6, 0, 0, 1, 3, 0 },
  { 3, 6, 0, 0, 5, 0, 0, 0, 2, 0 },
  { 2, 6, 0, 0, 7, 0, 1, 0, 2, 0 },
  { 1, 0, 2, 1, 5, 6, 0, 0, 2, 3 },
  { 1, 0, 2, 0, 7, 8, 0, 0, 2, 2 },
  { 1, 0, 0, 0, 7, 7, 1, 0, 4, 0 },
  { 2, 6, 0, 0, 5, 5, 1, 0, 2, 0 },
};

static const guint8 bptc_weights[3][16] = {
  { 0, 21, 43, 64 },
  { 0, 9, 18, 27, 37, 46, 55, 64 },
  { 0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64 },
};

static const guint8 bc4_fifths[4] = { 13, 26, 38, 51 };

static const guint8 bc6h_precisions[14] = { 10, 7, 11, 11, 11, 9, 8, 8, 8, 6, 10, 11, 12, 16 };
static const guint8 bc6h_delta_bits[3][14] = {
  { 5, 6, 5, 4, 4, 5, 6, 5, 5, 6, 10, 9, 8, 4 },
  { 5, 6, 4, 5, 4, 5, 5, 6, 5, 6, 10, 9, 8, 4 },
  { 5, 6, 4, 4, 5, 5, 5, 5, 6, 6, 10, 9, 8, 4 },
};

static const guint8 etc1_modifiers[8][2] = {
  { 2, 8 }, { 5, 17 }, { 9, 29 }, { 13, 42 }, { 18, 60 }, { 24, 80 }, { 33, 106 }, { 47, 183 },
};

static const guint8 etc2_distances[8] = { 3, 6, 11, 16, 23, 32, 41, 64 };

static const gint8 eac_modifiers[16][8] = {
  { -3, -6, -9, -15, 2, 5, 8, 14 },
  { -3, -7, -10, -13, 2, 6, 9, 12 },
  { -2, -5, -8, -13, 1, 4, 7, 12 },
  { -2, -4, -6, -13, 1, 3, 5, 12 },
  { -3, -6, -8, -12, 2, 5, 7, 11 },
  { -3, -7, -9, -11, 2, 6, 8, 10 },
  { -4, -7, -8, -11, 3, 6, 7, 10 },
  { -3, -5, -8, -11, 2, 4, 7, 10 },
  { -2, -6, -8, -10, 1, 5, 7, 9 },
  { -2, -5, -8, -10, 1, 4, 7, 9 },
  { -2, -4, -8, -10, 1, 3, 7, 9 },
  { -2, -5, -7, -10, 1, 4, 6, 9 },
  { -3, -4, -7, -10, 2, 3, 6, 9 },
  { -1, -2, -3, -10, 0, 1, 2, 9 },
  { -4, -6, -8, -9, 3, 5, 7, 8 },
  { -3, -5, -7, -9, 2, 4, 6, 8 },
};

static const guint8 ise_shapes[21][3] = {
  { 1, 0, 0 }, { 0, 1, 0 }, { 2, 0, 0 }, { 0, 0, 1 }, { 1, 1, 0 }, { 3, 0, 0 }, { 1, 0, 1 }, { 2, 1, 0 }, { 4, 0, 0 },
  { 2, 0, 1 }, { 3, 1, 0 }, { 5, 0, 0 }, { 3, 0, 1 }, { 4, 1, 0 }, { 6, 0, 0 }, { 4, 0, 1 }, { 5, 1, 0 }, { 7, 0, 0 },
  { 5, 0, 1 }, { 6, 1, 0 }, { 8, 0, 0 },
};

static const guint16 length_bases[29] = {
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
};
static const guint8 length_extra_bits[29] = {
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
};
static const guint16 distance_bases[30] = {
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
  8193, 12289, 16385, 24577,
};
static const guint8 distance_extra_bits[30] = {
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
};
static const guint8 code_length_order[CODE_LENGTH_SYMBOLS] = {
  16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
};

static void decode_plain (const guint8 * data, Format format, gsize count, guint8 * out);
static void decode_plain_texel (const guint8 * p, Format format, guint8 * texel);
static void put_texel (guint8 * texel, guint32 r, guint32 g, guint32 b, guint32 a);
static void put_grey (guint8 * texel, guint32 value);
static guint32 widen (guint32 value, guint32 largest);
static guint8 unit_byte (float value);
static float half_value (guint32 bits);
static float unsigned_float_value (guint32 bits, guint32 mantissa_bits);
static float power_of_two (gint32 exponent);
static float float_at (const guint8 * p);
static guint16 u16_at (const guint8 * p);
static guint32 u32_at (const guint8 * p);
static void decode_blocks (const guint8 * data, Format format, guint32 width, guint32 height, guint8 * out);
static void decode_block (const guint8 * block, Format format, guint32 width, guint32 height, guint8 * texels);
static void decode_bc1_colors (const guint8 * block, gboolean three_color_allowed, guint8 * texels);
static void expand_rgb565 (guint32 color, guint8 * rgba);
static void decode_bc2_alpha (const guint8 * block, guint8 * texels);
static void decode_bc3_alpha (const guint8 * block, guint8 * texels);
static void decode_bc4_channel (const guint8 * block, gboolean is_signed, guint8 * texels, guint32 channel);
static guint64 bc4_mixes (const guint8 * block, gboolean is_signed, gint32 * mixes);
static void make_grey (guint8 * texels, guint32 count);
static void clear_blue_and_alpha (guint8 * texels, guint32 count);
static void decode_bc6h (const guint8 * block, gboolean is_signed, guint8 * texels);
static void fill_texels (guint8 * texels, guint32 count, guint32 color);
static guint32 bits_at (const guint64 * words, guint32 start, guint32 count);
static gint32 sign_extend (guint32 value, guint32 bits);
static gint32 bc6h_unquantize (gint32 value, guint32 precision, gboolean is_signed);
static guint32 subset_of (guint32 subsets, guint32 partition, guint32 texel);
static gboolean is_anchor (guint32 subsets, guint32 partition, guint32 texel);
static guint32 bc6h_finish (gint32 value, gboolean is_signed);
static void decode_bc7 (const guint8 * block, guint8 * texels);
static guint32 read_bc7_endpoints (const guint64 * words, const Bc7Mode * m, guint32 position, guint32 endpoints[3][2][4]);
static guint32 interpolate_bptc (guint32 a, guint32 b, guint32 weight);
static void decode_etc2_rgb (const guint8 * block, gboolean punchthrough, guint8 * texels);
static guint32 be32_at (const guint8 * p);
static guint32 expand4 (guint32 value);
static void decode_etc1_subblocks (guint32 high, guint32 low, const gint32 * first, const gint32 * second, gboolean punchthrough,
    gboolean opaque, guint8 * texels);
static guint32 etc_index (guint32 low, guint32 x, guint32 y);
static guint32 clamp_byte (gint32 value);
static void decode_planar (guint32 high, guint32 low, guint8 * texels);
static void put_planar_channel (guint8 * texels, guint32 channel, gint32 origin, gint32 horizontal, gint32 vertical);
static guint32 expand6 (guint32 value);
static guint32 expand7 (guint32 value);
static void make_t_mode_paint (guint32 high, gint32 paint[4][3]);
static void make_h_mode_paint (guint32 high, gint32 paint[4][3]);
static void decode_paint_colors (guint32 low, gint32 paint[4][3], gboolean opaque, guint8 * texels);
static guint32 expand5 (guint32 value);
static void decode_eac (const guint8 * block, gboolean eleven_bits, guint8 * texels, guint32 channel);
static void decode_astc (const guint8 * block, guint32 width, guint32 height, guint8 * texels);
static void decode_void_extent (const guint64 * words, guint32 count, guint8 * texels);
static guint32 astc_byte (guint32 value);
static gboolean decode_astc_block (const guint64 * words, guint32 width, guint32 height, guint8 * texels);
static gboolean read_block_mode (guint32 mode, AstcGrid * grid);
static guint32 ise_bit_count (guint32 count, guint32 range);
static guint32 read_endpoint_modes (const guint64 * words, guint32 partitions, guint32 weight_bits, guint32 * modes);
static gint32 largest_color_range (guint32 count, gint32 bits);
static void decode_endpoints (const guint64 * words, guint32 partitions, const guint32 * modes, guint32 value_count, guint32 range,
    guint8 endpoints[4][2][4]);
static void decode_ise (const guint64 * words, guint32 start, guint32 count, guint32 range, guint8 * values);
static guint32 bounded_bits (const guint64 * words, guint32 * position, guint32 count, guint32 end);
static void unpack_trits (guint32 packed, guint32 * trits);
static void unpack_quints (guint32 packed, guint32 * quints);
static void unpack_endpoints (guint32 mode, const guint8 * v, guint8 endpoints[2][4]);
static void put_endpoint (guint8 * endpoint, gint32 r, gint32 g, gint32 b, gint32 a);
static void transfer_bits (gint32 * delta, gint32 * base);
static void put_blue_contracted (guint8 * endpoint, gint32 r, gint32 g, gint32 b, gint32 a);
static void decode_weights (const guint64 * words, const AstcGrid * grid, guint32 count,
    guint8 weights[2][ASTC_LARGEST_WEIGHTS + ASTC_GRID_PADDING]);
static guint64 reverse_bits (guint64 value);
static void interpolate_texels (guint32 seed, guint32 partitions, const guint32 * modes, guint8 endpoints[4][2][4], const AstcGrid * grid,
    guint8 weights[2][ASTC_LARGEST_WEIGHTS + ASTC_GRID_PADDING], guint32 second_plane, guint32 width, guint32 height, guint8 * texels);
static guint32 select_partition (guint32 seed, guint32 x, guint32 y, guint32 partitions, gboolean small_block);
static guint32 hash52 (guint32 value);
static gboolean is_hdr_endpoint_mode (guint32 mode);
static guint32 infill_weight (const guint8 * grid, guint32 grid_width, guint32 x_fraction, guint32 y_fraction);
static void make_crc_table (CrcTable * table);
static void filter_rows (const guint8 * rgba, guint32 width, guint32 height, guint8 * filtered);
static void put_be32 (guint8 * out, guint32 value);
static gsize put_chunk (guint8 * out, const char * type, gsize length, const CrcTable * crcs);
static guint32 crc32_update (const CrcTable * crcs, guint32 crc, const guint8 * bytes, gsize length);
static gsize deflate_zlib (const guint8 * data, gsize length, guint8 * out);
static void make_deflate_tables (DeflateTables * tables);
static void assign_codes (Huffman * code, guint32 count);
static gsize tokenize (const guint8 * data, gsize length, gsize start, guint32 * heads, guint32 * chain, Token * tokens, guint32 * count);
static guint32 hash_at (const guint8 * p);
static guint32 match_length (const guint8 * a, const guint8 * b, guint32 longest);
static void write_block (BitWriter * writer, const DeflateTables * tables, const guint8 * raw, gsize raw_length, const Token * tokens,
    guint32 count, gboolean last);
static guint32 distance_symbol (const DeflateTables * tables, guint32 distance);
static void build_code (const guint32 * frequencies, guint32 count, guint32 longest, Huffman * code);
static void sort_by_frequency (guint32 * symbols, guint32 count, const guint32 * frequencies);
static guint32 run_length_encode (const guint8 * lengths, guint32 count, guint8 * runs);
static guint64 tokens_cost (const DeflateTables * tables, const Token * tokens, guint32 count, const Huffman * literals,
    const Huffman * distances);
static void write_stored (BitWriter * writer, const guint8 * raw, gsize raw_length, gboolean last);
static void put_bits (BitWriter * writer, guint32 value, guint32 count);
static void write_tokens (BitWriter * writer, const DeflateTables * tables, const Token * tokens, guint32 count, const Huffman * literals,
    const Huffman * distances);
static void align_to_byte (BitWriter * writer);
static guint32 adler32 (const guint8 * data, gsize length);

void decode_texture (const guint8 * data, Format format, guint32 width, guint32 height, guint8 * out)
{
  if (format < FIRST_BLOCK_FORMAT)
    decode_plain (data, format, (gsize) width * height, out);
  else
    decode_blocks (data, format, width, height, out);
}

guint64 png_capacity (guint32 width, guint32 height)
{
  gsize filtered = ((gsize) width * 4 + 1) * height;
  return PNG_OVERHEAD + filtered + STORED_OVERHEAD * (3 * (filtered / LONGEST_STORED) + 3);
}

guint64 encode_png (const guint8 * rgba, guint32 width, guint32 height, guint8 * out)
{
  static const guint8 signature[8] = { 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a };
  gsize filtered_length = ((gsize) width * 4 + 1) * height, length;
  guint8 * filtered = g_malloc (filtered_length);
  guint8 * header = out + 8;
  CrcTable crcs;

  make_crc_table (&crcs);
  filter_rows (rgba, width, height, filtered);
  memcpy (out, signature, 8);
  put_be32 (header + 8, width);
  put_be32 (header + 12, height);
  header[16] = 8;
  header[17] = 6;
  header[18] = 0;
  header[19] = 0;
  header[20] = 0;
  length = 8 + put_chunk (header, "IHDR", 13, &crcs);
  length += put_chunk (out + length, "IDAT", deflate_zlib (filtered, filtered_length, out + length + 8), &crcs);
  length += put_chunk (out + length, "IEND", 0, &crcs);
  g_free (filtered);
  return length;
}

void fit_for_view (const guint8 * rgba, guint32 width, guint32 height, guint32 fitted_width, guint32 fitted_height, guint32 * out)
{
  guint32 x, y;
  for (y = 0; y != fitted_height; y++)
  {
    guint32 top = (guint32) ((guint64) y * height / fitted_height);
    guint32 bottom = (guint32) ((guint64) (y + 1) * height / fitted_height);
    for (x = 0; x != fitted_width; x++)
    {
      guint32 left = (guint32) ((guint64) x * width / fitted_width);
      guint32 right = (guint32) ((guint64) (x + 1) * width / fitted_width);
      guint32 sums[4] = { 0, 0, 0, 0 }, count = (right - left) * (bottom - top), i, j, k;
      for (j = top; j != bottom; j++)
      {
        const guint8 * p = rgba + ((gsize) j * width + left) * 4;
        for (i = left; i != right; i++, p += 4)
          for (k = 0; k != 4; k++)
            sums[k] += p[k];
      }
      for (k = 0; k != 4; k++)
        sums[k] = (sums[k] + count / 2) / count;
      out[(gsize) y * fitted_width + x] = (sums[3] << 24) | (sums[0] << 16) | (sums[1] << 8) | sums[2];
    }
  }
}

guint32 crc32_of (const guint8 * bytes, guint64 length)
{
  CrcTable crcs;
  make_crc_table (&crcs);
  return crc32_update (&crcs, 0, bytes, length);
}

static void decode_plain (const guint8 * data, Format format, gsize count, guint8 * out)
{
  guint32 size = texel_sizes[format];
  gsize i;
  for (i = 0; i != count; i++)
    decode_plain_texel (data + i * size, format, out + i * 4);
}

static void decode_plain_texel (const guint8 * p, Format format, guint8 * texel)
{
  guint32 v;
  switch (format)
  {
    case R8UNORM:
      put_grey (texel, p[0]);
      break;
    case A8UNORM:
      put_texel (texel, 255, 255, 255, p[0]);
      break;
    case RG8UNORM:
      put_texel (texel, p[0], p[1], 0, 255);
      break;
    case RGB8UNORM:
      put_texel (texel, p[0], p[1], p[2], 255);
      break;
    case RGBA8UNORM:
      memcpy (texel, p, 4);
      break;
    case BGRA8UNORM:
      put_texel (texel, p[2], p[1], p[0], p[3]);
      break;
    case BGRX8UNORM:
      put_texel (texel, p[2], p[1], p[0], 255);
      break;
    case RGB565:
      v = u16_at (p);
      put_texel (texel, widen (v >> 11, 31), widen ((v >> 5) & 63, 63), widen (v & 31, 31), 255);
      break;
    case RGBA4444:
      v = u16_at (p);
      put_texel (texel, widen (v >> 12, 15), widen ((v >> 8) & 15, 15), widen ((v >> 4) & 15, 15), widen (v & 15, 15));
      break;
    case ARGB4444:
      v = u16_at (p);
      put_texel (texel, widen ((v >> 8) & 15, 15), widen ((v >> 4) & 15, 15), widen (v & 15, 15), widen (v >> 12, 15));
      break;
    case RGB5A1:
      v = u16_at (p);
      put_texel (texel, widen (v >> 11, 31), widen ((v >> 6) & 31, 31), widen ((v >> 1) & 31, 31), (v & 1) * 255);
      break;
    case A1RGB5:
      v = u16_at (p);
      put_texel (texel, widen ((v >> 10) & 31, 31), widen ((v >> 5) & 31, 31), widen (v & 31, 31), (v >> 15) * 255);
      break;
    case RGB10A2UNORM:
      v = u32_at (p);
      put_texel (texel, widen (v & 1023, 1023), widen ((v >> 10) & 1023, 1023), widen ((v >> 20) & 1023, 1023), widen (v >> 30, 3));
      break;
    case RG11B10FLOAT:
      v = u32_at (p);
      put_texel (texel, unit_byte (unsigned_float_value (v & 0x7ff, 6)), unit_byte (unsigned_float_value ((v >> 11) & 0x7ff, 6)),
          unit_byte (unsigned_float_value (v >> 22, 5)), 255);
      break;
    case RGB9E5FLOAT:
    {
      float scale;
      v = u32_at (p);
      scale = power_of_two ((gint32) (v >> 27) - 24);
      put_texel (texel, unit_byte ((v & 511) * scale), unit_byte (((v >> 9) & 511) * scale), unit_byte (((v >> 18) & 511) * scale),
          255);
      break;
    }
    case R16UNORM:
      put_grey (texel, widen (u16_at (p), 65535));
      break;
    case RG16UNORM:
      put_texel (texel, widen (u16_at (p), 65535), widen (u16_at (p + 2), 65535), 0, 255);
      break;
    case RGBA16UNORM:
      put_texel (texel, widen (u16_at (p), 65535), widen (u16_at (p + 2), 65535), widen (u16_at (p + 4), 65535),
          widen (u16_at (p + 6), 65535));
      break;
    case R16FLOAT:
      put_grey (texel, unit_byte (half_value (u16_at (p))));
      break;
    case RG16FLOAT:
      put_texel (texel, unit_byte (half_value (u16_at (p))), unit_byte (half_value (u16_at (p + 2))), 0, 255);
      break;
    case RGBA16FLOAT:
      put_texel (texel, unit_byte (half_value (u16_at (p))), unit_byte (half_value (u16_at (p + 2))),
          unit_byte (half_value (u16_at (p + 4))), unit_byte (half_value (u16_at (p + 6))));
      break;
    case R32FLOAT:
      put_grey (texel, unit_byte (float_at (p)));
      break;
    case RG32FLOAT:
      put_texel (texel, unit_byte (float_at (p)), unit_byte (float_at (p + 4)), 0, 255);
      break;
    default:
      put_texel (texel, unit_byte (float_at (p)), unit_byte (float_at (p + 4)), unit_byte (float_at (p + 8)),
          unit_byte (float_at (p + 12)));
      break;
  }
}

static void put_texel (guint8 * texel, guint32 r, guint32 g, guint32 b, guint32 a)
{
  texel[0] = r;
  texel[1] = g;
  texel[2] = b;
  texel[3] = a;
}

static void put_grey (guint8 * texel, guint32 value)
{
  put_texel (texel, value, value, value, 255);
}

static guint32 widen (guint32 value, guint32 largest)
{
  return (value * 510 + largest) / (2 * largest);
}

static guint8 unit_byte (float value)
{
  if (!(value > 0.0f))
    return 0;
  if (value >= 1.0f)
    return 255;
  return (guint8) ((double) value * 255.0 + 0.5);
}

static float half_value (guint32 bits)
{
  float magnitude = unsigned_float_value (bits & 0x7fff, 10);
  return (bits & 0x8000) ? -magnitude : magnitude;
}

static float unsigned_float_value (guint32 bits, guint32 mantissa_bits)
{
  guint32 exponent = bits >> mantissa_bits, mantissa = bits & ((1u << mantissa_bits) - 1);
  union { guint32 u; float f; } value;
  if (exponent == 0)
    return mantissa * power_of_two (-14 - (gint32) mantissa_bits);
  if (exponent == 31)
    value.u = (mantissa != 0) ? 0x7fc00000u : 0x7f800000u;
  else
    value.u = ((exponent + 112) << 23) | (mantissa << (23 - mantissa_bits));
  return value.f;
}

static float power_of_two (gint32 exponent)
{
  union { guint32 u; float f; } value;
  value.u = (guint32) (127 + exponent) << 23;
  return value.f;
}

static float float_at (const guint8 * p)
{
  float value;
  memcpy (&value, p, 4);
  return value;
}

static guint16 u16_at (const guint8 * p)
{
  return p[0] | (p[1] << 8);
}

static guint32 u32_at (const guint8 * p)
{
  guint32 value;
  memcpy (&value, p, 4);
  return value;
}

static void decode_blocks (const guint8 * data, Format format, guint32 width, guint32 height, guint8 * out)
{
  const BlockShape * shape = &block_shapes[format - FIRST_BLOCK_FORMAT];
  guint32 columns = (width + shape->width - 1) / shape->width, rows = (height + shape->height - 1) / shape->height;
  guint8 texels[LARGEST_BLOCK_TEXELS * 4];
  guint32 column, row, y;
  for (row = 0; row != rows; row++)
  {
    for (column = 0; column != columns; column++)
    {
      guint32 left = column * shape->width, top = row * shape->height;
      guint32 visible_width = MIN (shape->width, width - left), visible_height = MIN (shape->height, height - top);
      decode_block (data + ((gsize) row * columns + column) * shape->size, format, shape->width, shape->height, texels);
      for (y = 0; y != visible_height; y++)
        memcpy (out + ((gsize) (top + y) * width + left) * 4, texels + y * shape->width * 4, visible_width * 4);
    }
  }
}

static void decode_block (const guint8 * block, Format format, guint32 width, guint32 height, guint8 * texels)
{
  switch (format)
  {
    case BC1:
      decode_bc1_colors (block, TRUE, texels);
      break;
    case BC2:
      decode_bc1_colors (block + 8, FALSE, texels);
      decode_bc2_alpha (block, texels);
      break;
    case BC3:
      decode_bc1_colors (block + 8, FALSE, texels);
      decode_bc3_alpha (block, texels);
      break;
    case BC4UNORM:
    case BC4SNORM:
      decode_bc4_channel (block, format == BC4SNORM, texels, 0);
      make_grey (texels, 16);
      break;
    case BC5UNORM:
    case BC5SNORM:
      decode_bc4_channel (block, format == BC5SNORM, texels, 0);
      decode_bc4_channel (block + 8, format == BC5SNORM, texels, 1);
      clear_blue_and_alpha (texels, 16);
      break;
    case BC6HUFLOAT:
    case BC6HSFLOAT:
      decode_bc6h (block, format == BC6HSFLOAT, texels);
      break;
    case BC7:
      decode_bc7 (block, texels);
      break;
    case ETC2RGB8:
    case ETC2RGB8A1:
      decode_etc2_rgb (block, format == ETC2RGB8A1, texels);
      break;
    case ETC2RGBA8:
      decode_etc2_rgb (block + 8, FALSE, texels);
      decode_eac (block, FALSE, texels, 3);
      break;
    case EACR11:
      decode_eac (block, TRUE, texels, 0);
      make_grey (texels, 16);
      break;
    case EACRG11:
      decode_eac (block, TRUE, texels, 0);
      decode_eac (block + 8, TRUE, texels, 1);
      clear_blue_and_alpha (texels, 16);
      break;
    default:
      decode_astc (block, width, height, texels);
      break;
  }
}

static void decode_bc1_colors (const guint8 * block, gboolean three_color_allowed, guint8 * texels)
{
  guint32 c0 = u16_at (block), c1 = u16_at (block + 2), indices = u32_at (block + 4), i, k;
  gboolean four_colors = c0 > c1 || !three_color_allowed;
  guint8 palette[4][4];
  expand_rgb565 (c0, palette[0]);
  expand_rgb565 (c1, palette[1]);
  for (k = 0; k != 3; k++)
  {
    guint32 a = palette[0][k], b = palette[1][k];
    palette[2][k] = four_colors ? (43 * a + 21 * b + 32) >> 6 : (a + b + 1) >> 1;
    palette[3][k] = four_colors ? (21 * a + 43 * b + 32) >> 6 : 0;
  }
  palette[2][3] = 255;
  palette[3][3] = four_colors ? 255 : 0;
  for (i = 0; i != 16; i++)
    memcpy (texels + i * 4, palette[(indices >> (2 * i)) & 3], 4);
}

static void expand_rgb565 (guint32 color, guint8 * rgba)
{
  guint32 r = color >> 11, g = (color >> 5) & 63, b = color & 31;
  rgba[0] = (r << 3) | (r >> 2);
  rgba[1] = (g << 2) | (g >> 4);
  rgba[2] = (b << 3) | (b >> 2);
  rgba[3] = 255;
}

static void decode_bc2_alpha (const guint8 * block, guint8 * texels)
{
  guint32 i;
  for (i = 0; i != 16; i++)
    texels[i * 4 + 3] = ((block[i / 2] >> ((i & 1) * 4)) & 15) * 17;
}

static void decode_bc3_alpha (const guint8 * block, guint8 * texels)
{
  gint32 mixes[8];
  guint64 indices = bc4_mixes (block, FALSE, mixes);
  guint32 i;
  for (i = 0; i != 16; i++)
    texels[i * 4 + 3] = (mixes[(indices >> (3 * i)) & 7] + 32) >> 6;
}

static void decode_bc4_channel (const guint8 * block, gboolean is_signed, guint8 * texels, guint32 channel)
{
  gint32 mixes[8];
  guint64 indices = bc4_mixes (block, is_signed, mixes);
  guint32 i;
  for (i = 0; i != 16; i++)
  {
    gint32 mix = mixes[(indices >> (3 * i)) & 7];
    texels[i * 4 + channel] = is_signed
        ? unit_byte ((MAX ((float) mix / (64.0f * 127.0f), -1.0f) + 1.0f) * 0.5f)
        : unit_byte ((float) mix / (64.0f * 255.0f));
  }
}

static guint64 bc4_mixes (const guint8 * block, gboolean is_signed, gint32 * mixes)
{
  gint32 a = is_signed ? (gint8) block[0] : block[0], b = is_signed ? (gint8) block[1] : block[1];
  guint64 indices = 0;
  guint32 i, k;
  for (i = 0; i != 6; i++)
    indices |= (guint64) block[2 + i] << (8 * i);
  mixes[0] = a * 64;
  mixes[1] = b * 64;
  if (a > b)
  {
    for (k = 2; k != 8; k++)
      mixes[k] = a * (64 - bptc_weights[1][k - 1]) + b * bptc_weights[1][k - 1];
  }
  else
  {
    for (k = 2; k != 6; k++)
      mixes[k] = a * (64 - bc4_fifths[k - 2]) + b * bc4_fifths[k - 2];
    mixes[6] = is_signed ? -127 * 64 : 0;
    mixes[7] = is_signed ? 127 * 64 : 255 * 64;
  }
  return indices;
}

static void make_grey (guint8 * texels, guint32 count)
{
  guint32 i;
  for (i = 0; i != count; i++)
    put_grey (texels + i * 4, texels[i * 4]);
}

static void clear_blue_and_alpha (guint8 * texels, guint32 count)
{
  guint32 i;
  for (i = 0; i != count; i++)
  {
    texels[i * 4 + 2] = 0;
    texels[i * 4 + 3] = 255;
  }
}

static void decode_bc6h (const guint8 * block, gboolean is_signed, guint8 * texels)
{
  guint64 words[2];
  guint32 values[13] = { 0 }, mode, position, header_end, regions, precision, index_bits, i, c, e;
  gint32 endpoints[3][4];
  const guint8 * layout;
  gboolean transformed;

  memcpy (words, block, 16);
  if ((block[0] & 2) == 0)
  {
    mode = block[0] & 1;
    position = 2;
  }
  else if ((block[0] & 3) == 2)
  {
    mode = 2 + ((block[0] >> 2) & 7);
    position = 5;
  }
  else if (((block[0] >> 2) & 7) < 4)
  {
    mode = BC6H_FIRST_ONE_REGION_MODE + ((block[0] >> 2) & 7);
    position = 5;
  }
  else
  {
    fill_texels (texels, 16, OPAQUE_BLACK);
    return;
  }

  regions = (mode < BC6H_FIRST_ONE_REGION_MODE) ? 2 : 1;
  header_end = (regions == 2) ? BC6H_TWO_REGION_HEADER_BITS : BC6H_ONE_REGION_HEADER_BITS;
  layout = bc6h_layouts[mode];
  for (i = 0; position != header_end; i++, position++)
    values[layout[i] >> 4] |= bits_at (words, position, 1) << (layout[i] & 15);

  precision = bc6h_precisions[mode];
  transformed = mode != BC6H_DIRECT_TWO_REGION_MODE && mode != BC6H_FIRST_ONE_REGION_MODE;
  for (c = 0; c != 3; c++)
  {
    gint32 base = is_signed ? sign_extend (values[c * 4], precision) : (gint32) values[c * 4];
    endpoints[c][0] = bc6h_unquantize (base, precision, is_signed);
    for (e = 1; e != regions * 2; e++)
    {
      gint32 value = (gint32) values[c * 4 + e];
      if (transformed || is_signed)
        value = sign_extend (value, bc6h_delta_bits[c][mode]);
      if (transformed)
      {
        value = (base + value) & ((1 << precision) - 1);
        if (is_signed)
          value = sign_extend (value, precision);
      }
      endpoints[c][e] = bc6h_unquantize (value, precision, is_signed);
    }
  }

  index_bits = (regions == 2) ? 3 : 4;
  for (i = 0; i != 16; i++)
  {
    guint32 subset = subset_of (regions, values[BC6H_PARTITION_FIELD], i);
    guint32 bits = index_bits - (is_anchor (regions, values[BC6H_PARTITION_FIELD], i) ? 1 : 0);
    guint32 weight = bptc_weights[index_bits - 2][bits_at (words, position, bits)];
    position += bits;
    for (c = 0; c != 3; c++)
    {
      gint32 a = endpoints[c][subset * 2], b = endpoints[c][subset * 2 + 1];
      gint32 mixed = (a * (64 - (gint32) weight) + b * (gint32) weight + 32) >> 6;
      texels[i * 4 + c] = unit_byte (half_value (bc6h_finish (mixed, is_signed)));
    }
    texels[i * 4 + 3] = 255;
  }
}

static void fill_texels (guint8 * texels, guint32 count, guint32 color)
{
  guint32 i;
  for (i = 0; i != count; i++)
    put_texel (texels + i * 4, color & 0xff, (color >> 8) & 0xff, (color >> 16) & 0xff, color >> 24);
}

static guint32 bits_at (const guint64 * words, guint32 start, guint32 count)
{
  guint64 value;
  if (count == 0)
    return 0;
  if (start >= 64)
    value = words[1] >> (start - 64);
  else if (start + count <= 64)
    value = words[0] >> start;
  else
    value = (words[0] >> start) | (words[1] << (64 - start));
  return (guint32) (value & ((1ull << count) - 1));
}

static gint32 sign_extend (guint32 value, guint32 bits)
{
  guint32 sign = 1u << (bits - 1);
  value &= (sign << 1) - 1;
  return (gint32) (value ^ sign) - (gint32) sign;
}

static gint32 bc6h_unquantize (gint32 value, guint32 precision, gboolean is_signed)
{
  gboolean negative;
  gint32 magnitude, unquantized;
  if (!is_signed)
  {
    if (precision >= 15)
      return value;
    if (value == 0)
      return 0;
    if (value == (1 << precision) - 1)
      return 0xffff;
    return ((value << 16) + 0x8000) >> precision;
  }
  if (precision >= 16)
    return value;
  negative = value < 0;
  magnitude = negative ? -value : value;
  if (magnitude == 0)
    unquantized = 0;
  else if (magnitude >= (1 << (precision - 1)) - 1)
    unquantized = 0x7fff;
  else
    unquantized = ((magnitude << 15) + 0x4000) >> (precision - 1);
  return negative ? -unquantized : unquantized;
}

static guint32 subset_of (guint32 subsets, guint32 partition, guint32 texel)
{
  if (subsets == 1)
    return 0;
  if (subsets == 2)
    return (two_subset_partitions[partition] >> texel) & 1;
  return (three_subset_partitions[partition] >> (2 * texel)) & 3;
}

static gboolean is_anchor (guint32 subsets, guint32 partition, guint32 texel)
{
  if (texel == 0)
    return TRUE;
  if (subsets == 2)
    return texel == second_subset_anchors[partition];
  if (subsets == 3)
    return texel == three_subset_second_anchors[partition] || texel == three_subset_third_anchors[partition];
  return FALSE;
}

static guint32 bc6h_finish (gint32 value, gboolean is_signed)
{
  if (!is_signed)
    return (guint32) (value * 31) >> 6;
  if (value < 0)
    return 0x8000 | ((guint32) (-value * 31) >> 5);
  return (guint32) (value * 31) >> 5;
}

static void decode_bc7 (const guint8 * block, guint8 * texels)
{
  guint64 words[2];
  guint32 mode, position, partition, rotation, selector, c, i, color_position, alpha_position;
  guint32 endpoints[3][2][4];
  const Bc7Mode * m;

  if (block[0] == 0)
  {
    fill_texels (texels, 16, TRANSPARENT_BLACK);
    return;
  }
  memcpy (words, block, 16);
  for (mode = 0; (block[0] & (1 << mode)) == 0; mode++)
    ;
  m = &bc7_modes[mode];
  position = mode + 1;
  partition = bits_at (words, position, m->partition_bits);
  position += m->partition_bits;
  rotation = bits_at (words, position, m->rotation_bits);
  position += m->rotation_bits;
  selector = bits_at (words, position, m->selector_bits);
  position += m->selector_bits;

  position = read_bc7_endpoints (words, m, position, endpoints);

  color_position = position;
  alpha_position = position + 16 * m->index_bits - m->subsets;
  for (i = 0; i != 16; i++)
  {
    guint32 subset = subset_of (m->subsets, partition, i);
    guint32 primary_bits = m->index_bits - (is_anchor (m->subsets, partition, i) ? 1 : 0);
    guint32 primary = bptc_weights[m->index_bits - 2][bits_at (words, color_position, primary_bits)];
    guint32 color_weight = primary, alpha_weight = primary;
    guint32 * low = endpoints[subset][0], * high = endpoints[subset][1];
    guint8 * texel = texels + i * 4;
    color_position += primary_bits;
    if (m->second_index_bits != 0)
    {
      guint32 secondary_bits = m->second_index_bits - ((i == 0) ? 1 : 0);
      guint32 secondary = bptc_weights[m->second_index_bits - 2][bits_at (words, alpha_position, secondary_bits)];
      alpha_position += secondary_bits;
      if (selector)
        color_weight = secondary;
      else
        alpha_weight = secondary;
    }
    for (c = 0; c != 3; c++)
      texel[c] = interpolate_bptc (low[c], high[c], color_weight);
    texel[3] = interpolate_bptc (low[3], high[3], alpha_weight);
    if (rotation != 0)
    {
      guint8 swapped = texel[3];
      texel[3] = texel[rotation - 1];
      texel[rotation - 1] = swapped;
    }
  }
}

static guint32 read_bc7_endpoints (const guint64 * words, const Bc7Mode * m, guint32 position, guint32 endpoints[3][2][4])
{
  guint32 s, e, c;
  for (c = 0; c != 4; c++)
  {
    guint32 bits = (c < 3) ? m->color_bits : m->alpha_bits;
    for (s = 0; s != m->subsets; s++)
    {
      for (e = 0; e != 2; e++)
      {
        endpoints[s][e][c] = bits_at (words, position, bits);
        position += bits;
      }
    }
  }
  for (s = 0; s != m->subsets; s++)
  {
    for (e = 0; e != 2; e++)
    {
      guint32 pbit = 0, pbits = 0;
      if (m->endpoint_pbits)
      {
        pbit = bits_at (words, position + s * 2 + e, 1);
        pbits = 1;
      }
      else if (m->shared_pbits)
      {
        pbit = bits_at (words, position + s, 1);
        pbits = 1;
      }
      for (c = 0; c != 4; c++)
      {
        guint32 bits = ((c < 3) ? m->color_bits : m->alpha_bits) + pbits;
        guint32 value = ((endpoints[s][e][c] << pbits) | pbit) << (8 - bits);
        endpoints[s][e][c] = (bits == pbits) ? 255 : value | (value >> bits);
      }
    }
  }
  return position + m->subsets * 2 * m->endpoint_pbits + m->subsets * m->shared_pbits;
}

static guint32 interpolate_bptc (guint32 a, guint32 b, guint32 weight)
{
  return (a * (64 - weight) + b * weight + 32) >> 6;
}

static void decode_etc2_rgb (const guint8 * block, gboolean punchthrough, guint8 * texels)
{
  guint32 high = be32_at (block), low = be32_at (block + 4);
  gboolean opaque = !punchthrough || (high & ETC_DIFFERENTIAL_BIT) != 0;
  gint32 first[3], second[3], paint[4][3];
  guint32 c;

  if (!punchthrough && (high & ETC_DIFFERENTIAL_BIT) == 0)
  {
    for (c = 0; c != 3; c++)
    {
      first[c] = expand4 ((high >> (28 - 8 * c)) & 15);
      second[c] = expand4 ((high >> (24 - 8 * c)) & 15);
    }
    decode_etc1_subblocks (high, low, first, second, punchthrough, opaque, texels);
    return;
  }

  for (c = 0; c != 3; c++)
  {
    gint32 base = (high >> (27 - 8 * c)) & 31, delta = sign_extend ((high >> (24 - 8 * c)) & 7, 3);
    if (base + delta < 0 || base + delta > 31)
    {
      if (c == 2)
      {
        decode_planar (high, low, texels);
        return;
      }
      if (c == 0)
        make_t_mode_paint (high, paint);
      else
        make_h_mode_paint (high, paint);
      decode_paint_colors (low, paint, opaque, texels);
      return;
    }
    first[c] = expand5 (base);
    second[c] = expand5 (base + delta);
  }
  decode_etc1_subblocks (high, low, first, second, punchthrough, opaque, texels);
}

static guint32 be32_at (const guint8 * p)
{
  return ((guint32) p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3];
}

static guint32 expand4 (guint32 value)
{
  return value * 17;
}

static void decode_etc1_subblocks (guint32 high, guint32 low, const gint32 * first, const gint32 * second, gboolean punchthrough,
    gboolean opaque, guint8 * texels)
{
  gboolean flipped = (high & ETC_FLIP_BIT) != 0;
  guint32 x, y, c;
  for (y = 0; y != 4; y++)
  {
    for (x = 0; x != 4; x++)
    {
      gboolean in_second = flipped ? y >= 2 : x >= 2;
      const gint32 * base = in_second ? second : first;
      const guint8 * modifiers = etc1_modifiers[(high >> (in_second ? 2 : 5)) & 7];
      guint32 index = etc_index (low, x, y);
      gint32 modifier = modifiers[index & 1];
      guint8 * texel = texels + (y * 4 + x) * 4;
      if (index & 2)
        modifier = -modifier;
      if (punchthrough && !opaque && (index & 1) == 0)
      {
        if (index == 2)
        {
          put_texel (texel, 0, 0, 0, 0);
          continue;
        }
        modifier = 0;
      }
      for (c = 0; c != 3; c++)
        texel[c] = clamp_byte (base[c] + modifier);
      texel[3] = 255;
    }
  }
}

static guint32 etc_index (guint32 low, guint32 x, guint32 y)
{
  guint32 bit = x * 4 + y;
  return (((low >> (bit + 16)) & 1) << 1) | ((low >> bit) & 1);
}

static guint32 clamp_byte (gint32 value)
{
  return (value < 0) ? 0 : (value > 255) ? 255 : value;
}

static void decode_planar (guint32 high, guint32 low, guint8 * texels)
{
  guint32 i;
  put_planar_channel (texels, 0, expand6 ((high >> 25) & 63), expand6 ((((high >> 2) & 31) << 1) | (high & 1)),
      expand6 ((low >> 13) & 63));
  put_planar_channel (texels, 1, expand7 ((((high >> 24) & 1) << 6) | ((high >> 17) & 63)), expand7 ((low >> 25) & 127),
      expand7 ((low >> 6) & 127));
  put_planar_channel (texels, 2, expand6 ((((high >> 16) & 1) << 5) | (((high >> 11) & 3) << 3) | ((high >> 7) & 7)),
      expand6 ((low >> 19) & 63), expand6 (low & 63));
  for (i = 0; i != 16; i++)
    texels[i * 4 + 3] = 255;
}

static void put_planar_channel (guint8 * texels, guint32 channel, gint32 origin, gint32 horizontal, gint32 vertical)
{
  gint32 x, y;
  for (y = 0; y != 4; y++)
  {
    for (x = 0; x != 4; x++)
    {
      gint32 value = x * (horizontal - origin) + y * (vertical - origin) + 4 * origin + 2;
      texels[(y * 4 + x) * 4 + channel] = (value < 0) ? 0 : clamp_byte (value >> 2);
    }
  }
}

static guint32 expand6 (guint32 value)
{
  return (value << 2) | (value >> 4);
}

static guint32 expand7 (guint32 value)
{
  return (value << 1) | (value >> 6);
}

static void make_t_mode_paint (guint32 high, gint32 paint[4][3])
{
  gint32 distance = etc2_distances[(((high >> 2) & 3) << 1) | (high & 1)];
  guint32 c;
  paint[0][0] = expand4 ((((high >> 27) & 3) << 2) | ((high >> 24) & 3));
  paint[0][1] = expand4 ((high >> 20) & 15);
  paint[0][2] = expand4 ((high >> 16) & 15);
  for (c = 0; c != 3; c++)
  {
    paint[2][c] = expand4 ((high >> (12 - 4 * c)) & 15);
    paint[1][c] = paint[2][c] + distance;
    paint[3][c] = paint[2][c] - distance;
  }
}

static void make_h_mode_paint (guint32 high, gint32 paint[4][3])
{
  guint32 first[3], second[3], ordered, c;
  gint32 distance;
  first[0] = (high >> 27) & 15;
  first[1] = (((high >> 24) & 7) << 1) | ((high >> 20) & 1);
  first[2] = (((high >> 19) & 1) << 3) | ((high >> 15) & 7);
  second[0] = (high >> 11) & 15;
  second[1] = (high >> 7) & 15;
  second[2] = (high >> 3) & 15;
  ordered = ((first[0] << 8) | (first[1] << 4) | first[2]) >= ((second[0] << 8) | (second[1] << 4) | second[2]);
  distance = etc2_distances[(((high >> 2) & 1) << 2) | ((high & 1) << 1) | ordered];
  for (c = 0; c != 3; c++)
  {
    paint[0][c] = expand4 (first[c]) + distance;
    paint[1][c] = expand4 (first[c]) - distance;
    paint[2][c] = expand4 (second[c]) + distance;
    paint[3][c] = expand4 (second[c]) - distance;
  }
}

static void decode_paint_colors (guint32 low, gint32 paint[4][3], gboolean opaque, guint8 * texels)
{
  guint32 x, y, c;
  for (y = 0; y != 4; y++)
  {
    for (x = 0; x != 4; x++)
    {
      guint32 index = etc_index (low, x, y);
      guint8 * texel = texels + (y * 4 + x) * 4;
      if (!opaque && index == 2)
      {
        put_texel (texel, 0, 0, 0, 0);
        continue;
      }
      for (c = 0; c != 3; c++)
        texel[c] = clamp_byte (paint[index][c]);
      texel[3] = 255;
    }
  }
}

static guint32 expand5 (guint32 value)
{
  return (value << 3) | (value >> 2);
}

static void decode_eac (const guint8 * block, gboolean eleven_bits, guint8 * texels, guint32 channel)
{
  gint32 base = block[0], multiplier = block[1] >> 4;
  const gint8 * modifiers = eac_modifiers[block[1] & 15];
  guint64 indices = 0;
  guint32 x, y, i;
  for (i = 0; i != 6; i++)
    indices = (indices << 8) | block[2 + i];
  for (x = 0; x != 4; x++)
  {
    for (y = 0; y != 4; y++)
    {
      gint32 modifier = modifiers[(indices >> (45 - 3 * (x * 4 + y))) & 7];
      guint8 * texel = texels + (y * 4 + x) * 4;
      if (eleven_bits)
      {
        gint32 value = base * 8 + 4 + modifier * ((multiplier != 0) ? multiplier * 8 : 1);
        texel[channel] = widen ((value < 0) ? 0 : (value > 2047) ? 2047 : value, 2047);
      }
      else
      {
        texel[channel] = clamp_byte (base + modifier * multiplier);
      }
    }
  }
}

static void decode_astc (const guint8 * block, guint32 width, guint32 height, guint8 * texels)
{
  guint64 words[2];
  memcpy (words, block, 16);
  if ((words[0] & 0x1ff) == ASTC_VOID_EXTENT)
    decode_void_extent (words, width * height, texels);
  else if (!decode_astc_block (words, width, height, texels))
    fill_texels (texels, width * height, ERROR_COLOR);
}

static void decode_void_extent (const guint64 * words, guint32 count, guint8 * texels)
{
  guint32 low_s = bits_at (words, 12, 13), high_s = bits_at (words, 25, 13);
  guint32 low_t = bits_at (words, 38, 13), high_t = bits_at (words, 51, 13);
  gboolean all_ones = low_s == 0x1fff && high_s == 0x1fff && low_t == 0x1fff && high_t == 0x1fff;
  guint32 i;
  if (bits_at (words, 9, 1) != 0 || bits_at (words, 10, 2) != 3 || ((low_s >= high_s || low_t >= high_t) && !all_ones))
  {
    fill_texels (texels, count, ERROR_COLOR);
    return;
  }
  for (i = 0; i != count; i++)
    put_texel (texels + i * 4, astc_byte (bits_at (words, 64, 16)), astc_byte (bits_at (words, 80, 16)),
        astc_byte (bits_at (words, 96, 16)), astc_byte (bits_at (words, 112, 16)));
}

static guint32 astc_byte (guint32 value)
{
  return widen (value >> (16 - ASTC_PRECISION_BITS), (1 << ASTC_PRECISION_BITS) - 1);
}

static gboolean decode_astc_block (const guint64 * words, guint32 width, guint32 height, guint8 * texels)
{
  AstcGrid grid;
  guint32 weight_count, weight_bits, partitions, extra_mode_bits, modes[4], value_count = 0, second_plane = NO_PLANE, p;
  gint32 color_range;
  guint8 endpoints[4][2][4], weights[2][ASTC_LARGEST_WEIGHTS + ASTC_GRID_PADDING];

  if (!read_block_mode (bits_at (words, 0, 11), &grid) || grid.width > width || grid.height > height)
    return FALSE;
  weight_count = grid.width * grid.height * (grid.dual_plane ? 2 : 1);
  if (weight_count > ASTC_LARGEST_WEIGHTS)
    return FALSE;
  weight_bits = ise_bit_count (weight_count, grid.range);
  if (weight_bits < ASTC_FEWEST_WEIGHT_BITS || weight_bits > ASTC_MOST_WEIGHT_BITS)
    return FALSE;
  partitions = bits_at (words, 11, 2) + 1;
  if (grid.dual_plane && partitions == 4)
    return FALSE;

  extra_mode_bits = read_endpoint_modes (words, partitions, weight_bits, modes);
  for (p = 0; p != partitions; p++)
    value_count += ((modes[p] >> 2) + 1) * 2;
  if (value_count > ASTC_MOST_COLOR_VALUES)
    return FALSE;
  color_range = largest_color_range (value_count,
      (gint32) ((partitions == 1) ? ASTC_SINGLE_PARTITION_COLOR_BITS : ASTC_PARTITIONED_COLOR_BITS) -
      (gint32) (weight_bits + extra_mode_bits + (grid.dual_plane ? ASTC_PLANE_SELECTOR_BITS : 0)));
  if (color_range < 0)
    return FALSE;

  decode_endpoints (words, partitions, modes, value_count, color_range, endpoints);
  if (grid.dual_plane)
    second_plane = bits_at (words, 128 - weight_bits - extra_mode_bits - ASTC_PLANE_SELECTOR_BITS, ASTC_PLANE_SELECTOR_BITS);
  decode_weights (words, &grid, weight_count, weights);
  interpolate_texels (bits_at (words, 13, 10), partitions, modes, endpoints, &grid, weights, second_plane, width, height, texels);
  return TRUE;
}

static gboolean read_block_mode (guint32 mode, AstcGrid * grid)
{
  guint32 range = (mode >> 4) & 1, high_precision = (mode >> 9) & 1, dual = (mode >> 10) & 1, a = (mode >> 5) & 3, b;
  if ((mode & 3) != 0)
  {
    range |= (mode & 3) << 1;
    b = (mode >> 7) & 3;
    switch ((mode >> 2) & 3)
    {
      case 0:
        grid->width = b + 4;
        grid->height = a + 2;
        break;
      case 1:
        grid->width = b + 8;
        grid->height = a + 2;
        break;
      case 2:
        grid->width = a + 2;
        grid->height = b + 8;
        break;
      default:
        b &= 1;
        if (mode & 0x100)
        {
          grid->width = b + 2;
          grid->height = a + 2;
        }
        else
        {
          grid->width = a + 2;
          grid->height = b + 6;
        }
        break;
    }
  }
  else
  {
    range |= ((mode >> 2) & 3) << 1;
    if (((mode >> 2) & 3) == 0)
      return FALSE;
    b = (mode >> 9) & 3;
    switch ((mode >> 7) & 3)
    {
      case 0:
        grid->width = 12;
        grid->height = a + 2;
        break;
      case 1:
        grid->width = a + 2;
        grid->height = 12;
        break;
      case 2:
        grid->width = a + 6;
        grid->height = b + 6;
        dual = 0;
        high_precision = 0;
        break;
      default:
        if (a >= 2)
          return FALSE;
        grid->width = (a == 0) ? 6 : 10;
        grid->height = (a == 0) ? 10 : 6;
        break;
    }
  }
  grid->dual_plane = dual;
  grid->range = range - 2 + 6 * high_precision;
  return TRUE;
}

static guint32 ise_bit_count (guint32 count, guint32 range)
{
  const guint8 * shape = ise_shapes[range];
  return count * shape[0] + (shape[1] ? (8 * count + 4) / 5 : 0) + (shape[2] ? (7 * count + 2) / 3 : 0);
}

static guint32 read_endpoint_modes (const guint64 * words, guint32 partitions, guint32 weight_bits, guint32 * modes)
{
  guint32 encoded, base_class, extra_bits, p;
  if (partitions == 1)
  {
    modes[0] = bits_at (words, 13, 4);
    return 0;
  }
  encoded = bits_at (words, 23, 6);
  if ((encoded & 3) == 0)
  {
    for (p = 0; p != partitions; p++)
      modes[p] = encoded >> 2;
    return 0;
  }
  base_class = (encoded & 3) - 1;
  extra_bits = 3 * partitions - 4;
  encoded |= bits_at (words, 128 - weight_bits - extra_bits, extra_bits) << 6;
  for (p = 0; p != partitions; p++)
    modes[p] = ((((encoded >> (2 + p)) & 1) + base_class) << 2) | ((encoded >> (2 + partitions + 2 * p)) & 3);
  return extra_bits;
}

static gint32 largest_color_range (guint32 count, gint32 bits)
{
  gint32 range;
  for (range = ASTC_LARGEST_COLOR_RANGE; range >= ASTC_SMALLEST_COLOR_RANGE; range--)
  {
    if ((gint32) ise_bit_count (count, range) <= bits)
      return range;
  }
  return -1;
}

static void decode_endpoints (const guint64 * words, guint32 partitions, const guint32 * modes, guint32 value_count, guint32 range,
    guint8 endpoints[4][2][4])
{
  const guint8 * unquantized = astc_color_values + astc_color_offsets[range - ASTC_SMALLEST_COLOR_RANGE];
  guint8 raw[ASTC_MOST_COLOR_VALUES], values[ASTC_MOST_COLOR_VALUES];
  guint32 i, p;
  decode_ise (words, (partitions == 1) ? ASTC_SINGLE_PARTITION_COLOR_START : ASTC_PARTITIONED_COLOR_START, value_count, range, raw);
  for (i = 0; i != value_count; i++)
    values[i] = unquantized[raw[i]];
  for (p = 0, i = 0; p != partitions; i += ((modes[p] >> 2) + 1) * 2, p++)
    unpack_endpoints (modes[p], values + i, endpoints[p]);
}

static void decode_ise (const guint64 * words, guint32 start, guint32 count, guint32 range, guint8 * values)
{
  const guint8 * shape = ise_shapes[range];
  guint32 bits = shape[0], end = start + ise_bit_count (count, range), position = start, i, j;
  if (shape[1])
  {
    for (i = 0; i < count; i += 5)
    {
      guint32 low[5], trits[5], packed;
      low[0] = bounded_bits (words, &position, bits, end);
      packed = bounded_bits (words, &position, 2, end);
      low[1] = bounded_bits (words, &position, bits, end);
      packed |= bounded_bits (words, &position, 2, end) << 2;
      low[2] = bounded_bits (words, &position, bits, end);
      packed |= bounded_bits (words, &position, 1, end) << 4;
      low[3] = bounded_bits (words, &position, bits, end);
      packed |= bounded_bits (words, &position, 2, end) << 5;
      low[4] = bounded_bits (words, &position, bits, end);
      packed |= bounded_bits (words, &position, 1, end) << 7;
      unpack_trits (packed, trits);
      for (j = 0; j != 5 && i + j < count; j++)
        values[i + j] = (trits[j] << bits) | low[j];
    }
  }
  else if (shape[2])
  {
    for (i = 0; i < count; i += 3)
    {
      guint32 low[3], quints[3], packed;
      low[0] = bounded_bits (words, &position, bits, end);
      packed = bounded_bits (words, &position, 3, end);
      low[1] = bounded_bits (words, &position, bits, end);
      packed |= bounded_bits (words, &position, 2, end) << 3;
      low[2] = bounded_bits (words, &position, bits, end);
      packed |= bounded_bits (words, &position, 2, end) << 5;
      unpack_quints (packed, quints);
      for (j = 0; j != 3 && i + j < count; j++)
        values[i + j] = (quints[j] << bits) | low[j];
    }
  }
  else
  {
    for (i = 0; i != count; i++)
      values[i] = bounded_bits (words, &position, bits, end);
  }
}

static guint32 bounded_bits (const guint64 * words, guint32 * position, guint32 count, guint32 end)
{
  guint32 start = *position, available = (start >= end) ? 0 : MIN (count, end - start);
  *position = start + count;
  return bits_at (words, start, available);
}

static void unpack_trits (guint32 t, guint32 * trits)
{
  guint32 c;
  if (((t >> 2) & 7) == 7)
  {
    c = (((t >> 5) & 7) << 2) | (t & 3);
    trits[4] = 2;
    trits[3] = 2;
  }
  else
  {
    c = t & 31;
    if (((t >> 5) & 3) == 3)
    {
      trits[4] = 2;
      trits[3] = (t >> 7) & 1;
    }
    else
    {
      trits[4] = (t >> 7) & 1;
      trits[3] = (t >> 5) & 3;
    }
  }
  if ((c & 3) == 3)
  {
    trits[2] = 2;
    trits[1] = (c >> 4) & 1;
    trits[0] = (((c >> 3) & 1) << 1) | (((c >> 2) & 1) & ~((c >> 3) & 1));
  }
  else if (((c >> 2) & 3) == 3)
  {
    trits[2] = 2;
    trits[1] = 2;
    trits[0] = c & 3;
  }
  else
  {
    trits[2] = (c >> 4) & 1;
    trits[1] = (c >> 2) & 3;
    trits[0] = (((c >> 1) & 1) << 1) | ((c & 1) & ~((c >> 1) & 1));
  }
}

static void unpack_quints (guint32 q, guint32 * quints)
{
  guint32 c;
  if (((q >> 1) & 3) == 3 && ((q >> 5) & 3) == 0)
  {
    guint32 q0 = q & 1;
    quints[2] = (q0 << 2) | ((((q >> 4) & 1) & ~q0 & 1) << 1) | (((q >> 3) & 1) & ~q0 & 1);
    quints[1] = 4;
    quints[0] = 4;
    return;
  }
  if (((q >> 1) & 3) == 3)
  {
    quints[2] = 4;
    c = (((q >> 3) & 3) << 3) | ((~(q >> 5) & 3) << 1) | (q & 1);
  }
  else
  {
    quints[2] = (q >> 5) & 3;
    c = q & 31;
  }
  if ((c & 7) == 5)
  {
    quints[1] = 4;
    quints[0] = (c >> 3) & 3;
  }
  else
  {
    quints[1] = (c >> 3) & 3;
    quints[0] = c & 7;
  }
}

static void unpack_endpoints (guint32 mode, const guint8 * v, guint8 endpoints[2][4])
{
  gint32 d[8], i;
  for (i = 0; i != 8; i++)
    d[i] = (i < ((gint32) (mode >> 2) + 1) * 2) ? v[i] : 0;
  switch (mode)
  {
    case 0:
      put_endpoint (endpoints[0], d[0], d[0], d[0], 255);
      put_endpoint (endpoints[1], d[1], d[1], d[1], 255);
      break;
    case 1:
    {
      gint32 l0 = (d[0] >> 2) | (d[1] & 0xc0), l1 = MIN (l0 + (d[1] & 0x3f), 255);
      put_endpoint (endpoints[0], l0, l0, l0, 255);
      put_endpoint (endpoints[1], l1, l1, l1, 255);
      break;
    }
    case 4:
      put_endpoint (endpoints[0], d[0], d[0], d[0], d[2]);
      put_endpoint (endpoints[1], d[1], d[1], d[1], d[3]);
      break;
    case 5:
      transfer_bits (&d[1], &d[0]);
      transfer_bits (&d[3], &d[2]);
      put_endpoint (endpoints[0], d[0], d[0], d[0], d[2]);
      put_endpoint (endpoints[1], d[0] + d[1], d[0] + d[1], d[0] + d[1], d[2] + d[3]);
      break;
    case 6:
      put_endpoint (endpoints[0], (d[0] * d[3]) >> 8, (d[1] * d[3]) >> 8, (d[2] * d[3]) >> 8, 255);
      put_endpoint (endpoints[1], d[0], d[1], d[2], 255);
      break;
    case 8:
    case 12:
      if (mode == 8)
      {
        d[6] = 255;
        d[7] = 255;
      }
      if (d[1] + d[3] + d[5] >= d[0] + d[2] + d[4])
      {
        put_endpoint (endpoints[0], d[0], d[2], d[4], d[6]);
        put_endpoint (endpoints[1], d[1], d[3], d[5], d[7]);
      }
      else
      {
        put_blue_contracted (endpoints[0], d[1], d[3], d[5], d[7]);
        put_blue_contracted (endpoints[1], d[0], d[2], d[4], d[6]);
      }
      break;
    case 9:
    case 13:
      transfer_bits (&d[1], &d[0]);
      transfer_bits (&d[3], &d[2]);
      transfer_bits (&d[5], &d[4]);
      if (mode == 9)
      {
        d[6] = 255;
        d[7] = 0;
      }
      else
      {
        transfer_bits (&d[7], &d[6]);
      }
      if (d[1] + d[3] + d[5] >= 0)
      {
        put_endpoint (endpoints[0], d[0], d[2], d[4], d[6]);
        put_endpoint (endpoints[1], d[0] + d[1], d[2] + d[3], d[4] + d[5], d[6] + d[7]);
      }
      else
      {
        put_blue_contracted (endpoints[0], d[0] + d[1], d[2] + d[3], d[4] + d[5], d[6] + d[7]);
        put_blue_contracted (endpoints[1], d[0], d[2], d[4], d[6]);
      }
      break;
    default:
      put_endpoint (endpoints[0], (d[0] * d[3]) >> 8, (d[1] * d[3]) >> 8, (d[2] * d[3]) >> 8, d[4]);
      put_endpoint (endpoints[1], d[0], d[1], d[2], d[5]);
      break;
  }
}

static void put_endpoint (guint8 * endpoint, gint32 r, gint32 g, gint32 b, gint32 a)
{
  put_texel (endpoint, clamp_byte (r), clamp_byte (g), clamp_byte (b), clamp_byte (a));
}

static void transfer_bits (gint32 * delta, gint32 * base)
{
  *base = (*base >> 1) | (*delta & 0x80);
  *delta = (*delta >> 1) & 0x3f;
  if (*delta & 0x20)
    *delta -= 0x40;
}

static void put_blue_contracted (guint8 * endpoint, gint32 r, gint32 g, gint32 b, gint32 a)
{
  put_endpoint (endpoint, (r + b) >> 1, (g + b) >> 1, b, a);
}

static void decode_weights (const guint64 * words, const AstcGrid * grid, guint32 count,
    guint8 weights[2][ASTC_LARGEST_WEIGHTS + ASTC_GRID_PADDING])
{
  const guint8 * unquantized = astc_weight_values + astc_weight_offsets[grid->range];
  guint64 reversed[2];
  guint8 raw[ASTC_LARGEST_WEIGHTS];
  guint32 i;
  reversed[0] = reverse_bits (words[1]);
  reversed[1] = reverse_bits (words[0]);
  decode_ise (reversed, 0, count, grid->range, raw);
  memset (weights, 0, 2 * (ASTC_LARGEST_WEIGHTS + ASTC_GRID_PADDING));
  for (i = 0; i != count; i++)
  {
    if (grid->dual_plane)
      weights[i & 1][i >> 1] = unquantized[raw[i]];
    else
      weights[0][i] = unquantized[raw[i]];
  }
}

static guint64 reverse_bits (guint64 value)
{
  value = ((value >> 1) & 0x5555555555555555ull) | ((value & 0x5555555555555555ull) << 1);
  value = ((value >> 2) & 0x3333333333333333ull) | ((value & 0x3333333333333333ull) << 2);
  value = ((value >> 4) & 0x0f0f0f0f0f0f0f0full) | ((value & 0x0f0f0f0f0f0f0f0full) << 4);
  value = ((value >> 8) & 0x00ff00ff00ff00ffull) | ((value & 0x00ff00ff00ff00ffull) << 8);
  value = ((value >> 16) & 0x0000ffff0000ffffull) | ((value & 0x0000ffff0000ffffull) << 16);
  return (value >> 32) | (value << 32);
}

static void interpolate_texels (guint32 seed, guint32 partitions, const guint32 * modes, guint8 endpoints[4][2][4], const AstcGrid * grid,
    guint8 weights[2][ASTC_LARGEST_WEIGHTS + ASTC_GRID_PADDING], guint32 second_plane, guint32 width, guint32 height, guint8 * texels)
{
  guint32 x_step = (1024 + width / 2) / (width - 1), y_step = (1024 + height / 2) / (height - 1), x, y, c;
  gboolean small_block = width * height < ASTC_SMALL_BLOCK_TEXELS;
  for (y = 0; y != height; y++)
  {
    for (x = 0; x != width; x++)
    {
      guint32 s = (x_step * x * (grid->width - 1) + 32) >> 6, t = (y_step * y * (grid->height - 1) + 32) >> 6;
      guint32 offset = (t >> 4) * grid->width + (s >> 4), plane_weights[2];
      guint32 p = (partitions == 1) ? 0 : select_partition (seed, x, y, partitions, small_block);
      guint8 * texel = texels + (y * width + x) * 4;
      if (is_hdr_endpoint_mode (modes[p]))
      {
        fill_texels (texel, 1, ERROR_COLOR);
        continue;
      }
      plane_weights[0] = infill_weight (weights[0] + offset, grid->width, s & 15, t & 15);
      plane_weights[1] = grid->dual_plane ? infill_weight (weights[1] + offset, grid->width, s & 15, t & 15) : 0;
      for (c = 0; c != 4; c++)
      {
        guint32 w = plane_weights[(c == second_plane) ? 1 : 0];
        guint32 low = endpoints[p][0][c] * 257, high = endpoints[p][1][c] * 257;
        texel[c] = astc_byte ((low * (64 - w) + high * w + 32) >> 6);
      }
    }
  }
}

static guint32 select_partition (guint32 seed, guint32 x, guint32 y, guint32 partitions, gboolean small_block)
{
  guint32 rnum, seeds[8], sh1, sh2, a, b, c, d, i;
  if (small_block)
  {
    x <<= 1;
    y <<= 1;
  }
  seed += (partitions - 1) * 1024;
  rnum = hash52 (seed);
  for (i = 0; i != 8; i++)
  {
    seeds[i] = (rnum >> (4 * i)) & 15;
    seeds[i] *= seeds[i];
  }
  if (seed & 1)
  {
    sh1 = (seed & 2) ? 4 : 5;
    sh2 = (partitions == 3) ? 6 : 5;
  }
  else
  {
    sh1 = (partitions == 3) ? 6 : 5;
    sh2 = (seed & 2) ? 4 : 5;
  }
  for (i = 0; i != 8; i++)
    seeds[i] >>= (i & 1) ? sh2 : sh1;
  a = (seeds[0] * x + seeds[1] * y + (rnum >> 14)) & 0x3f;
  b = (seeds[2] * x + seeds[3] * y + (rnum >> 10)) & 0x3f;
  c = (partitions >= 3) ? (seeds[4] * x + seeds[5] * y + (rnum >> 6)) & 0x3f : 0;
  d = (partitions >= 4) ? (seeds[6] * x + seeds[7] * y + (rnum >> 2)) & 0x3f : 0;
  if (a >= b && a >= c && a >= d)
    return 0;
  if (b >= c && b >= d)
    return 1;
  if (c >= d)
    return 2;
  return 3;
}

static guint32 hash52 (guint32 value)
{
  value ^= value >> 15;
  value *= 0xeede0891u;
  value ^= value >> 5;
  value += value << 16;
  value ^= value >> 7;
  value ^= value >> 3;
  value ^= value << 6;
  value ^= value >> 17;
  return value;
}

static gboolean is_hdr_endpoint_mode (guint32 mode)
{
  return mode == 2 || mode == 3 || mode == 7 || mode == 11 || mode == 14 || mode == 15;
}

static guint32 infill_weight (const guint8 * grid, guint32 grid_width, guint32 x_fraction, guint32 y_fraction)
{
  guint32 w11 = (x_fraction * y_fraction + 8) >> 4, w10 = y_fraction - w11, w01 = x_fraction - w11;
  guint32 w00 = 16 - x_fraction - y_fraction + w11;
  return (grid[0] * w00 + grid[1] * w01 + grid[grid_width] * w10 + grid[grid_width + 1] * w11 + 8) >> 4;
}

static void make_crc_table (CrcTable * table)
{
  guint32 i, k;
  for (i = 0; i != 256; i++)
  {
    guint32 c = i;
    for (k = 0; k != 8; k++)
      c = (c & 1) ? 0xedb88320u ^ (c >> 1) : c >> 1;
    table->entries[i] = c;
  }
}

static void filter_rows (const guint8 * rgba, guint32 width, guint32 height, guint8 * filtered)
{
  gsize stride = (gsize) width * 4, y, i;
  for (y = 0; y != height; y++)
  {
    const guint8 * row = rgba + y * stride, * above = row - stride;
    guint8 * out = filtered + y * (stride + 1);
    if (y == 0)
    {
      out[0] = 1;
      for (i = 0; i != stride; i++)
        out[1 + i] = row[i] - ((i >= 4) ? row[i - 4] : 0);
      continue;
    }
    out[0] = 4;
    for (i = 0; i != 4; i++)
      out[1 + i] = row[i] - above[i];
    for (i = 4; i != stride; i++)
    {
      gint32 left = row[i - 4], up = above[i], corner = above[i - 4];
      gint32 to_left = up - corner, to_up = left - corner, to_corner = to_left + to_up;
      to_left = (to_left < 0) ? -to_left : to_left;
      to_up = (to_up < 0) ? -to_up : to_up;
      to_corner = (to_corner < 0) ? -to_corner : to_corner;
      out[1 + i] = row[i] - ((to_left <= to_up && to_left <= to_corner) ? left : (to_up <= to_corner) ? up : corner);
    }
  }
}

static void put_be32 (guint8 * out, guint32 value)
{
  out[0] = value >> 24;
  out[1] = value >> 16;
  out[2] = value >> 8;
  out[3] = value;
}

static gsize put_chunk (guint8 * out, const char * type, gsize length, const CrcTable * crcs)
{
  put_be32 (out, length);
  memcpy (out + 4, type, 4);
  put_be32 (out + 8 + length, crc32_update (crcs, 0, out + 4, length + 4));
  return length + 12;
}

static guint32 crc32_update (const CrcTable * crcs, guint32 crc, const guint8 * bytes, gsize length)
{
  gsize i;
  crc = ~crc;
  for (i = 0; i != length; i++)
    crc = crcs->entries[(crc ^ bytes[i]) & 0xff] ^ (crc >> 8);
  return ~crc;
}

static gsize deflate_zlib (const guint8 * data, gsize length, guint8 * out)
{
  BitWriter writer = { out, 0, 0, 0 };
  guint32 * heads = g_malloc (HASH_SIZE * sizeof (guint32));
  guint32 * chain = g_malloc (WINDOW_SIZE * sizeof (guint32));
  Token * tokens = g_malloc (BLOCK_TOKENS * sizeof (Token));
  gsize position = 0;
  DeflateTables tables;

  make_deflate_tables (&tables);
  memset (heads, 0xff, HASH_SIZE * sizeof (guint32));
  out[0] = 0x78;
  out[1] = 0x9c;
  writer.length = 2;
  do
  {
    guint32 count;
    gsize end = tokenize (data, length, position, heads, chain, tokens, &count);
    write_block (&writer, &tables, data + position, end - position, tokens, count, end == length);
    position = end;
  }
  while (position != length);
  align_to_byte (&writer);
  put_be32 (out + writer.length, adler32 (data, length));
  g_free (tokens);
  g_free (chain);
  g_free (heads);
  return writer.length + 4;
}

static void make_deflate_tables (DeflateTables * tables)
{
  guint32 i, symbol;
  for (symbol = 0; symbol != 29; symbol++)
    for (i = length_bases[symbol]; i < length_bases[symbol] + (1u << length_extra_bits[symbol]) && i <= LONGEST_MATCH; i++)
      tables->length_symbols[i] = symbol;
  for (symbol = 0; symbol != DISTANCE_SYMBOLS; symbol++)
  {
    for (i = distance_bases[symbol]; i < distance_bases[symbol] + (1u << distance_extra_bits[symbol]); i++)
    {
      if (i <= 512)
        tables->near_distance_symbols[i - 1] = symbol;
      else
        tables->far_distance_symbols[(i - 1) >> 8] = symbol;
    }
  }
  for (i = 0; i != 288; i++)
    tables->fixed_literals.lengths[i] = (i < 144) ? 8 : (i < 256) ? 9 : (i < 280) ? 7 : 8;
  assign_codes (&tables->fixed_literals, 288);
  for (i = 0; i != DISTANCE_SYMBOLS; i++)
    tables->fixed_distances.lengths[i] = 5;
  assign_codes (&tables->fixed_distances, DISTANCE_SYMBOLS);
}

static void assign_codes (Huffman * code, guint32 count)
{
  guint32 length_counts[LONGEST_CODE + 1] = { 0 }, next[LONGEST_CODE + 1], value = 0, i, k;
  for (i = 0; i != count; i++)
    length_counts[code->lengths[i]]++;
  length_counts[0] = 0;
  for (k = 1; k <= LONGEST_CODE; k++)
  {
    value = (value + length_counts[k - 1]) << 1;
    next[k] = value;
  }
  for (i = 0; i != count; i++)
  {
    guint32 length = code->lengths[i], bits, reversed = 0;
    if (length == 0)
      continue;
    bits = next[length]++;
    for (k = 0; k != length; k++)
      reversed |= ((bits >> k) & 1) << (length - 1 - k);
    code->codes[i] = reversed;
  }
}

static gsize tokenize (const guint8 * data, gsize length, gsize start, guint32 * heads, guint32 * chain, Token * tokens, guint32 * count)
{
  gsize position = start;
  guint32 written = 0;
  while (position < length && written != BLOCK_TOKENS)
  {
    guint32 best_length = 0, best_distance = 0;
    if (position + SHORTEST_MATCH <= length)
    {
      guint32 hash = hash_at (data + position), candidate = heads[hash], longest = MIN (LONGEST_MATCH, length - position);
      guint32 steps = LONGEST_CHAIN;
      while (candidate != NO_POSITION && position - candidate <= WINDOW_SIZE && steps-- != 0)
      {
        guint32 found = match_length (data + candidate, data + position, longest);
        if (found > best_length)
        {
          best_length = found;
          best_distance = position - candidate;
          if (found >= GOOD_MATCH)
            break;
        }
        candidate = chain[candidate & WINDOW_MASK];
      }
      chain[position & WINDOW_MASK] = heads[hash];
      heads[hash] = position;
    }
    if (best_length >= SHORTEST_MATCH)
    {
      gsize end = position + best_length;
      tokens[written].symbol = best_length;
      tokens[written].distance = best_distance;
      if (best_length <= LONGEST_INSERTED_MATCH)
      {
        for (position++; position + SHORTEST_MATCH <= end; position++)
        {
          guint32 hash = hash_at (data + position);
          chain[position & WINDOW_MASK] = heads[hash];
          heads[hash] = position;
        }
      }
      position = end;
    }
    else
    {
      tokens[written].symbol = data[position];
      tokens[written].distance = 0;
      position++;
    }
    written++;
  }
  *count = written;
  return position;
}

static guint32 hash_at (const guint8 * p)
{
  return (*(const guint32 *) p * 2654435761u) >> (32 - HASH_BITS);
}

static guint32 match_length (const guint8 * a, const guint8 * b, guint32 longest)
{
  guint32 n = 0;
  while (n + 4 <= longest && *(const guint32 *) (a + n) == *(const guint32 *) (b + n))
    n += 4;
  while (n < longest && a[n] == b[n])
    n++;
  return n;
}

static void write_block (BitWriter * writer, const DeflateTables * tables, const guint8 * raw, gsize raw_length, const Token * tokens,
    guint32 count, gboolean last)
{
  guint32 literal_frequencies[LITERAL_LENGTH_SYMBOLS] = { 0 }, distance_frequencies[DISTANCE_SYMBOLS] = { 0 };
  guint32 run_frequencies[CODE_LENGTH_SYMBOLS] = { 0 }, literal_count, distance_count, run_count, length_code_count, i;
  guint8 lengths[LITERAL_LENGTH_SYMBOLS + DISTANCE_SYMBOLS], runs[2 * (LITERAL_LENGTH_SYMBOLS + DISTANCE_SYMBOLS)];
  BlockCodes * codes = g_new (BlockCodes, 1);
  Huffman * literals = &codes->literals, * distances = &codes->distances, * run_code = &codes->runs;
  guint64 dynamic_cost, fixed_cost, stored_cost;

  for (i = 0; i != count; i++)
  {
    if (tokens[i].distance == 0)
    {
      literal_frequencies[tokens[i].symbol]++;
    }
    else
    {
      literal_frequencies[257 + tables->length_symbols[tokens[i].symbol]]++;
      distance_frequencies[distance_symbol (tables, tokens[i].distance)]++;
    }
  }
  literal_frequencies[END_OF_BLOCK]++;
  build_code (literal_frequencies, LITERAL_LENGTH_SYMBOLS, LONGEST_CODE, literals);
  build_code (distance_frequencies, DISTANCE_SYMBOLS, LONGEST_CODE, distances);
  for (literal_count = LITERAL_LENGTH_SYMBOLS; literals->lengths[literal_count - 1] == 0; literal_count--)
    ;
  for (distance_count = DISTANCE_SYMBOLS; distance_count > 1 && distances->lengths[distance_count - 1] == 0; distance_count--)
    ;
  memcpy (lengths, literals->lengths, literal_count);
  memcpy (lengths + literal_count, distances->lengths, distance_count);
  run_count = run_length_encode (lengths, literal_count + distance_count, runs);
  for (i = 0; i != run_count; i++)
  {
    run_frequencies[runs[i]]++;
    if (runs[i] >= 16)
      i++;
  }
  build_code (run_frequencies, CODE_LENGTH_SYMBOLS, LONGEST_CODE_LENGTH_CODE, run_code);
  for (length_code_count = CODE_LENGTH_SYMBOLS;
      length_code_count > 4 && run_code->lengths[code_length_order[length_code_count - 1]] == 0; length_code_count--)
    ;

  dynamic_cost = 3 + 14 + 3 * length_code_count + tokens_cost (tables, tokens, count, literals, distances);
  for (i = 0; i != CODE_LENGTH_SYMBOLS; i++)
    dynamic_cost += (guint64) run_frequencies[i] * (run_code->lengths[i] + ((i == 16) ? 2 : (i == 17) ? 3 : (i == 18) ? 7 : 0));
  fixed_cost = 3 + tokens_cost (tables, tokens, count, &tables->fixed_literals, &tables->fixed_distances);
  stored_cost = (guint64) (raw_length / LONGEST_STORED + 1) * (3 + 7 + 32) + raw_length * 8;

  if (stored_cost <= dynamic_cost && stored_cost <= fixed_cost)
  {
    write_stored (writer, raw, raw_length, last);
  }
  else if (fixed_cost <= dynamic_cost)
  {
    put_bits (writer, (last ? 1 : 0) | (1 << 1), 3);
    write_tokens (writer, tables, tokens, count, &tables->fixed_literals, &tables->fixed_distances);
  }
  else
  {
    put_bits (writer, (last ? 1 : 0) | (2 << 1), 3);
    put_bits (writer, literal_count - 257, 5);
    put_bits (writer, distance_count - 1, 5);
    put_bits (writer, length_code_count - 4, 4);
    for (i = 0; i != length_code_count; i++)
      put_bits (writer, run_code->lengths[code_length_order[i]], 3);
    for (i = 0; i != run_count; i++)
    {
      guint32 symbol = runs[i];
      put_bits (writer, run_code->codes[symbol], run_code->lengths[symbol]);
      if (symbol >= 16)
        put_bits (writer, runs[++i], (symbol == 16) ? 2 : (symbol == 17) ? 3 : 7);
    }
    write_tokens (writer, tables, tokens, count, literals, distances);
  }
  g_free (codes);
}

static guint32 distance_symbol (const DeflateTables * tables, guint32 distance)
{
  return (distance <= 512) ? tables->near_distance_symbols[distance - 1] : tables->far_distance_symbols[(distance - 1) >> 8];
}

static void build_code (const guint32 * frequencies, guint32 count, guint32 longest, Huffman * code)
{
  CodeScratch * scratch = g_new (CodeScratch, 1);
  guint32 * symbols = scratch->symbols, * weights = scratch->weights, used = 0, i;
  guint32 * parents = scratch->parents, * node_weights = scratch->node_weights, * depths = scratch->depths;
  guint32 shift = 0;
  memset (code->lengths, 0, sizeof (code->lengths));
  for (i = 0; i != count; i++)
  {
    if (frequencies[i] != 0)
      symbols[used++] = i;
  }
  while (used < 2)
  {
    for (i = 0; code->lengths[i] != 0 || frequencies[i] != 0; i++)
      ;
    code->lengths[i] = 1;
    symbols[used++] = i;
  }
  for (i = 0; i != count; i++)
    weights[i] = (frequencies[i] != 0) ? frequencies[i] : 1;
  sort_by_frequency (symbols, used, weights);
  for (;;)
  {
    guint32 leaf = 0, inner = used, next = used, deepest = 0;
    for (i = 0; i != used; i++)
      node_weights[i] = MAX (weights[symbols[i]] >> shift, 1);
    while (next != 2 * used - 1)
    {
      guint32 picked[2], k;
      for (k = 0; k != 2; k++)
      {
        if (leaf != used && (inner == next || node_weights[leaf] <= node_weights[inner]))
          picked[k] = leaf++;
        else
          picked[k] = inner++;
      }
      node_weights[next] = node_weights[picked[0]] + node_weights[picked[1]];
      parents[picked[0]] = next;
      parents[picked[1]] = next;
      next++;
    }
    depths[2 * used - 2] = 0;
    for (i = 2 * used - 2; i-- != 0;)
    {
      depths[i] = depths[parents[i]] + 1;
      if (i < used && depths[i] > deepest)
        deepest = depths[i];
    }
    if (deepest <= longest)
      break;
    shift++;
  }
  for (i = 0; i != used; i++)
    code->lengths[symbols[i]] = depths[i];
  assign_codes (code, count);
  g_free (scratch);
}

static void sort_by_frequency (guint32 * symbols, guint32 count, const guint32 * frequencies)
{
  guint32 i, j;
  for (i = 1; i < count; i++)
  {
    guint32 symbol = symbols[i];
    for (j = i; j != 0 && frequencies[symbols[j - 1]] > frequencies[symbol]; j--)
      symbols[j] = symbols[j - 1];
    symbols[j] = symbol;
  }
}

static guint32 run_length_encode (const guint8 * lengths, guint32 count, guint8 * runs)
{
  guint32 written = 0, i = 0;
  while (i != count)
  {
    guint32 length = lengths[i], run = 1;
    while (i + run != count && lengths[i + run] == length)
      run++;
    if (length == 0 && run >= 3)
    {
      guint32 taken = MIN (run, 138);
      runs[written++] = (taken >= 11) ? 18 : 17;
      runs[written++] = (taken >= 11) ? taken - 11 : taken - 3;
      i += taken;
    }
    else if (length != 0 && run >= 4)
    {
      guint32 taken = MIN (run - 1, 6);
      runs[written++] = length;
      runs[written++] = 16;
      runs[written++] = taken - 3;
      i += taken + 1;
    }
    else
    {
      runs[written++] = length;
      i++;
    }
  }
  return written;
}

static guint64 tokens_cost (const DeflateTables * tables, const Token * tokens, guint32 count, const Huffman * literals,
    const Huffman * distances)
{
  guint64 cost = literals->lengths[END_OF_BLOCK];
  guint32 i;
  for (i = 0; i != count; i++)
  {
    if (tokens[i].distance == 0)
    {
      cost += literals->lengths[tokens[i].symbol];
    }
    else
    {
      guint32 length_symbol = tables->length_symbols[tokens[i].symbol], distance = distance_symbol (tables, tokens[i].distance);
      cost += literals->lengths[257 + length_symbol] + length_extra_bits[length_symbol] + distances->lengths[distance] +
          distance_extra_bits[distance];
    }
  }
  return cost;
}

static void write_stored (BitWriter * writer, const guint8 * raw, gsize raw_length, gboolean last)
{
  do
  {
    gsize taken = MIN (raw_length, LONGEST_STORED);
    put_bits (writer, (last && taken == raw_length) ? 1 : 0, 3);
    align_to_byte (writer);
    writer->out[writer->length++] = taken & 0xff;
    writer->out[writer->length++] = taken >> 8;
    writer->out[writer->length++] = ~taken & 0xff;
    writer->out[writer->length++] = (~taken >> 8) & 0xff;
    memcpy (writer->out + writer->length, raw, taken);
    writer->length += taken;
    raw += taken;
    raw_length -= taken;
  }
  while (raw_length != 0);
}

static void put_bits (BitWriter * writer, guint32 value, guint32 count)
{
  writer->bits |= (guint64) value << writer->bit_count;
  writer->bit_count += count;
  while (writer->bit_count >= 8)
  {
    writer->out[writer->length++] = (guint8) writer->bits;
    writer->bits >>= 8;
    writer->bit_count -= 8;
  }
}

static void write_tokens (BitWriter * writer, const DeflateTables * tables, const Token * tokens, guint32 count, const Huffman * literals,
    const Huffman * distances)
{
  guint32 i;
  for (i = 0; i != count; i++)
  {
    const Token * token = &tokens[i];
    if (token->distance == 0)
    {
      put_bits (writer, literals->codes[token->symbol], literals->lengths[token->symbol]);
    }
    else
    {
      guint32 length_symbol = tables->length_symbols[token->symbol], distance = distance_symbol (tables, token->distance);
      put_bits (writer, literals->codes[257 + length_symbol], literals->lengths[257 + length_symbol]);
      put_bits (writer, token->symbol - length_bases[length_symbol], length_extra_bits[length_symbol]);
      put_bits (writer, distances->codes[distance], distances->lengths[distance]);
      put_bits (writer, token->distance - distance_bases[distance], distance_extra_bits[distance]);
    }
  }
  put_bits (writer, literals->codes[END_OF_BLOCK], literals->lengths[END_OF_BLOCK]);
}

static void align_to_byte (BitWriter * writer)
{
  if (writer->bit_count != 0)
    put_bits (writer, 0, 8 - writer->bit_count);
}

static guint32 adler32 (const guint8 * data, gsize length)
{
  guint32 a = 1, b = 0;
  while (length != 0)
  {
    gsize run = MIN (length, ADLER_RUN), i;
    for (i = 0; i != run; i++)
    {
      a += data[i];
      b += a;
    }
    a %= ADLER_MODULUS;
    b %= ADLER_MODULUS;
    data += run;
    length -= run;
  }
  return (b << 16) | a;
}
`;

const kernels = new CModule(source);

const decode = new NativeFunction(kernels.decode_texture, "void", ["pointer", "uint32", "uint32", "uint32", "pointer"]);
const pngCapacity = new NativeFunction(kernels.png_capacity, "uint64", ["uint32", "uint32"]);
const encode = new NativeFunction(kernels.encode_png, "uint64", ["pointer", "uint32", "uint32", "pointer"]);
const fit = new NativeFunction(kernels.fit_for_view, "void", ["pointer", "uint32", "uint32", "uint32", "uint32", "pointer"]);
const checksum = new NativeFunction(kernels.crc32_of, "uint32", ["pointer", "uint64"]);

const textureFormats: TextureFormat[] = [
    "r8unorm", "a8unorm", "rg8unorm", "rgb8unorm", "rgba8unorm", "bgra8unorm", "bgrx8unorm",
    "rgb565", "rgba4444", "argb4444", "rgb5a1", "a1rgb5", "rgb10a2unorm", "rg11b10float", "rgb9e5float",
    "r16unorm", "rg16unorm", "rgba16unorm", "r16float", "rg16float", "rgba16float", "r32float", "rg32float", "rgba32float",
    "bc1", "bc2", "bc3", "bc4unorm", "bc4snorm", "bc5unorm", "bc5snorm", "bc6hufloat", "bc6hsfloat", "bc7",
    "etc2rgb8", "etc2rgb8a1", "etc2rgba8", "eacr11", "eacrg11",
    "astc4x4", "astc5x4", "astc5x5", "astc6x5", "astc6x6", "astc8x5", "astc8x6", "astc8x8",
    "astc10x5", "astc10x6", "astc10x8", "astc10x10", "astc12x10", "astc12x12",
];

export function decodeTexture(bytes: ArrayBuffer, format: TextureFormat, width: number, height: number): Uint8Array {
    const rgba = new Uint8Array(width * height * 4);
    decode(bytes.unwrap(), textureFormats.indexOf(format), width, height, rgba.buffer.unwrap());
    return rgba;
}

export function encodePng(rgba: Uint8Array, width: number, height: number): ArrayBuffer {
    const png = new ArrayBuffer(pngCapacity(width, height).toNumber());
    const length = encode(addressOf(rgba), width, height, png.unwrap());
    return png.slice(0, length.toNumber());
}

export function fitForView(rgba: Uint8Array, width: number, height: number, largestSide: number): ViewPixels {
    const scale = Math.min(1, largestSide / Math.max(width, height));
    const fittedWidth = Math.max(1, Math.round(width * scale));
    const fittedHeight = Math.max(1, Math.round(height * scale));
    const pixels = new ArrayBuffer(fittedWidth * fittedHeight * 4);
    fit(addressOf(rgba), width, height, fittedWidth, fittedHeight, pixels.unwrap());
    return { pixels, width: fittedWidth, height: fittedHeight };
}

export function crc32(bytes: Uint8Array): number {
    return checksum(addressOf(bytes), bytes.byteLength);
}

function addressOf(bytes: Uint8Array): NativePointer {
    return (bytes.buffer as ArrayBuffer).unwrap().add(bytes.byteOffset);
}
