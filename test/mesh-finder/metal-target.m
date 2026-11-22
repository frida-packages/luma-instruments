#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#import <mach/mach_time.h>
#import <signal.h>
#import "meshes.h"

static NSString *const shaderSource = @
    "#include <metal_stdlib>\n"
    "using namespace metal;\n"
    "struct Uniforms { float4x4 mvp; };\n"
    "struct Out { float4 position [[position]]; float3 color; };\n"
    "struct Described { float3 position [[attribute(0)]]; float3 normal [[attribute(1)]]; };\n"
    "struct PositionOnly { float3 position [[attribute(0)]]; };\n"
    "struct Pulled { packed_float3 position; packed_float3 normal; };\n"
    "vertex Out described_vertex(Described in [[stage_in]], constant Uniforms &u [[buffer(7)]]) {\n"
    "    return { u.mvp * float4(in.position, 1), in.normal * 0.5 + 0.5 };\n"
    "}\n"
    "vertex Out position_vertex(PositionOnly in [[stage_in]], constant Uniforms &u [[buffer(7)]]) {\n"
    "    return { u.mvp * float4(in.position, 1), float3(1) };\n"
    "}\n"
    "vertex Out pulled_vertex(uint vid [[vertex_id]], const device Pulled *vertices [[buffer(0)]], constant Uniforms &u [[buffer(7)]]) {\n"
    "    Pulled v = vertices[vid];\n"
    "    return { u.mvp * float4(float3(v.position), 1), float3(v.normal) * 0.5 + 0.5 };\n"
    "}\n"
    "fragment float4 shade(Out in [[stage_in]]) { return float4(in.color, 1); }\n";

static volatile sig_atomic_t late_upload_requested;

enum { UNIFORM_SLOT = 7, UNIFORM_STRIDE = 256, DRAWS_PER_FRAME = 8, FRAMES_IN_FLIGHT = 3, SPHERE_OFFSET = 256 };

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
@property (nonatomic, strong) id<MTLBuffer> uniforms;
@property (nonatomic, strong) id<MTLBuffer> cubeVertices, cubeIndices;
@property (nonatomic, strong) id<MTLBuffer> spherePositions, sphereAttributes, sphereIndices;
@property (nonatomic, strong) id<MTLBuffer> torusVertices, torusIndices;
@property (nonatomic, strong) id<MTLBuffer> ribbonVertices;
@property (nonatomic, strong) id<MTLBuffer> octahedronVertices;
@property (nonatomic, strong) id<MTLBuffer> privateVertices, privateIndices;
@property (nonatomic, strong) id<MTLBuffer> hiddenVertices, hiddenIndices;
@property (nonatomic, strong) id<MTLBuffer> lateVertices, lateIndices;
- (instancetype)initWithRepeats:(int)repeats;
- (double)renderFrame;
@end

static void request_late_upload(int signal);
static double elapsedMilliseconds(uint64_t start);

int main(int argc, char **argv)
{
    @autoreleasepool {
        int repeats = (argc > 1) ? atoi(argv[1]) : 1;
        Scene *scene = [[Scene alloc] initWithRepeats:repeats];
        signal(SIGUSR1, request_late_upload);
        printf("pid %d ready, %d draws per frame\n", getpid(), repeats * 7);
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
    void *_pyramidPositions;
    uint64_t _frame;
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
    return self;
}

- (double)renderFrame
{
    if (late_upload_requested) {
        late_upload_requested = 0;
        [self uploadLateMesh];
    }
    if (_frame % 120 == 119) {
        _interleaved = [self pipelineWithFunction:@"described_vertex" layout:[self interleavedLayout]];
    }
    NSUInteger ring = (_frame % FRAMES_IN_FLIGHT) * UNIFORM_STRIDE * DRAWS_PER_FRAME;
    float angle = _frame * 0.01f;
    for (int i = 0; i != DRAWS_PER_FRAME; i++) {
        float *mvp = (float *) ((uint8_t *) _uniforms.contents + ring + i * UNIFORM_STRIDE);
        memset(mvp, 0, 64);
        mvp[0] = cosf(angle) * 0.1f; mvp[2] = sinf(angle) * 0.1f;
        mvp[5] = 0.1f;
        mvp[8] = -sinf(angle) * 0.05f; mvp[10] = cosf(angle) * 0.05f; mvp[14] = 0.5f;
        mvp[15] = 1;
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
    __block int draw = 0;
    void (^uniformsForNextDraw)(void) = ^{
        [encoder setVertexBuffer:self->_uniforms offset:ring + (draw++ % DRAWS_PER_FRAME) * UNIFORM_STRIDE atIndex:UNIFORM_SLOT];
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

- (void)buildPipelines
{
    _interleaved = [self pipelineWithFunction:@"described_vertex" layout:[self interleavedLayout]];
    MTLVertexDescriptor *split = [MTLVertexDescriptor vertexDescriptor];
    split.attributes[0].format = MTLVertexFormatFloat3;
    split.attributes[0].bufferIndex = 0;
    split.attributes[1].format = MTLVertexFormatFloat3;
    split.attributes[1].offset = 12;
    split.attributes[1].bufferIndex = 1;
    split.layouts[0].stride = 12;
    split.layouts[1].stride = sizeof(Vertex);
    _splitStreams = [self pipelineWithFunction:@"described_vertex" layout:split];
    _pulled = [self pipelineWithFunction:@"pulled_vertex" layout:nil];
    _paddedPositions = [self pipelineWithFunction:@"position_vertex" layout:[self positionLayoutWithStride:16]];
    _packedPositions = [self pipelineWithFunction:@"position_vertex" layout:[self positionLayoutWithStride:12]];
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

    _uniforms = [_device newBufferWithLength:UNIFORM_STRIDE * DRAWS_PER_FRAME * FRAMES_IN_FLIGHT options:MTLResourceStorageModeShared];

    free(cubeIndices);
    free(spherePositions);
    free(torusVertices);
    free(torusIndices);
    free(octahedron);
    free(privateIndices);
    free(hiddenIndices);

    expect(&_cube, "interleaved position, normal and uv; 16-bit indices; vertex descriptor", 12, 1);
    expect(&_sphere, "positions alone in their own buffer at an offset; 32-bit indices; vertex descriptor", _sphere.index_count / 3, 1);
    expect(&_torus, "vertex pulling with no vertex descriptor; 16-bit indices", _torus.index_count / 3, 1);
    expect(&_ribbon, "triangle strip, not indexed", _ribbon.vertex_count - 2, 1);
    expect(&_octahedron, "triangle list, not indexed, 16-byte stride", 8, 1);
    expect(&_pyramid, "setVertexBytes, not indexed", 6, 1);
    expect(&_privateCube, "private storage", 12, 0);
    expect(&_hidden, "uploaded, never drawn", _hidden.index_count / 3, 1);
    expect(&_late, "uploaded after attach, never drawn, found by a second scan", _late.index_count / 3, 1);
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
    [encoder setVertexBuffer:_cubeVertices offset:0 atIndex:0];
    [encoder drawIndexedPrimitives:MTLPrimitiveTypeTriangle indexCount:_cube.index_count indexType:MTLIndexTypeUInt16
                       indexBuffer:_cubeIndices indexBufferOffset:0];
    uniformsForNextDraw();
    [encoder setVertexBuffer:_ribbonVertices offset:0 atIndex:0];
    [encoder drawPrimitives:MTLPrimitiveTypeTriangleStrip vertexStart:0 vertexCount:_ribbon.vertex_count];
    uniformsForNextDraw();
    [encoder setVertexBuffer:_privateVertices offset:0 atIndex:0];
    [encoder drawIndexedPrimitives:MTLPrimitiveTypeTriangle indexCount:_privateCube.index_count indexType:MTLIndexTypeUInt16
                       indexBuffer:_privateIndices indexBufferOffset:0 instanceCount:1];

    [encoder setRenderPipelineState:_splitStreams];
    uniformsForNextDraw();
    [encoder setVertexBuffer:_spherePositions offset:SPHERE_OFFSET atIndex:0];
    [encoder setVertexBuffer:_sphereAttributes offset:0 atIndex:1];
    [encoder drawIndexedPrimitives:MTLPrimitiveTypeTriangle indexCount:_sphere.index_count indexType:MTLIndexTypeUInt32
                       indexBuffer:_sphereIndices indexBufferOffset:0];

    [encoder setRenderPipelineState:_pulled];
    uniformsForNextDraw();
    [encoder setVertexBuffer:_torusVertices offset:0 atIndex:0];
    [encoder drawIndexedPrimitives:MTLPrimitiveTypeTriangle indexCount:_torus.index_count indexType:MTLIndexTypeUInt16
                       indexBuffer:_torusIndices indexBufferOffset:0 instanceCount:1 baseVertex:0 baseInstance:0];

    [encoder setRenderPipelineState:_paddedPositions];
    uniformsForNextDraw();
    [encoder setVertexBuffer:_octahedronVertices offset:0 atIndex:0];
    [encoder drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:_octahedron.vertex_count instanceCount:1];

    [encoder setRenderPipelineState:_packedPositions];
    uniformsForNextDraw();
    [encoder setVertexBytes:_pyramidPositions length:_pyramid.vertex_count * 12 atIndex:0];
    [encoder drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:_pyramid.vertex_count];
}

- (id<MTLRenderPipelineState>)pipelineWithFunction:(NSString *)name layout:(MTLVertexDescriptor *)layout
{
    MTLRenderPipelineDescriptor *descriptor = [MTLRenderPipelineDescriptor new];
    descriptor.vertexFunction = [_library newFunctionWithName:name];
    descriptor.fragmentFunction = [_library newFunctionWithName:@"shade"];
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
    layout.attributes[0].bufferIndex = 0;
    layout.attributes[1].format = MTLVertexFormatFloat3;
    layout.attributes[1].offset = 12;
    layout.attributes[1].bufferIndex = 0;
    layout.layouts[0].stride = sizeof(Vertex);
    return layout;
}

- (MTLVertexDescriptor *)positionLayoutWithStride:(NSUInteger)stride
{
    MTLVertexDescriptor *layout = [MTLVertexDescriptor vertexDescriptor];
    layout.attributes[0].format = MTLVertexFormatFloat3;
    layout.attributes[0].bufferIndex = 0;
    layout.layouts[0].stride = stride;
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

static double elapsedMilliseconds(uint64_t start)
{
    static mach_timebase_info_data_t timebase;
    if (timebase.denom == 0) {
        mach_timebase_info(&timebase);
    }
    return (mach_absolute_time() - start) * timebase.numer / (double) timebase.denom / 1e6;
}
