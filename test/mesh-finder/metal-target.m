#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#import <mach/mach_time.h>
#import <signal.h>
#import "meshes.h"

static NSString *const shaderSource = @
    "#include <metal_stdlib>\n"
    "using namespace metal;\n"
    "struct Uniforms { float4x4 mvp; };\n"
    "struct Out { float4 position [[position]]; float3 color; float2 uv; };\n"
    "struct Described { float3 position [[attribute(0)]]; float3 normal [[attribute(1)]]; };\n"
    "struct Textured { float3 position [[attribute(0)]]; float3 normal [[attribute(1)]]; float2 uv [[attribute(2)]]; };\n"
    "struct PositionOnly { float3 position [[attribute(0)]]; };\n"
    "struct Pulled { packed_float3 position; packed_float3 normal; };\n"
    "vertex Out described_vertex(Described in [[stage_in]], constant Uniforms &u [[buffer(0)]]) {\n"
    "    return { u.mvp * float4(in.position, 1), in.normal * 0.5 + 0.5, float2(0) };\n"
    "}\n"
    "vertex Out textured_vertex(Textured in [[stage_in]], constant Uniforms &u [[buffer(0)]]) {\n"
    "    return { u.mvp * float4(in.position, 1), in.normal * 0.5 + 0.5, in.uv };\n"
    "}\n"
    "vertex Out position_vertex(PositionOnly in [[stage_in]], constant Uniforms &u [[buffer(0)]]) {\n"
    "    return { u.mvp * float4(in.position, 1), float3(1), float2(0) };\n"
    "}\n"
    "vertex Out pulled_vertex(uint vid [[vertex_id]], const device Pulled *vertices [[buffer(1)]], constant Uniforms &u [[buffer(0)]]) {\n"
    "    Pulled v = vertices[vid];\n"
    "    return { u.mvp * float4(float3(v.position), 1), float3(v.normal) * 0.5 + 0.5, float2(0) };\n"
    "}\n"
    "fragment float4 shade(Out in [[stage_in]]) { return float4(in.color, 1); }\n"
    "fragment float4 textured_shade(Out in [[stage_in]], texture2d<float> albedo [[texture(0)]], texture2d<float> normalMap [[texture(1)]]) {\n"
    "    constexpr sampler linear(filter::linear);\n"
    "    float3 normal = normalMap.sample(linear, in.uv).xyz * 2 - 1;\n"
    "    return albedo.sample(linear, in.uv) * float4(in.color * max(normal.z, 0.5), 1);\n"
    "}\n";

static volatile sig_atomic_t late_upload_requested;

enum {
    UNIFORM_SLOT = 0, VERTEX_SLOT = 1, ATTRIBUTE_SLOT = 2, UNIFORM_STRIDE = 256, SCRATCH_LENGTH = 4 * 1024 * 1024, SCRATCH_COUNT = 2,
    SPHERE_OFFSET = 256, CUBE_ALBEDO_WIDTH = 8, CUBE_ALBEDO_HEIGHT = 4, RIBBON_ALBEDO_WIDTH = 16, RIBBON_ALBEDO_HEIGHT = 8,
    ALBEDO_SLOT = 0, NORMAL_MAP_SLOT = 1,
};

static const uint8_t cubeAlbedoCorners[4][4] = { { 255, 0, 0, 255 }, { 0, 255, 0, 255 }, { 0, 0, 255, 255 }, { 255, 255, 255, 128 } };
static const uint16_t ribbonAlbedoCorners565[4] = { 0xf800, 0x07e0, 0x001f, 0xffe0 };
static const uint8_t ribbonAlbedoCorners[4][4] = { { 255, 0, 0, 255 }, { 0, 255, 0, 255 }, { 0, 0, 255, 255 }, { 255, 255, 0, 255 } };

@interface Scene : NSObject
@property (nonatomic, strong) id<MTLDevice> device;
@property (nonatomic, strong) id<MTLCommandQueue> queue;
@property (nonatomic, strong) id<MTLLibrary> library;
@property (nonatomic, strong) id<MTLTexture> target;
@property (nonatomic, strong) id<MTLTexture> depth;
@property (nonatomic, strong) id<MTLDepthStencilState> depthState;
@property (nonatomic, strong) id<MTLRenderPipelineState> interleaved;
@property (nonatomic, strong) id<MTLRenderPipelineState> splitStreams;
@property (nonatomic, strong) id<MTLRenderPipelineState> pulled;
@property (nonatomic, strong) id<MTLRenderPipelineState> paddedPositions;
@property (nonatomic, strong) id<MTLRenderPipelineState> packedPositions;
@property (nonatomic, strong) id<MTLRenderPipelineState> batched;
@property (nonatomic, strong) id<MTLRenderPipelineState> halfPositions;
@property (nonatomic, strong) NSArray<id<MTLBuffer>> *scratches;
@property (nonatomic, strong) id<MTLBuffer> cubeVertices, cubeIndices;
@property (nonatomic, strong) id<MTLBuffer> spherePositions, sphereAttributes, sphereIndices;
@property (nonatomic, strong) id<MTLBuffer> torusVertices, torusIndices;
@property (nonatomic, strong) id<MTLBuffer> ribbonVertices;
@property (nonatomic, strong) id<MTLBuffer> octahedronVertices;
@property (nonatomic, strong) id<MTLBuffer> batchVertices;
@property (nonatomic, strong) id<MTLBuffer> halfVertices, halfIndices;
@property (nonatomic, strong) id<MTLBuffer> privateVertices, privateIndices;
@property (nonatomic, strong) id<MTLBuffer> hiddenVertices, hiddenIndices;
@property (nonatomic, strong) id<MTLBuffer> lateVertices, lateIndices;
@property (nonatomic, strong) id<MTLTexture> cubeAlbedo, normalMap, ribbonAlbedo, privateAlbedo;
- (instancetype)initWithRepeats:(int)repeats;
- (double)renderFrame;
@end

static void request_late_upload(int signal);
static uint16_t *batched_indices16(const Mesh *first, const Mesh *second);
static uint16_t *half_positions(const Mesh *mesh);
static uint16_t half_of(float value);
static void expect_absent(const Mesh *mesh, const char *how, uint32_t triangle_count);
static void expect_texture(const Mesh *mesh, uint32_t width, uint32_t height, const char *format, const uint8_t corners[4][4]);
static double elapsedMilliseconds(uint64_t start);

int main(int argc, char **argv)
{
    @autoreleasepool {
        int repeats = (argc > 1) ? atoi(argv[1]) : 1;
        Scene *scene = [[Scene alloc] initWithRepeats:repeats];
        signal(SIGUSR1, request_late_upload);
        printf("pid %d ready, %d draws per frame\n", getpid(), repeats * 11);
        fflush(stdout);
        double total = 0, worst = 0, encoding = 0;
        int frames = 0;
        for (;;) {
            @autoreleasepool {
                uint64_t start = mach_absolute_time();
                encoding += [scene renderFrame];
                double elapsed = elapsedMilliseconds(start);
                total += elapsed;
                worst = fmax(worst, elapsed);
                if (++frames == 120) {
                    printf("frame time: mean %.3f ms, worst %.3f ms; encoding: mean %.3f ms\n", total / frames, worst, encoding / frames);
                    fflush(stdout);
                    total = worst = encoding = 0;
                    frames = 0;
                }
            }
            usleep(16000);
        }
    }
}

@implementation Scene {
    int _repeats;
    Mesh _cube, _sphere, _torus, _ribbon, _octahedron, _pyramid, _privateCube, _hidden, _late;
    Mesh _batchedSphere, _batchedTorus, _halfSphere;
    uint16_t *_batchIndices;
    void *_pyramidPositions;
    uint64_t _frame;
    NSUInteger _scratchCursor;
}

- (instancetype)initWithRepeats:(int)repeats
{
    self = [super init];
    _repeats = repeats;
    _device = MTLCreateSystemDefaultDevice();
    _queue = [_device newCommandQueue];
    NSError *error = nil;
    _library = [_device newLibraryWithSource:shaderSource options:nil error:&error];
    if (_library == nil) {
        NSLog(@"%@", error);
        exit(1);
    }
    MTLTextureDescriptor *color = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
                                                                                     width:256
                                                                                    height:256
                                                                                 mipmapped:NO];
    color.usage = MTLTextureUsageRenderTarget;
    color.storageMode = MTLStorageModePrivate;
    _target = [_device newTextureWithDescriptor:color];
    MTLTextureDescriptor *depth = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatDepth32Float
                                                                                     width:256
                                                                                    height:256
                                                                                 mipmapped:NO];
    depth.usage = MTLTextureUsageRenderTarget;
    depth.storageMode = MTLStorageModePrivate;
    _depth = [_device newTextureWithDescriptor:depth];
    MTLDepthStencilDescriptor *depthDescriptor = [MTLDepthStencilDescriptor new];
    depthDescriptor.depthCompareFunction = MTLCompareFunctionLess;
    depthDescriptor.depthWriteEnabled = YES;
    _depthState = [_device newDepthStencilStateWithDescriptor:depthDescriptor];

    [self buildPipelines];
    [self uploadMeshes];
    [self uploadTextures];
    return self;
}

- (double)renderFrame
{
    if (late_upload_requested) {
        late_upload_requested = 0;
        [self uploadLateMesh];
    }
    if (_frame % 120 == 119) {
        _interleaved = [self pipelineWithFunction:@"textured_vertex" fragment:@"textured_shade" layout:[self interleavedLayout]];
    }
    MTLRenderPassDescriptor *pass = [MTLRenderPassDescriptor renderPassDescriptor];
    pass.colorAttachments[0].texture = _target;
    pass.colorAttachments[0].loadAction = MTLLoadActionClear;
    pass.colorAttachments[0].storeAction = MTLStoreActionStore;
    pass.depthAttachment.texture = _depth;
    pass.depthAttachment.loadAction = MTLLoadActionClear;
    pass.depthAttachment.clearDepth = 1;
    uint64_t encodeStart = mach_absolute_time();
    id<MTLCommandBuffer> commands = [_queue commandBuffer];
    id<MTLRenderCommandEncoder> encoder = [commands renderCommandEncoderWithDescriptor:pass];
    [encoder setDepthStencilState:_depthState];
    float angle = _frame * 0.01f;
    id<MTLBuffer> scratch = [self scratch];
    _scratchCursor = 0;
    void (^uniformsForNextDraw)(void) = ^{
        [encoder setVertexBuffer:scratch offset:[self scratchUniformsAtAngle:angle] atIndex:UNIFORM_SLOT];
    };

    for (int repeat = 0; repeat != _repeats; repeat++) {
        [self encodeScene:encoder uniforms:uniformsForNextDraw];
    }
    [encoder endEncoding];
    [commands commit];
    double encoded = elapsedMilliseconds(encodeStart);
    [commands waitUntilCompleted];
    _frame++;
    return encoded;
}

- (id<MTLBuffer>)scratch
{
    return _scratches[_frame % SCRATCH_COUNT];
}

- (NSUInteger)scratchUniformsAtAngle:(float)angle
{
    float uniforms[UNIFORM_STRIDE / 4] = {
        cosf(angle) * 0.1f, 0, sinf(angle) * 0.1f, 0,
        0, 0.1f, 0, 0,
        -sinf(angle) * 0.05f, 0, cosf(angle) * 0.05f, 0,
        0, 0, 0.5f, 1,
    };
    for (int i = 16; i != UNIFORM_STRIDE / 4; i++) {
        uniforms[i] = 40 * sinf(angle * i + _scratchCursor);
    }
    return [self scratchBytes:uniforms length:sizeof(uniforms)];
}

- (NSUInteger)scratchBytes:(const void *)bytes length:(NSUInteger)length
{
    NSUInteger offset = _scratchCursor;
    memcpy((uint8_t *) [self scratch].contents + offset, bytes, length);
    _scratchCursor += (length + UNIFORM_STRIDE - 1) / UNIFORM_STRIDE * UNIFORM_STRIDE;
    return offset;
}

- (void)buildPipelines
{
    _interleaved = [self pipelineWithFunction:@"textured_vertex" fragment:@"textured_shade" layout:[self interleavedLayout]];
    MTLVertexDescriptor *split = [MTLVertexDescriptor vertexDescriptor];
    split.attributes[0].format = MTLVertexFormatFloat3;
    split.attributes[0].bufferIndex = VERTEX_SLOT;
    split.attributes[1].format = MTLVertexFormatFloat3;
    split.attributes[1].offset = 12;
    split.attributes[1].bufferIndex = ATTRIBUTE_SLOT;
    split.layouts[VERTEX_SLOT].stride = 12;
    split.layouts[ATTRIBUTE_SLOT].stride = sizeof(Vertex);
    _splitStreams = [self pipelineWithFunction:@"described_vertex" fragment:@"shade" layout:split];
    _pulled = [self pipelineWithFunction:@"pulled_vertex" fragment:@"shade" layout:nil];
    _paddedPositions = [self pipelineWithFunction:@"position_vertex" fragment:@"shade" layout:[self positionLayoutWithStride:16]];
    _packedPositions = [self pipelineWithFunction:@"position_vertex" fragment:@"shade" layout:[self positionLayoutWithStride:12]];
    _batched = [self pipelineWithFunction:@"described_vertex" fragment:@"shade" layout:[self interleavedLayout]];
    MTLVertexDescriptor *half = [self positionLayoutWithStride:8];
    half.attributes[0].format = MTLVertexFormatHalf3;
    _halfPositions = [self pipelineWithFunction:@"position_vertex" fragment:@"shade" layout:half];
}

- (void)uploadMeshes
{
    _cube = make_cube("cube", 0, 0, 0);
    _sphere = make_sphere("sphere", 4, 0, 0, 1.5f, 16, 32);
    _torus = make_torus("torus", 0, 4, 0, 1.2f, 0.4f, 48, 16);
    _ribbon = make_ribbon("ribbon", 0, 0, 4, 20);
    _octahedron = make_octahedron("octahedron", 0, -4, 0);
    _pyramid = make_pyramid("pyramid", -4, 4, 0);
    _privateCube = make_cube("private-cube", 4, 4, 0);
    _hidden = make_torus("hidden-torus", -4, 0, 0, 2.0f, 0.5f, 32, 12);
    _late = make_sphere("late-sphere", 0, 0, -4, 0.75f, 8, 12);
    _batchedSphere = make_sphere("batched-sphere", 8, 0, 0, 1.0f, 12, 24);
    _batchedTorus = make_torus("batched-torus", 8, 4, 0, 1.0f, 0.3f, 32, 12);
    _halfSphere = make_sphere("half-float-sphere", -8, 0, 0, 1.0f, 12, 24);

    _cubeVertices = [self bufferWithBytes:_cube.vertices length:_cube.vertex_count * sizeof(Vertex) label:@"Cube vertices"];
    uint16_t *cubeIndices = indices16(&_cube);
    _cubeIndices = [self bufferWithBytes:cubeIndices length:_cube.index_count * 2 label:nil];

    void *spherePositions = positions_with_stride(&_sphere, 12);
    NSMutableData *paddedSphere = [NSMutableData dataWithLength:SPHERE_OFFSET];
    [paddedSphere appendBytes:spherePositions length:_sphere.vertex_count * 12];
    _spherePositions = [self bufferWithBytes:paddedSphere.bytes length:paddedSphere.length label:@"Sphere positions"];
    _sphereAttributes = [self bufferWithBytes:_sphere.vertices length:_sphere.vertex_count * sizeof(Vertex) label:nil];
    _sphereIndices = [self bufferWithBytes:_sphere.indices length:_sphere.index_count * 4 label:nil];

    void *torusVertices = pulled_vertices(&_torus);
    _torusVertices = [self bufferWithBytes:torusVertices length:_torus.vertex_count * 24 label:nil];
    uint16_t *torusIndices = indices16(&_torus);
    _torusIndices = [self bufferWithBytes:torusIndices length:_torus.index_count * 2 label:nil];

    _ribbonVertices = [self bufferWithBytes:_ribbon.vertices length:_ribbon.vertex_count * sizeof(Vertex) label:@"Ribbon"];
    void *octahedron = positions_with_stride(&_octahedron, 16);
    _octahedronVertices = [self bufferWithBytes:octahedron length:_octahedron.vertex_count * 16 label:nil];
    _pyramidPositions = positions_with_stride(&_pyramid, 12);

    NSMutableData *batchVertices = [NSMutableData dataWithBytes:_batchedSphere.vertices
                                                         length:_batchedSphere.vertex_count * sizeof(Vertex)];
    [batchVertices appendBytes:_batchedTorus.vertices length:_batchedTorus.vertex_count * sizeof(Vertex)];
    _batchVertices = [self bufferWithBytes:batchVertices.bytes length:batchVertices.length label:@"Batch"];
    _batchIndices = batched_indices16(&_batchedSphere, &_batchedTorus);
    uint16_t *halfPositions = half_positions(&_halfSphere);
    _halfVertices = [self bufferWithBytes:halfPositions length:_halfSphere.vertex_count * 8 label:@"Half floats"];
    uint16_t *halfIndices = indices16(&_halfSphere);
    _halfIndices = [self bufferWithBytes:halfIndices length:_halfSphere.index_count * 2 label:nil];

    id<MTLBuffer> stagingVertices = [self bufferWithBytes:_privateCube.vertices
                                                   length:_privateCube.vertex_count * sizeof(Vertex)
                                                    label:nil];
    uint16_t *privateIndices = indices16(&_privateCube);
    id<MTLBuffer> stagingIndices = [self bufferWithBytes:privateIndices length:_privateCube.index_count * 2 label:nil];
    _privateVertices = [_device newBufferWithLength:stagingVertices.length options:MTLResourceStorageModePrivate];
    _privateVertices.label = @"Private cube";
    _privateIndices = [_device newBufferWithLength:stagingIndices.length options:MTLResourceStorageModePrivate];
    id<MTLCommandBuffer> upload = [_queue commandBuffer];
    id<MTLBlitCommandEncoder> blit = [upload blitCommandEncoder];
    [blit copyFromBuffer:stagingVertices sourceOffset:0 toBuffer:_privateVertices destinationOffset:0 size:stagingVertices.length];
    [blit copyFromBuffer:stagingIndices sourceOffset:0 toBuffer:_privateIndices destinationOffset:0 size:stagingIndices.length];
    [blit endEncoding];
    [upload commit];
    [upload waitUntilCompleted];

    _hiddenVertices = [self bufferWithBytes:_hidden.vertices length:_hidden.vertex_count * sizeof(Vertex) label:nil];
    uint16_t *hiddenIndices = indices16(&_hidden);
    _hiddenIndices = [self bufferWithBytes:hiddenIndices length:_hidden.index_count * 2 label:nil];

    NSMutableArray<id<MTLBuffer>> *scratches = [NSMutableArray array];
    for (int i = 0; i != SCRATCH_COUNT; i++) {
        id<MTLBuffer> scratch = [_device newBufferWithLength:SCRATCH_LENGTH options:MTLResourceStorageModeShared];
        scratch.label = @"Scratch";
        [scratches addObject:scratch];
    }
    _scratches = scratches;

    free(cubeIndices);
    free(spherePositions);
    free(torusVertices);
    free(torusIndices);
    free(octahedron);
    free(privateIndices);
    free(hiddenIndices);
    free(halfPositions);
    free(halfIndices);

    expect(&_cube, "interleaved position, normal and uv; 16-bit indices; vertex descriptor; BGRA8 sRGB albedo and a normal map", 12, 1);
    expect_texture(&_cube, CUBE_ALBEDO_WIDTH, CUBE_ALBEDO_HEIGHT, "bgra8unorm", cubeAlbedoCorners);
    expect(&_sphere, "positions alone in their own buffer at an offset; 32-bit indices; vertex descriptor", _sphere.index_count / 3, 1);
    expect(&_torus, "vertex pulling with no vertex descriptor; 16-bit indices", _torus.index_count / 3, 1);
    expect(&_ribbon, "triangle strip, not indexed; BC1 albedo", _ribbon.vertex_count - 2, 1);
    expect_texture(&_ribbon, RIBBON_ALBEDO_WIDTH, RIBBON_ALBEDO_HEIGHT, "bc1", ribbonAlbedoCorners);
    expect(&_octahedron, "triangle list, not indexed, 16-byte stride", 8, 1);
    expect(&_pyramid, "setVertexBytes, not indexed", 6, 1);
    expect(&_privateCube, "private storage", 12, 0);
    expect(&_hidden, "uploaded, never drawn", _hidden.index_count / 3, 1);
    expect(&_late, "uploaded after attach, never drawn, found by a second scan", _late.index_count / 3, 1);
    expect(&_batchedSphere, "first of two meshes in one vertex buffer, indices rewritten every frame; pipeline made before attach",
        _batchedSphere.index_count / 3, 1);
    expect(&_batchedTorus, "second of two meshes in one vertex buffer, indices rewritten every frame; pipeline made before attach",
        _batchedTorus.index_count / 3, 1);
    expect_absent(&_halfSphere, "half-float positions; pipeline made before attach", _halfSphere.index_count / 3);
}

- (void)uploadTextures
{
    uint8_t cubeTexels[CUBE_ALBEDO_HEIGHT][CUBE_ALBEDO_WIDTH][4];
    for (int y = 0; y != CUBE_ALBEDO_HEIGHT; y++) {
        for (int x = 0; x != CUBE_ALBEDO_WIDTH; x++) {
            int corner = (x == CUBE_ALBEDO_WIDTH - 1) + 2 * (y == CUBE_ALBEDO_HEIGHT - 1);
            BOOL isCorner = (x == 0 || x == CUBE_ALBEDO_WIDTH - 1) && (y == 0 || y == CUBE_ALBEDO_HEIGHT - 1);
            const uint8_t gray[4] = { 128, 128, 128, 255 };
            const uint8_t *rgba = isCorner ? cubeAlbedoCorners[corner] : gray;
            uint8_t bgra[4] = { rgba[2], rgba[1], rgba[0], rgba[3] };
            memcpy(cubeTexels[y][x], bgra, 4);
        }
    }
    _cubeAlbedo = [self textureWithFormat:MTLPixelFormatBGRA8Unorm_sRGB width:CUBE_ALBEDO_WIDTH height:CUBE_ALBEDO_HEIGHT
                                    bytes:cubeTexels bytesPerRow:CUBE_ALBEDO_WIDTH * 4 label:@"Cube albedo"];

    uint8_t flatNormals[4][4][4];
    for (int i = 0; i != 16; i++) {
        memcpy(flatNormals[i / 4][i % 4], (uint8_t[4]) { 128, 128, 255, 255 }, 4);
    }
    _normalMap = [self textureWithFormat:MTLPixelFormatRGBA8Unorm width:4 height:4 bytes:flatNormals bytesPerRow:16 label:@"Normal map"];

    enum { COLUMNS = RIBBON_ALBEDO_WIDTH / 4, ROWS = RIBBON_ALBEDO_HEIGHT / 4 };
    uint16_t blocks[ROWS][COLUMNS][4] = { 0 };
    for (int row = 0; row != ROWS; row++) {
        for (int column = 0; column != COLUMNS; column++) {
            int corner = (column == COLUMNS - 1) + 2 * (row == ROWS - 1);
            BOOL isCorner = (column == 0 || column == COLUMNS - 1) && (row == 0 || row == ROWS - 1);
            blocks[row][column][0] = isCorner ? ribbonAlbedoCorners565[corner] : 0x8410;
        }
    }
    _ribbonAlbedo = [self textureWithFormat:MTLPixelFormatBC1_RGBA width:RIBBON_ALBEDO_WIDTH height:RIBBON_ALBEDO_HEIGHT
                                      bytes:blocks bytesPerRow:COLUMNS * 8 label:@"Ribbon albedo"];

    MTLTextureDescriptor *descriptor = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA8Unorm
                                                                                          width:4
                                                                                         height:4
                                                                                      mipmapped:NO];
    descriptor.storageMode = MTLStorageModePrivate;
    _privateAlbedo = [_device newTextureWithDescriptor:descriptor];
    _privateAlbedo.label = @"Private albedo";
}

- (id<MTLTexture>)textureWithFormat:(MTLPixelFormat)format
                              width:(NSUInteger)width
                             height:(NSUInteger)height
                              bytes:(const void *)bytes
                        bytesPerRow:(NSUInteger)bytesPerRow
                              label:(NSString *)label
{
    MTLTextureDescriptor *descriptor = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:format
                                                                                          width:width
                                                                                         height:height
                                                                                      mipmapped:NO];
    descriptor.storageMode = MTLStorageModeShared;
    id<MTLTexture> texture = [_device newTextureWithDescriptor:descriptor];
    [texture replaceRegion:MTLRegionMake2D(0, 0, width, height) mipmapLevel:0 withBytes:bytes bytesPerRow:bytesPerRow];
    texture.label = label;
    return texture;
}

- (void)uploadLateMesh
{
    _lateVertices = [self bufferWithBytes:_late.vertices length:_late.vertex_count * sizeof(Vertex) label:nil];
    uint16_t *indices = indices16(&_late);
    _lateIndices = [self bufferWithBytes:indices length:_late.index_count * 2 label:nil];
    free(indices);
    printf("uploaded the late mesh\n");
    fflush(stdout);
}

- (void)encodeScene:(id<MTLRenderCommandEncoder>)encoder uniforms:(void (^)(void))uniformsForNextDraw
{
    [encoder setRenderPipelineState:_interleaved];
    uniformsForNextDraw();
    id<MTLTexture> cubeTextures[2] = { _cubeAlbedo, _normalMap };
    [encoder setFragmentTextures:cubeTextures withRange:NSMakeRange(ALBEDO_SLOT, 2)];
    [encoder setVertexBuffer:_cubeVertices offset:0 atIndex:VERTEX_SLOT];
    [encoder drawIndexedPrimitives:MTLPrimitiveTypeTriangle indexCount:_cube.index_count indexType:MTLIndexTypeUInt16
                       indexBuffer:_cubeIndices indexBufferOffset:0];
    uniformsForNextDraw();
    [encoder setFragmentTexture:_ribbonAlbedo atIndex:ALBEDO_SLOT];
    [encoder setVertexBuffer:_ribbonVertices offset:0 atIndex:VERTEX_SLOT];
    [encoder drawPrimitives:MTLPrimitiveTypeTriangleStrip vertexStart:0 vertexCount:_ribbon.vertex_count];
    uniformsForNextDraw();
    [encoder setFragmentTexture:_privateAlbedo atIndex:ALBEDO_SLOT];
    [encoder setVertexBuffer:_privateVertices offset:0 atIndex:VERTEX_SLOT];
    [encoder drawIndexedPrimitives:MTLPrimitiveTypeTriangle indexCount:_privateCube.index_count indexType:MTLIndexTypeUInt16
                       indexBuffer:_privateIndices indexBufferOffset:0 instanceCount:1];
    id<MTLTexture> unbound[2] = { nil, nil };
    [encoder setFragmentTextures:unbound withRange:NSMakeRange(ALBEDO_SLOT, 2)];

    [encoder setRenderPipelineState:_splitStreams];
    uniformsForNextDraw();
    [encoder setVertexBuffer:_spherePositions offset:SPHERE_OFFSET atIndex:VERTEX_SLOT];
    [encoder setVertexBuffer:_sphereAttributes offset:0 atIndex:ATTRIBUTE_SLOT];
    [encoder drawIndexedPrimitives:MTLPrimitiveTypeTriangle indexCount:_sphere.index_count indexType:MTLIndexTypeUInt32
                       indexBuffer:_sphereIndices indexBufferOffset:0];

    [encoder setRenderPipelineState:_pulled];
    uniformsForNextDraw();
    [encoder setVertexBuffer:_torusVertices offset:0 atIndex:VERTEX_SLOT];
    [encoder drawIndexedPrimitives:MTLPrimitiveTypeTriangle indexCount:_torus.index_count indexType:MTLIndexTypeUInt16
                       indexBuffer:_torusIndices indexBufferOffset:0 instanceCount:1 baseVertex:0 baseInstance:0];

    [encoder setRenderPipelineState:_paddedPositions];
    uniformsForNextDraw();
    [encoder setVertexBuffer:_octahedronVertices offset:0 atIndex:VERTEX_SLOT];
    [encoder drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:_octahedron.vertex_count instanceCount:1];

    [encoder setRenderPipelineState:_packedPositions];
    uniformsForNextDraw();
    [encoder setVertexBytes:_pyramidPositions length:_pyramid.vertex_count * 12 atIndex:VERTEX_SLOT];
    [encoder drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:_pyramid.vertex_count];

    [encoder setRenderPipelineState:_batched];
    _scratchCursor += (_frame % 7) * UNIFORM_STRIDE;
    NSUInteger sphereIndices = [self scratchBytes:_batchIndices length:_batchedSphere.index_count * 2];
    NSUInteger torusIndices = [self scratchBytes:_batchIndices + _batchedSphere.index_count length:_batchedTorus.index_count * 2];
    uniformsForNextDraw();
    [encoder setVertexBuffer:_batchVertices offset:0 atIndex:VERTEX_SLOT];
    [encoder drawIndexedPrimitives:MTLPrimitiveTypeTriangle indexCount:_batchedSphere.index_count indexType:MTLIndexTypeUInt16
                       indexBuffer:[self scratch] indexBufferOffset:sphereIndices];
    uniformsForNextDraw();
    [encoder drawIndexedPrimitives:MTLPrimitiveTypeTriangle indexCount:_batchedTorus.index_count indexType:MTLIndexTypeUInt16
                       indexBuffer:[self scratch] indexBufferOffset:torusIndices];

    Vertex quad[4];
    for (int corner = 0; corner != 4; corner++) {
        float x = 12 + (corner & 1) + sinf(_frame * 0.05f), y = corner >> 1;
        quad[corner] = (Vertex) { { x, y, 0 }, { 0, 0, 1 }, { corner & 1, corner >> 1 } };
    }
    static const uint16_t quadIndices[6] = { 0, 1, 2, 2, 1, 3 };
    NSUInteger quadVertices = [self scratchBytes:quad length:sizeof(quad)];
    uniformsForNextDraw();
    [encoder setVertexBuffer:[self scratch] offset:quadVertices atIndex:VERTEX_SLOT];
    [encoder drawIndexedPrimitives:MTLPrimitiveTypeTriangle indexCount:6 indexType:MTLIndexTypeUInt16
                       indexBuffer:[self scratch] indexBufferOffset:[self scratchBytes:quadIndices length:sizeof(quadIndices)]];

    [encoder setRenderPipelineState:_halfPositions];
    uniformsForNextDraw();
    [encoder setVertexBuffer:_halfVertices offset:0 atIndex:VERTEX_SLOT];
    [encoder drawIndexedPrimitives:MTLPrimitiveTypeTriangle indexCount:_halfSphere.index_count indexType:MTLIndexTypeUInt16
                       indexBuffer:_halfIndices indexBufferOffset:0];
}

- (id<MTLRenderPipelineState>)pipelineWithFunction:(NSString *)name fragment:(NSString *)fragment layout:(MTLVertexDescriptor *)layout
{
    MTLRenderPipelineDescriptor *descriptor = [MTLRenderPipelineDescriptor new];
    descriptor.vertexFunction = [_library newFunctionWithName:name];
    descriptor.fragmentFunction = [_library newFunctionWithName:fragment];
    descriptor.vertexDescriptor = layout;
    descriptor.colorAttachments[0].pixelFormat = MTLPixelFormatBGRA8Unorm;
    descriptor.depthAttachmentPixelFormat = MTLPixelFormatDepth32Float;
    NSError *error = nil;
    id<MTLRenderPipelineState> state = [_device newRenderPipelineStateWithDescriptor:descriptor error:&error];
    if (state == nil) {
        NSLog(@"%@", error);
        exit(1);
    }
    return state;
}

- (MTLVertexDescriptor *)interleavedLayout
{
    MTLVertexDescriptor *layout = [MTLVertexDescriptor vertexDescriptor];
    layout.attributes[0].format = MTLVertexFormatFloat3;
    layout.attributes[0].bufferIndex = VERTEX_SLOT;
    layout.attributes[1].format = MTLVertexFormatFloat3;
    layout.attributes[1].offset = 12;
    layout.attributes[1].bufferIndex = VERTEX_SLOT;
    layout.attributes[2].format = MTLVertexFormatFloat2;
    layout.attributes[2].offset = 24;
    layout.attributes[2].bufferIndex = VERTEX_SLOT;
    layout.layouts[VERTEX_SLOT].stride = sizeof(Vertex);
    return layout;
}

- (MTLVertexDescriptor *)positionLayoutWithStride:(NSUInteger)stride
{
    MTLVertexDescriptor *layout = [MTLVertexDescriptor vertexDescriptor];
    layout.attributes[0].format = MTLVertexFormatFloat3;
    layout.attributes[0].bufferIndex = VERTEX_SLOT;
    layout.layouts[VERTEX_SLOT].stride = stride;
    return layout;
}

- (id<MTLBuffer>)bufferWithBytes:(const void *)bytes length:(NSUInteger)length label:(NSString *)label
{
    id<MTLBuffer> buffer = [_device newBufferWithBytes:bytes length:length options:MTLResourceStorageModeShared];
    buffer.label = label;
    return buffer;
}

@end

static void request_late_upload(int signal)
{
    late_upload_requested = 1;
}

static uint16_t *batched_indices16(const Mesh *first, const Mesh *second)
{
    uint16_t *narrow = calloc(first->index_count + second->index_count, 2);
    for (uint32_t i = 0; i != first->index_count; i++) {
        narrow[i] = (uint16_t) first->indices[i];
    }
    for (uint32_t i = 0; i != second->index_count; i++) {
        narrow[first->index_count + i] = (uint16_t) (first->vertex_count + second->indices[i]);
    }
    return narrow;
}

static uint16_t *half_positions(const Mesh *mesh)
{
    uint16_t *packed = calloc(mesh->vertex_count, 8);
    for (uint32_t i = 0; i != mesh->vertex_count; i++) {
        for (int k = 0; k != 3; k++) {
            packed[i * 4 + k] = half_of(mesh->vertices[i].position[k]);
        }
    }
    return packed;
}

static uint16_t half_of(float value)
{
    uint32_t bits;
    memcpy(&bits, &value, 4);
    uint32_t sign = (bits >> 16) & 0x8000;
    int32_t exponent = (int32_t) ((bits >> 23) & 0xff) - 127 + 15;
    if (exponent <= 0) {
        return (uint16_t) sign;
    }
    return (uint16_t) (sign | (uint32_t) exponent << 10 | ((bits >> 13) & 0x3ff));
}

static void expect_absent(const Mesh *mesh, const char *how, uint32_t triangle_count)
{
    record_expectation(mesh, how, triangle_count, CONTENTS_CPU_VISIBLE, PRESENCE_ABSENT);
}

static void expect_texture(const Mesh *mesh, uint32_t width, uint32_t height, const char *format, const uint8_t corners[4][4])
{
    uint32_t first = 0;
    if (mesh->index_count != 0) {
        first = UINT32_MAX;
        for (uint32_t i = 0; i != mesh->index_count; i++) {
            first = (mesh->indices[i] < first) ? mesh->indices[i] : first;
        }
    }
    const float *a = mesh->vertices[first].uv, *b = mesh->vertices[first + 1].uv, *c = mesh->vertices[first + 2].uv;
    size_t closing = strlen(mesh_finder_expectations) - 1;
    snprintf(mesh_finder_expectations + closing, sizeof(mesh_finder_expectations) - closing,
        ",\"texture\":{\"width\":%u,\"height\":%u,\"format\":\"%s\",\"corners\":[[%u,%u,%u,%u],[%u,%u,%u,%u],[%u,%u,%u,%u],[%u,%u,%u,%u]]},"
        "\"texcoords\":[[%g,%g],[%g,%g],[%g,%g]]}",
        width, height, format,
        corners[0][0], corners[0][1], corners[0][2], corners[0][3], corners[1][0], corners[1][1], corners[1][2], corners[1][3],
        corners[2][0], corners[2][1], corners[2][2], corners[2][3], corners[3][0], corners[3][1], corners[3][2], corners[3][3],
        a[0], a[1], b[0], b[1], c[0], c[1]);
}

static double elapsedMilliseconds(uint64_t start)
{
    static mach_timebase_info_data_t timebase;
    if (timebase.denom == 0) {
        mach_timebase_info(&timebase);
    }
    return (mach_absolute_time() - start) * timebase.numer / (double) timebase.denom / 1e6;
}
