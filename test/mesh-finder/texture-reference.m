#import <Foundation/Foundation.h>
#import <Metal/Metal.h>

#include <stdio.h>

typedef struct {
    uint32_t swizzle[4];
    uint32_t snorm;
} SampleParameters;

typedef struct {
    const char *name;
    MTLPixelFormat format;
    uint32_t block_width;
    uint32_t block_height;
    uint32_t block_size;
} FormatDescription;

static const FormatDescription formats[] = {
    { "R8Unorm", MTLPixelFormatR8Unorm, 1, 1, 1 },
    { "A8Unorm", MTLPixelFormatA8Unorm, 1, 1, 1 },
    { "RG8Unorm", MTLPixelFormatRG8Unorm, 1, 1, 2 },
    { "RGBA8Unorm", MTLPixelFormatRGBA8Unorm, 1, 1, 4 },
    { "BGRA8Unorm", MTLPixelFormatBGRA8Unorm, 1, 1, 4 },
    { "B5G6R5Unorm", MTLPixelFormatB5G6R5Unorm, 1, 1, 2 },
    { "ABGR4Unorm", MTLPixelFormatABGR4Unorm, 1, 1, 2 },
    { "A1BGR5Unorm", MTLPixelFormatA1BGR5Unorm, 1, 1, 2 },
    { "BGR5A1Unorm", MTLPixelFormatBGR5A1Unorm, 1, 1, 2 },
    { "RGB10A2Unorm", MTLPixelFormatRGB10A2Unorm, 1, 1, 4 },
    { "RG11B10Float", MTLPixelFormatRG11B10Float, 1, 1, 4 },
    { "RGB9E5Float", MTLPixelFormatRGB9E5Float, 1, 1, 4 },
    { "R16Unorm", MTLPixelFormatR16Unorm, 1, 1, 2 },
    { "RG16Unorm", MTLPixelFormatRG16Unorm, 1, 1, 4 },
    { "RGBA16Unorm", MTLPixelFormatRGBA16Unorm, 1, 1, 8 },
    { "R16Float", MTLPixelFormatR16Float, 1, 1, 2 },
    { "RG16Float", MTLPixelFormatRG16Float, 1, 1, 4 },
    { "RGBA16Float", MTLPixelFormatRGBA16Float, 1, 1, 8 },
    { "R32Float", MTLPixelFormatR32Float, 1, 1, 4 },
    { "RG32Float", MTLPixelFormatRG32Float, 1, 1, 8 },
    { "RGBA32Float", MTLPixelFormatRGBA32Float, 1, 1, 16 },
    { "BC1_RGBA", MTLPixelFormatBC1_RGBA, 4, 4, 8 },
    { "BC2_RGBA", MTLPixelFormatBC2_RGBA, 4, 4, 16 },
    { "BC3_RGBA", MTLPixelFormatBC3_RGBA, 4, 4, 16 },
    { "BC4_RUnorm", MTLPixelFormatBC4_RUnorm, 4, 4, 8 },
    { "BC4_RSnorm", MTLPixelFormatBC4_RSnorm, 4, 4, 8 },
    { "BC5_RGUnorm", MTLPixelFormatBC5_RGUnorm, 4, 4, 16 },
    { "BC5_RGSnorm", MTLPixelFormatBC5_RGSnorm, 4, 4, 16 },
    { "BC6H_RGBUfloat", MTLPixelFormatBC6H_RGBUfloat, 4, 4, 16 },
    { "BC6H_RGBFloat", MTLPixelFormatBC6H_RGBFloat, 4, 4, 16 },
    { "BC7_RGBAUnorm", MTLPixelFormatBC7_RGBAUnorm, 4, 4, 16 },
    { "ETC2_RGB8", MTLPixelFormatETC2_RGB8, 4, 4, 8 },
    { "ETC2_RGB8A1", MTLPixelFormatETC2_RGB8A1, 4, 4, 8 },
    { "EAC_RGBA8", MTLPixelFormatEAC_RGBA8, 4, 4, 16 },
    { "EAC_R11Unorm", MTLPixelFormatEAC_R11Unorm, 4, 4, 8 },
    { "EAC_RG11Unorm", MTLPixelFormatEAC_RG11Unorm, 4, 4, 16 },
    { "ASTC_4x4_LDR", MTLPixelFormatASTC_4x4_LDR, 4, 4, 16 },
    { "ASTC_5x4_LDR", MTLPixelFormatASTC_5x4_LDR, 5, 4, 16 },
    { "ASTC_5x5_LDR", MTLPixelFormatASTC_5x5_LDR, 5, 5, 16 },
    { "ASTC_6x5_LDR", MTLPixelFormatASTC_6x5_LDR, 6, 5, 16 },
    { "ASTC_6x6_LDR", MTLPixelFormatASTC_6x6_LDR, 6, 6, 16 },
    { "ASTC_8x5_LDR", MTLPixelFormatASTC_8x5_LDR, 8, 5, 16 },
    { "ASTC_8x6_LDR", MTLPixelFormatASTC_8x6_LDR, 8, 6, 16 },
    { "ASTC_8x8_LDR", MTLPixelFormatASTC_8x8_LDR, 8, 8, 16 },
    { "ASTC_10x5_LDR", MTLPixelFormatASTC_10x5_LDR, 10, 5, 16 },
    { "ASTC_10x6_LDR", MTLPixelFormatASTC_10x6_LDR, 10, 6, 16 },
    { "ASTC_10x8_LDR", MTLPixelFormatASTC_10x8_LDR, 10, 8, 16 },
    { "ASTC_10x10_LDR", MTLPixelFormatASTC_10x10_LDR, 10, 10, 16 },
    { "ASTC_12x10_LDR", MTLPixelFormatASTC_12x10_LDR, 12, 10, 16 },
    { "ASTC_12x12_LDR", MTLPixelFormatASTC_12x12_LDR, 12, 12, 16 },
};

static NSString *const shaderSource =
    @"#include <metal_stdlib>\n"
     "using namespace metal;\n"
     "struct SampleParameters { uint swizzle[4]; uint snorm; };\n"
     "kernel void sample_texels (texture2d<float> source [[texture(0)]],\n"
     "    texture2d<float, access::write> target [[texture(1)]],\n"
     "    constant SampleParameters & parameters [[buffer(0)]],\n"
     "    uint2 position [[thread_position_in_grid]])\n"
     "{\n"
     "  if (position.x >= source.get_width () || position.y >= source.get_height ())\n"
     "    return;\n"
     "  constexpr sampler nearest (coord::pixel, filter::nearest, address::clamp_to_edge);\n"
     "  float4 texel = source.sample (nearest, float2 (position) + 0.5);\n"
     "  if (parameters.snorm != 0)\n"
     "    texel = (texel + 1.0) * 0.5;\n"
     "  float4 picked;\n"
     "  for (uint i = 0; i != 4; i++)\n"
     "  {\n"
     "    uint s = parameters.swizzle[i];\n"
     "    picked[i] = (s < 4) ? texel[s] : ((s == 4) ? 0.0 : 1.0);\n"
     "  }\n"
     "  target.write (picked, position);\n"
     "}\n";

static const FormatDescription *formatNamed(const char *name);
static NSData *readAll(FILE *stream);
static uint32_t swizzleChannel(char c);

int main(int argc, char **argv)
{
    @autoreleasepool {
        if (argc != 6) {
            fprintf(stderr, "usage: %s <MTLPixelFormat name> <width> <height> <swizzle, e.g. rgba, rrr1, 111a> <snorm 0|1> "
                "< texture > rgba8\n", argv[0]);
            return 1;
        }
        const FormatDescription *description = formatNamed(argv[1]);
        NSUInteger width = strtoul(argv[2], NULL, 10), height = strtoul(argv[3], NULL, 10);
        SampleParameters parameters = { { 0, 0, 0, 0 }, (uint32_t) strtoul(argv[5], NULL, 10) };
        for (int i = 0; i != 4; i++) {
            parameters.swizzle[i] = swizzleChannel(argv[4][i]);
        }
        if (description == NULL) {
            fprintf(stderr, "unknown format %s\n", argv[1]);
            return 1;
        }

        id<MTLDevice> device = MTLCreateSystemDefaultDevice();
        id<MTLLibrary> library = [device newLibraryWithSource:shaderSource options:nil error:NULL];
        id<MTLComputePipelineState> pipeline =
            [device newComputePipelineStateWithFunction:[library newFunctionWithName:@"sample_texels"] error:NULL];

        NSData *input = readAll(stdin);
        NSUInteger columns = (width + description->block_width - 1) / description->block_width;
        NSUInteger rows = (height + description->block_height - 1) / description->block_height;
        NSUInteger rowBytes = columns * description->block_size;

        MTLTextureDescriptor *sourceDescriptor = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:description->format
                                                                                                     width:width
                                                                                                    height:height
                                                                                                 mipmapped:NO];
        sourceDescriptor.usage = MTLTextureUsageShaderRead;
        sourceDescriptor.storageMode = MTLStorageModeShared;
        id<MTLTexture> source = [device newTextureWithDescriptor:sourceDescriptor];
        [source replaceRegion:MTLRegionMake2D(0, 0, width, height) mipmapLevel:0 withBytes:input.bytes bytesPerRow:rowBytes];

        MTLTextureDescriptor *targetDescriptor = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA8Unorm
                                                                                                     width:width
                                                                                                    height:height
                                                                                                 mipmapped:NO];
        targetDescriptor.usage = MTLTextureUsageShaderWrite;
        targetDescriptor.storageMode = MTLStorageModeShared;
        id<MTLTexture> target = [device newTextureWithDescriptor:targetDescriptor];

        id<MTLCommandQueue> queue = [device newCommandQueue];
        id<MTLCommandBuffer> commands = [queue commandBuffer];
        id<MTLComputeCommandEncoder> encoder = [commands computeCommandEncoder];
        [encoder setComputePipelineState:pipeline];
        [encoder setTexture:source atIndex:0];
        [encoder setTexture:target atIndex:1];
        [encoder setBytes:&parameters length:sizeof(parameters) atIndex:0];
        [encoder dispatchThreads:MTLSizeMake(width, height, 1) threadsPerThreadgroup:MTLSizeMake(8, 8, 1)];
        [encoder endEncoding];
        [commands commit];
        [commands waitUntilCompleted];

        NSMutableData *texels = [NSMutableData dataWithLength:width * height * 4];
        [target getBytes:texels.mutableBytes bytesPerRow:width * 4 fromRegion:MTLRegionMake2D(0, 0, width, height) mipmapLevel:0];
        fwrite(texels.bytes, 1, texels.length, stdout);
        return 0;
    }
}

static const FormatDescription *formatNamed(const char *name)
{
    for (size_t i = 0; i != sizeof(formats) / sizeof(formats[0]); i++) {
        if (strcmp(formats[i].name, name) == 0) {
            return &formats[i];
        }
    }
    return NULL;
}

static NSData *readAll(FILE *stream)
{
    NSMutableData *data = [NSMutableData data];
    char chunk[65536];
    size_t n;
    while ((n = fread(chunk, 1, sizeof(chunk), stream)) != 0) {
        [data appendBytes:chunk length:n];
    }
    return data;
}

static uint32_t swizzleChannel(char c)
{
    switch (c) {
        case 'r': return 0;
        case 'g': return 1;
        case 'b': return 2;
        case 'a': return 3;
        case '0': return 4;
        default: return 5;
    }
}
