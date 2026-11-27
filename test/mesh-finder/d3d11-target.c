#define COBJMACROS
#include <windows.h>
#include <d3d11.h>
#include <d3dcompiler.h>
#include "meshes.h"

enum {
    SPHERE_OFFSET = 256,
    SPHERE_INDEX_OFFSET = 64,
    TORUS_BASE_VERTEX = 7,
    LAYOUT_LIFETIME = 60,
    STATS_FRAMES = 120,
    FRAMES_AFTER_FINISH = 2 * STATS_FRAMES,
    TARGET_SIZE = 256,
    ALBEDO_WIDTH = 8,
    ALBEDO_HEIGHT = 4,
    NORMALS_SIZE = 4,
    BC1_WIDTH = 16,
    BC1_HEIGHT = 8,
};

static const uint8_t albedo_fill[4] = { 128, 128, 128, 255 };
static const TextureExpectation albedo_expectation = { ALBEDO_WIDTH, ALBEDO_HEIGHT, "rgba8unorm",
    { { 255, 0, 0, 255 }, { 0, 255, 0, 255 }, { 0, 0, 255, 255 }, { 255, 255, 0, 255 } } };
static const uint8_t normals_fill[4] = { 128, 128, 255, 255 };
static const uint16_t bc1_fill = 0x8410;
static const uint16_t bc1_corners[4] = { 0xf800, 0x07e0, 0x001f, 0xffff };
static const TextureExpectation bc1_expectation = { BC1_WIDTH, BC1_HEIGHT, "bc1",
    { { 255, 0, 0, 255 }, { 0, 255, 0, 255 }, { 0, 0, 255, 255 }, { 255, 255, 255, 255 } } };
static const GUID debug_object_name = { 0x429b8c22, 0x9188, 0x4b0c, { 0x87, 0x42, 0xac, 0xb0, 0xbf, 0x85, 0xc2, 0x00 } };

static const char shader_source[] =
    "cbuffer Uniforms : register(b0) { float4x4 mvp; };\n"
    "struct Out { float4 position : SV_Position; float3 color : COLOR; };\n"
    "Out described_vertex(float3 position : POSITION, float3 normal : NORMAL) {\n"
    "    Out o; o.position = mul(mvp, float4(position, 1)); o.color = normal * 0.5 + 0.5; return o;\n"
    "}\n"
    "Out position_vertex(float4 position : POSITION) {\n"
    "    Out o; o.position = mul(mvp, float4(position.xyz, 1)); o.color = 1; return o;\n"
    "}\n"
    "float4 shade(Out i) : SV_Target { return float4(i.color, 1); }\n"
    "Texture2D albedo : register(t0);\n"
    "Texture2D normalMap : register(t1);\n"
    "SamplerState nearest : register(s0);\n"
    "struct Textured { float4 position : SV_Position; float3 color : COLOR; float2 uv : TEXCOORD; };\n"
    "Textured textured_vertex(float3 position : POSITION, float3 normal : NORMAL, float2 uv : TEXCOORD) {\n"
    "    Textured o; o.position = mul(mvp, float4(position, 1)); o.color = normal * 0.5 + 0.5; o.uv = uv; return o;\n"
    "}\n"
    "float4 shade_textured(Textured i) : SV_Target {\n"
    "    float3 normal = normalMap.Sample(nearest, i.uv).xyz * 2 - 1;\n"
    "    return albedo.Sample(nearest, i.uv) * float4(i.color * saturate(normal.z), 1);\n"
    "}\n";

volatile LONG mesh_finder_late_upload_requested;
volatile LONG mesh_finder_finish_requested;
volatile LONG mesh_finder_failures;
volatile LONG mesh_finder_phase;

static const char *phase_names[] = { "before attach", "attached", "disposed" };

typedef struct {
    ID3D11Device *device;
    ID3D11DeviceContext *immediate;
    ID3D11DeviceContext *deferred;
    ID3D11RenderTargetView *target;
    ID3D11DepthStencilView *depth;
    ID3D11VertexShader *described_vertex, *position_vertex, *textured_vertex;
    ID3D11PixelShader *shade, *shade_textured;
    ID3DBlob *described_code, *position_code, *textured_code, *shade_textured_code;
    ID3D11SamplerState *nearest;
    ID3D11ShaderResourceView *cube_albedo, *cube_normals, *sphere_albedo;
    ID3D11InputLayout *interleaved, *split, *pulled, *positions4, *cube_layout, *half4;
    ID3D11Buffer *uniforms;
    ID3D11Buffer *cube_vertices, *cube_indices;
    ID3D11Buffer *sphere_positions, *sphere_attributes, *sphere_indices;
    ID3D11Buffer *torus_vertices, *torus_indices, *torus_arguments;
    ID3D11Buffer *ribbon_vertices;
    ID3D11Buffer *octahedron_vertices;
    ID3D11Buffer *pyramid_vertices;
    ID3D11Buffer *hidden_vertices, *hidden_indices;
    ID3D11Buffer *late_vertices, *late_indices;
    Mesh cube, sphere, torus, ribbon, octahedron, pyramid, hidden, released, late;
    int repeats;
    uint64_t frame;
} Scene;

static const D3D11_INPUT_ELEMENT_DESC interleaved_elements[] = {
    { "POSITION", 0, DXGI_FORMAT_R32G32B32_FLOAT, 0, 0, D3D11_INPUT_PER_VERTEX_DATA, 0 },
    { "NORMAL", 0, DXGI_FORMAT_R32G32B32_FLOAT, 0, D3D11_APPEND_ALIGNED_ELEMENT, D3D11_INPUT_PER_VERTEX_DATA, 0 },
};
static const D3D11_INPUT_ELEMENT_DESC textured_elements[] = {
    { "POSITION", 0, DXGI_FORMAT_R32G32B32_FLOAT, 0, 0, D3D11_INPUT_PER_VERTEX_DATA, 0 },
    { "NORMAL", 0, DXGI_FORMAT_R32G32B32_FLOAT, 0, D3D11_APPEND_ALIGNED_ELEMENT, D3D11_INPUT_PER_VERTEX_DATA, 0 },
    { "TEXCOORD", 0, DXGI_FORMAT_R32G32_FLOAT, 0, D3D11_APPEND_ALIGNED_ELEMENT, D3D11_INPUT_PER_VERTEX_DATA, 0 },
};
static const D3D11_INPUT_ELEMENT_DESC split_elements[] = {
    { "POSITION", 0, DXGI_FORMAT_R32G32B32_FLOAT, 0, 0, D3D11_INPUT_PER_VERTEX_DATA, 0 },
    { "NORMAL", 0, DXGI_FORMAT_R32G32B32_FLOAT, 1, 0, D3D11_INPUT_PER_VERTEX_DATA, 0 },
    { "TEXCOORD", 0, DXGI_FORMAT_R32G32_FLOAT, 1, 12, D3D11_INPUT_PER_VERTEX_DATA, 0 },
};
static const D3D11_INPUT_ELEMENT_DESC positions4_elements[] = {
    { "POSITION", 0, DXGI_FORMAT_R32G32B32A32_FLOAT, 0, 0, D3D11_INPUT_PER_VERTEX_DATA, 0 },
};
static const D3D11_INPUT_ELEMENT_DESC half4_elements[] = {
    { "POSITION", 0, DXGI_FORMAT_R16G16B16A16_FLOAT, 0, 0, D3D11_INPUT_PER_VERTEX_DATA, 0 },
};

static void create_device(Scene *scene, const char *driver);
static void build_pipelines(Scene *scene);
static void upload_meshes(Scene *scene);
static void make_textures(Scene *scene);
static void render_frame(Scene *scene);
static double milliseconds_since(LARGE_INTEGER start);
static ID3DBlob *compile(const char *entry, const char *profile);
static ID3D11Buffer *mapped_buffer(Scene *scene, UINT bind, const void *data, UINT length);
static uint16_t *half_positions(const Mesh *mesh);
static void expect_absent(const Mesh *mesh, const char *how, uint32_t triangle_count);
static uint8_t *rgba_texels(uint32_t width, uint32_t height, const uint8_t fill[4], const uint8_t (*corners)[4]);
static ID3D11ShaderResourceView *texture_view(Scene *scene, DXGI_FORMAT format, UINT width, UINT height, const void *texels, UINT pitch,
    const char *name);
static uint16_t *bc1_blocks(uint32_t width, uint32_t height, uint16_t fill, const uint16_t corners[4]);
static void upload_late(Scene *scene);
static void rebuild_pixel_shader(Scene *scene);
static void rebuild_layouts(Scene *scene);
static void update_uniforms(Scene *scene);
static void draw_scene(Scene *scene);
static void record_deferred(Scene *scene);
static ID3D11InputLayout *layout_with(Scene *scene, const D3D11_INPUT_ELEMENT_DESC *elements, UINT count, ID3DBlob *code);
static ID3D11Buffer *immutable_buffer(Scene *scene, UINT bind, const void *data, UINT length);
static ID3D11Buffer *updated_buffer(Scene *scene, UINT bind, const void *data, UINT length);
static uint16_t half_of(float value);
static void prepare(Scene *scene, ID3D11DeviceContext *context);
static void bind_vertices(ID3D11DeviceContext *context, UINT slot, ID3D11Buffer *buffer, UINT stride, UINT offset);
static ID3D11Buffer *buffer_with(Scene *scene, D3D11_USAGE usage, UINT bind, UINT cpu_access, UINT misc, const void *data, UINT length);
static void check(HRESULT result, const char *what);

int main(int argc, char **argv)
{
    Scene scene = { 0 };
    const char *driver = (argc > 1) ? argv[1] : "warp";
    scene.repeats = (argc > 2) ? atoi(argv[2]) : 1;
    setvbuf(stdout, NULL, _IONBF, 0);
    create_device(&scene, driver);
    build_pipelines(&scene);
    upload_meshes(&scene);
    make_textures(&scene);
    render_frame(&scene);
    fclose(fopen("ready.txt", "w"));
    printf("pid %lu ready, %d draws per frame\n", GetCurrentProcessId(), scene.repeats * 6);

    double total = 0, worst = 0;
    int frames = 0, frames_left = -1;
    while (frames_left != 0) {
        LARGE_INTEGER start;
        QueryPerformanceCounter(&start);
        render_frame(&scene);
        double elapsed = milliseconds_since(start);
        total += elapsed;
        worst = fmax(worst, elapsed);
        if (++frames == STATS_FRAMES) {
            printf("%s: submitting a frame took %.3f ms on average, %.3f ms at worst\n", phase_names[mesh_finder_phase], total / frames,
                worst);
            total = worst = 0;
            frames = 0;
        }
        if (frames_left > 0) {
            frames_left--;
        } else if (mesh_finder_finish_requested) {
            frames_left = FRAMES_AFTER_FINISH;
        }
        Sleep(16);
    }
    printf("drew %d more frames after the instrument was disposed; exiting with %ld failures\n", FRAMES_AFTER_FINISH,
        mesh_finder_failures);
    return mesh_finder_failures;
}

static void create_device(Scene *scene, const char *driver)
{
    D3D_DRIVER_TYPE type = (strcmp(driver, "hardware") == 0) ? D3D_DRIVER_TYPE_HARDWARE : D3D_DRIVER_TYPE_WARP;
    D3D_FEATURE_LEVEL level;
    check(D3D11CreateDevice(NULL, type, NULL, 0, NULL, 0, D3D11_SDK_VERSION, &scene->device, &level, &scene->immediate),
        "D3D11CreateDevice");
    check(ID3D11Device_CreateDeferredContext(scene->device, 0, &scene->deferred), "CreateDeferredContext");

    IDXGIDevice *dxgi;
    IDXGIAdapter *adapter;
    DXGI_ADAPTER_DESC adapter_description;
    check(ID3D11Device_QueryInterface(scene->device, &IID_IDXGIDevice, (void **) &dxgi), "IDXGIDevice");
    check(IDXGIDevice_GetAdapter(dxgi, &adapter), "GetAdapter");
    IDXGIAdapter_GetDesc(adapter, &adapter_description);
    printf("%s device on %ls, feature level %x\n", driver, adapter_description.Description, level);
    IDXGIAdapter_Release(adapter);
    IDXGIDevice_Release(dxgi);

    D3D11_TEXTURE2D_DESC color = { TARGET_SIZE, TARGET_SIZE, 1, 1, DXGI_FORMAT_R8G8B8A8_UNORM, { 1, 0 }, D3D11_USAGE_DEFAULT,
        D3D11_BIND_RENDER_TARGET, 0, 0 };
    ID3D11Texture2D *texture;
    check(ID3D11Device_CreateTexture2D(scene->device, &color, NULL, &texture), "CreateTexture2D");
    check(ID3D11Device_CreateRenderTargetView(scene->device, (ID3D11Resource *) texture, NULL, &scene->target), "RenderTargetView");
    ID3D11Texture2D_Release(texture);
    D3D11_TEXTURE2D_DESC depth = color;
    depth.Format = DXGI_FORMAT_D24_UNORM_S8_UINT;
    depth.BindFlags = D3D11_BIND_DEPTH_STENCIL;
    check(ID3D11Device_CreateTexture2D(scene->device, &depth, NULL, &texture), "CreateTexture2D");
    check(ID3D11Device_CreateDepthStencilView(scene->device, (ID3D11Resource *) texture, NULL, &scene->depth), "DepthStencilView");
    ID3D11Texture2D_Release(texture);
}

static void build_pipelines(Scene *scene)
{
    scene->described_code = compile("described_vertex", "vs_4_0");
    scene->position_code = compile("position_vertex", "vs_4_0");
    scene->textured_code = compile("textured_vertex", "vs_4_0");
    scene->shade_textured_code = compile("shade_textured", "ps_4_0");
    ID3DBlob *shade = compile("shade", "ps_4_0");
    check(ID3D11Device_CreateVertexShader(scene->device, ID3D10Blob_GetBufferPointer(scene->described_code),
        ID3D10Blob_GetBufferSize(scene->described_code), NULL, &scene->described_vertex), "CreateVertexShader");
    check(ID3D11Device_CreateVertexShader(scene->device, ID3D10Blob_GetBufferPointer(scene->position_code),
        ID3D10Blob_GetBufferSize(scene->position_code), NULL, &scene->position_vertex), "CreateVertexShader");
    check(ID3D11Device_CreateVertexShader(scene->device, ID3D10Blob_GetBufferPointer(scene->textured_code),
        ID3D10Blob_GetBufferSize(scene->textured_code), NULL, &scene->textured_vertex), "CreateVertexShader");
    check(ID3D11Device_CreatePixelShader(scene->device, ID3D10Blob_GetBufferPointer(shade), ID3D10Blob_GetBufferSize(shade), NULL,
        &scene->shade), "CreatePixelShader");
    ID3D10Blob_Release(shade);
    check(ID3D11Device_CreatePixelShader(scene->device, ID3D10Blob_GetBufferPointer(scene->shade_textured_code),
        ID3D10Blob_GetBufferSize(scene->shade_textured_code), NULL, &scene->shade_textured), "CreatePixelShader");
    D3D11_SAMPLER_DESC nearest = { D3D11_FILTER_MIN_MAG_MIP_POINT, D3D11_TEXTURE_ADDRESS_WRAP, D3D11_TEXTURE_ADDRESS_WRAP,
        D3D11_TEXTURE_ADDRESS_WRAP, 0, 1, D3D11_COMPARISON_NEVER, { 0, 0, 0, 0 }, 0, D3D11_FLOAT32_MAX };
    check(ID3D11Device_CreateSamplerState(scene->device, &nearest, &scene->nearest), "CreateSamplerState");

    scene->interleaved = layout_with(scene, interleaved_elements, 2, scene->described_code);
    scene->cube_layout = layout_with(scene, textured_elements, 3, scene->textured_code);
    scene->split = layout_with(scene, split_elements, 3, scene->textured_code);
    scene->pulled = layout_with(scene, interleaved_elements, 2, scene->described_code);
    scene->positions4 = layout_with(scene, positions4_elements, 1, scene->position_code);
    scene->half4 = layout_with(scene, half4_elements, 1, scene->position_code);
    scene->uniforms = buffer_with(scene, D3D11_USAGE_DYNAMIC, D3D11_BIND_CONSTANT_BUFFER, D3D11_CPU_ACCESS_WRITE, 0, NULL, 64);
}

static void upload_meshes(Scene *scene)
{
    scene->cube = make_cube("cube", 0, 0, 0);
    scene->sphere = make_sphere("sphere", 4, 0, 0, 1.5f, 16, 32);
    scene->torus = make_torus("torus", 0, 4, 0, 1.2f, 0.4f, 48, 16);
    scene->ribbon = make_ribbon("ribbon", 0, 0, 4, 20);
    scene->octahedron = make_octahedron("octahedron", 0, -4, 0);
    scene->pyramid = make_pyramid("pyramid", -4, 4, 0);
    scene->hidden = make_torus("hidden-torus", -4, 0, 0, 2.0f, 0.5f, 32, 12);
    scene->released = make_sphere("released-sphere", 8, 8, 8, 3.0f, 12, 24);
    scene->late = make_sphere("late-sphere", 0, 0, -4, 0.75f, 8, 12);

    scene->cube_vertices = immutable_buffer(scene, D3D11_BIND_VERTEX_BUFFER, scene->cube.vertices,
        scene->cube.vertex_count * sizeof(Vertex));
    uint16_t *cube_indices = indices16(&scene->cube);
    scene->cube_indices = immutable_buffer(scene, D3D11_BIND_INDEX_BUFFER, cube_indices, scene->cube.index_count * 2);

    uint8_t *padded_positions = calloc(1, SPHERE_OFFSET + scene->sphere.vertex_count * 12);
    void *sphere_positions = positions_with_stride(&scene->sphere, 12);
    memcpy(padded_positions + SPHERE_OFFSET, sphere_positions, scene->sphere.vertex_count * 12);
    scene->sphere_positions = updated_buffer(scene, D3D11_BIND_VERTEX_BUFFER, padded_positions,
        SPHERE_OFFSET + scene->sphere.vertex_count * 12);
    scene->sphere_attributes = updated_buffer(scene, D3D11_BIND_VERTEX_BUFFER, scene->sphere.vertices,
        scene->sphere.vertex_count * sizeof(Vertex));
    uint8_t *padded_indices = calloc(1, SPHERE_INDEX_OFFSET + scene->sphere.index_count * 4);
    memcpy(padded_indices + SPHERE_INDEX_OFFSET, scene->sphere.indices, scene->sphere.index_count * 4);
    scene->sphere_indices = updated_buffer(scene, D3D11_BIND_INDEX_BUFFER, padded_indices,
        SPHERE_INDEX_OFFSET + scene->sphere.index_count * 4);

    uint32_t torus_length = (TORUS_BASE_VERTEX + scene->torus.vertex_count) * 24;
    float *torus_vertices = calloc(1, torus_length);
    void *pulled = pulled_vertices(&scene->torus);
    memcpy(torus_vertices + TORUS_BASE_VERTEX * 6, pulled, scene->torus.vertex_count * 24);
    scene->torus_vertices = mapped_buffer(scene, D3D11_BIND_VERTEX_BUFFER, torus_vertices, torus_length);
    scene->torus_indices = immutable_buffer(scene, D3D11_BIND_INDEX_BUFFER, scene->torus.indices, scene->torus.index_count * 4);
    UINT torus_arguments[5] = { scene->torus.index_count, 1, 0, TORUS_BASE_VERTEX, 0 };
    scene->torus_arguments = buffer_with(scene, D3D11_USAGE_DEFAULT, 0, 0, D3D11_RESOURCE_MISC_DRAWINDIRECT_ARGS, torus_arguments,
        sizeof(torus_arguments));

    scene->ribbon_vertices = immutable_buffer(scene, D3D11_BIND_VERTEX_BUFFER, scene->ribbon.vertices,
        scene->ribbon.vertex_count * sizeof(Vertex));
    void *octahedron = positions_with_stride(&scene->octahedron, 16);
    scene->octahedron_vertices = immutable_buffer(scene, D3D11_BIND_VERTEX_BUFFER, octahedron, scene->octahedron.vertex_count * 16);
    uint16_t *pyramid = half_positions(&scene->pyramid);
    scene->pyramid_vertices = immutable_buffer(scene, D3D11_BIND_VERTEX_BUFFER, pyramid, scene->pyramid.vertex_count * 8);

    scene->hidden_vertices = immutable_buffer(scene, D3D11_BIND_VERTEX_BUFFER, scene->hidden.vertices,
        scene->hidden.vertex_count * sizeof(Vertex));
    uint16_t *hidden_indices = indices16(&scene->hidden);
    scene->hidden_indices = immutable_buffer(scene, D3D11_BIND_INDEX_BUFFER, hidden_indices, scene->hidden.index_count * 2);

    ID3D11Buffer *released_vertices = immutable_buffer(scene, D3D11_BIND_VERTEX_BUFFER, scene->released.vertices,
        scene->released.vertex_count * sizeof(Vertex));
    ID3D11Buffer *released_indices = immutable_buffer(scene, D3D11_BIND_INDEX_BUFFER, scene->released.indices,
        scene->released.index_count * 4);
    ID3D11Buffer_Release(released_vertices);
    ID3D11Buffer_Release(released_indices);

    free(cube_indices);
    free(padded_positions);
    free(sphere_positions);
    free(padded_indices);
    free(torus_vertices);
    free(pulled);
    free(octahedron);
    free(pyramid);
    free(hidden_indices);

    expect(&scene->cube, "immutable, interleaved position, normal and uv; 16-bit indices; DrawIndexed; "
        "an RGBA8 albedo and a normal map", 12, CONTENTS_CPU_VISIBLE);
    expect_texture(&scene->cube, &albedo_expectation);
    expect(&scene->sphere, "UpdateSubresource; positions alone at an offset, normals and uvs in a second stream; "
        "32-bit indices at an offset; a BC1 albedo", scene->sphere.index_count / 3, CONTENTS_CPU_VISIBLE);
    expect_texture(&scene->sphere, &bc1_expectation);
    expect(&scene->torus, "dynamic, filled with Map; base vertex; DrawIndexedInstancedIndirect", scene->torus.index_count / 3,
        CONTENTS_CPU_VISIBLE);
    expect(&scene->ribbon, "triangle strip, Draw", scene->ribbon.vertex_count - 2, CONTENTS_CPU_VISIBLE);
    expect(&scene->octahedron, "four-component positions, drawn on a deferred context", 8, CONTENTS_CPU_VISIBLE);
    expect(&scene->pyramid, "half-float positions, DrawInstanced", 6, CONTENTS_CPU_VISIBLE);
    expect(&scene->hidden, "uploaded before attach, never drawn", scene->hidden.index_count / 3, CONTENTS_CPU_VISIBLE);
    expect(&scene->late, "uploaded after attach, never drawn", scene->late.index_count / 3, CONTENTS_CPU_VISIBLE);
    expect_absent(&scene->released, "released before attach", scene->released.index_count / 3);
}

static void make_textures(Scene *scene)
{
    uint8_t *albedo = rgba_texels(ALBEDO_WIDTH, ALBEDO_HEIGHT, albedo_fill, albedo_expectation.corners);
    scene->cube_albedo = texture_view(scene, DXGI_FORMAT_R8G8B8A8_UNORM, ALBEDO_WIDTH, ALBEDO_HEIGHT, albedo, ALBEDO_WIDTH * 4,
        "cube albedo");
    uint8_t *normals = rgba_texels(NORMALS_SIZE, NORMALS_SIZE, normals_fill, NULL);
    scene->cube_normals = texture_view(scene, DXGI_FORMAT_R8G8B8A8_UNORM, NORMALS_SIZE, NORMALS_SIZE, normals, NORMALS_SIZE * 4,
        "cube normals");
    uint16_t *blocks = bc1_blocks(BC1_WIDTH, BC1_HEIGHT, bc1_fill, bc1_corners);
    scene->sphere_albedo = texture_view(scene, DXGI_FORMAT_BC1_UNORM, BC1_WIDTH, BC1_HEIGHT, blocks, BC1_WIDTH / 4 * 8,
        "sphere albedo");
    free(albedo);
    free(normals);
    free(blocks);
}

static void render_frame(Scene *scene)
{
    static const float black[4] = { 0, 0, 0, 1 };
    if (mesh_finder_late_upload_requested) {
        mesh_finder_late_upload_requested = 0;
        upload_late(scene);
    }
    if (scene->frame % LAYOUT_LIFETIME == LAYOUT_LIFETIME - 1) {
        rebuild_pixel_shader(scene);
        rebuild_layouts(scene);
    }
    update_uniforms(scene);
    prepare(scene, scene->immediate);
    ID3D11DeviceContext_ClearRenderTargetView(scene->immediate, scene->target, black);
    ID3D11DeviceContext_ClearDepthStencilView(scene->immediate, scene->depth, D3D11_CLEAR_DEPTH, 1, 0);
    for (int repeat = 0; repeat != scene->repeats; repeat++) {
        draw_scene(scene);
    }
    record_deferred(scene);
    ID3D11DeviceContext_Flush(scene->immediate);
    scene->frame++;
}

static double milliseconds_since(LARGE_INTEGER start)
{
    LARGE_INTEGER now, frequency;
    QueryPerformanceCounter(&now);
    QueryPerformanceFrequency(&frequency);
    return (now.QuadPart - start.QuadPart) * 1000.0 / frequency.QuadPart;
}

static ID3DBlob *compile(const char *entry, const char *profile)
{
    ID3DBlob *code, *errors = NULL;
    HRESULT result = D3DCompile(shader_source, sizeof(shader_source) - 1, NULL, NULL, NULL, entry, profile, 0, 0, &code, &errors);
    if (FAILED(result)) {
        printf("%s: %s\n", entry, (errors != NULL) ? (const char *) ID3D10Blob_GetBufferPointer(errors) : "?");
        exit(100);
    }
    return code;
}

static ID3D11Buffer *mapped_buffer(Scene *scene, UINT bind, const void *data, UINT length)
{
    ID3D11Buffer *buffer = buffer_with(scene, D3D11_USAGE_DYNAMIC, bind, D3D11_CPU_ACCESS_WRITE, 0, NULL, length);
    D3D11_MAPPED_SUBRESOURCE mapped;
    check(ID3D11DeviceContext_Map(scene->immediate, (ID3D11Resource *) buffer, 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped), "Map");
    memcpy(mapped.pData, data, length);
    ID3D11DeviceContext_Unmap(scene->immediate, (ID3D11Resource *) buffer, 0);
    return buffer;
}

static uint16_t *half_positions(const Mesh *mesh)
{
    uint16_t *packed = calloc(mesh->vertex_count, 8);
    for (uint32_t i = 0; i != mesh->vertex_count; i++) {
        for (int k = 0; k != 3; k++) {
            packed[i * 4 + k] = half_of(mesh->vertices[i].position[k]);
        }
        packed[i * 4 + 3] = half_of(1.0f);
    }
    return packed;
}

static void expect_absent(const Mesh *mesh, const char *how, uint32_t triangle_count)
{
    record_expectation(mesh, how, triangle_count, CONTENTS_CPU_VISIBLE, PRESENCE_ABSENT);
}

static uint8_t *rgba_texels(uint32_t width, uint32_t height, const uint8_t fill[4], const uint8_t (*corners)[4])
{
    uint8_t *texels = calloc(width * height, 4);
    for (uint32_t i = 0; i != width * height; i++) {
        memcpy(&texels[i * 4], fill, 4);
    }
    if (corners != NULL) {
        uint32_t places[4] = { 0, width - 1, (height - 1) * width, height * width - 1 };
        for (int k = 0; k != 4; k++) {
            memcpy(&texels[places[k] * 4], corners[k], 4);
        }
    }
    return texels;
}

static ID3D11ShaderResourceView *texture_view(Scene *scene, DXGI_FORMAT format, UINT width, UINT height, const void *texels, UINT pitch,
    const char *name)
{
    D3D11_TEXTURE2D_DESC description = { width, height, 1, 1, format, { 1, 0 }, D3D11_USAGE_IMMUTABLE, D3D11_BIND_SHADER_RESOURCE, 0, 0 };
    D3D11_SUBRESOURCE_DATA initial = { texels, pitch, 0 };
    ID3D11Texture2D *texture;
    ID3D11ShaderResourceView *view;
    check(ID3D11Device_CreateTexture2D(scene->device, &description, &initial, &texture), "CreateTexture2D");
    check(ID3D11Texture2D_SetPrivateData(texture, &debug_object_name, (UINT) strlen(name), name), "SetPrivateData");
    check(ID3D11Device_CreateShaderResourceView(scene->device, (ID3D11Resource *) texture, NULL, &view), "CreateShaderResourceView");
    ID3D11Texture2D_Release(texture);
    return view;
}

static uint16_t *bc1_blocks(uint32_t width, uint32_t height, uint16_t fill, const uint16_t corners[4])
{
    uint32_t columns = width / 4, rows = height / 4;
    uint16_t *blocks = calloc(columns * rows, 8);
    uint32_t places[4] = { 0, columns - 1, (rows - 1) * columns, rows * columns - 1 };
    for (uint32_t i = 0; i != columns * rows; i++) {
        blocks[i * 4] = fill;
    }
    for (int k = 0; k != 4; k++) {
        blocks[places[k] * 4] = corners[k];
    }
    return blocks;
}

static void upload_late(Scene *scene)
{
    scene->late_vertices = updated_buffer(scene, D3D11_BIND_VERTEX_BUFFER, scene->late.vertices, scene->late.vertex_count * sizeof(Vertex));
    uint16_t *indices = indices16(&scene->late);
    scene->late_indices = immutable_buffer(scene, D3D11_BIND_INDEX_BUFFER, indices, scene->late.index_count * 2);
    free(indices);
    printf("uploaded the late mesh\n");
    fflush(stdout);
}

static void rebuild_pixel_shader(Scene *scene)
{
    ID3D11PixelShader *previous = scene->shade_textured;
    check(ID3D11Device_CreatePixelShader(scene->device, ID3D10Blob_GetBufferPointer(scene->shade_textured_code),
        ID3D10Blob_GetBufferSize(scene->shade_textured_code), NULL, &scene->shade_textured), "CreatePixelShader");
    ID3D11PixelShader_Release(previous);
}

static void rebuild_layouts(Scene *scene)
{
    ID3D11InputLayout_Release(scene->cube_layout);
    ID3D11InputLayout_Release(scene->split);
    ID3D11InputLayout_Release(scene->half4);
    scene->cube_layout = layout_with(scene, textured_elements, 3, scene->textured_code);
    scene->split = layout_with(scene, split_elements, 3, scene->textured_code);
    scene->half4 = layout_with(scene, half4_elements, 1, scene->position_code);
}

static void update_uniforms(Scene *scene)
{
    float angle = scene->frame * 0.01f;
    float matrix[16] = {
        cosf(angle) * 0.1f, 0, -sinf(angle) * 0.05f, 0,
        0, 0.1f, 0, 0,
        sinf(angle) * 0.1f, 0, cosf(angle) * 0.05f, 0,
        0, 0, 0.5f, 1,
    };
    D3D11_MAPPED_SUBRESOURCE mapped;
    check(ID3D11DeviceContext_Map(scene->immediate, (ID3D11Resource *) scene->uniforms, 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped), "Map");
    memcpy(mapped.pData, matrix, sizeof(matrix));
    ID3D11DeviceContext_Unmap(scene->immediate, (ID3D11Resource *) scene->uniforms, 0);
}

static void draw_scene(Scene *scene)
{
    ID3D11DeviceContext *context = scene->immediate;
    ID3D11ShaderResourceView *cube_views[2] = { scene->cube_albedo, scene->cube_normals };
    ID3D11ShaderResourceView *sphere_views[2] = { scene->sphere_albedo, NULL };
    ID3D11ShaderResourceView *no_views[2] = { NULL, NULL };
    ID3D11DeviceContext_IASetPrimitiveTopology(context, D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    ID3D11DeviceContext_VSSetShader(context, scene->textured_vertex, NULL, 0);
    ID3D11DeviceContext_PSSetShader(context, scene->shade_textured, NULL, 0);
    ID3D11DeviceContext_PSSetSamplers(context, 0, 1, &scene->nearest);

    ID3D11DeviceContext_IASetInputLayout(context, scene->cube_layout);
    bind_vertices(context, 0, scene->cube_vertices, sizeof(Vertex), 0);
    ID3D11DeviceContext_IASetIndexBuffer(context, scene->cube_indices, DXGI_FORMAT_R16_UINT, 0);
    ID3D11DeviceContext_PSSetShaderResources(context, 0, 2, cube_views);
    ID3D11DeviceContext_DrawIndexed(context, scene->cube.index_count, 0, 0);

    ID3D11DeviceContext_IASetInputLayout(context, scene->split);
    bind_vertices(context, 0, scene->sphere_positions, 12, SPHERE_OFFSET);
    bind_vertices(context, 1, scene->sphere_attributes, sizeof(Vertex), 12);
    ID3D11DeviceContext_IASetIndexBuffer(context, scene->sphere_indices, DXGI_FORMAT_R32_UINT, SPHERE_INDEX_OFFSET);
    ID3D11DeviceContext_PSSetShaderResources(context, 0, 2, sphere_views);
    ID3D11DeviceContext_DrawIndexed(context, scene->sphere.index_count, 0, 0);
    bind_vertices(context, 1, NULL, 0, 0);
    ID3D11DeviceContext_PSSetShaderResources(context, 0, 2, no_views);
    ID3D11DeviceContext_VSSetShader(context, scene->described_vertex, NULL, 0);
    ID3D11DeviceContext_PSSetShader(context, scene->shade, NULL, 0);

    ID3D11DeviceContext_IASetInputLayout(context, scene->pulled);
    bind_vertices(context, 0, scene->torus_vertices, 24, 0);
    ID3D11DeviceContext_IASetIndexBuffer(context, scene->torus_indices, DXGI_FORMAT_R32_UINT, 0);
    ID3D11DeviceContext_DrawIndexedInstancedIndirect(context, scene->torus_arguments, 0);

    ID3D11DeviceContext_IASetInputLayout(context, scene->interleaved);
    ID3D11DeviceContext_IASetPrimitiveTopology(context, D3D11_PRIMITIVE_TOPOLOGY_TRIANGLESTRIP);
    bind_vertices(context, 0, scene->ribbon_vertices, sizeof(Vertex), 0);
    ID3D11DeviceContext_Draw(context, scene->ribbon.vertex_count, 0);

    ID3D11DeviceContext_IASetPrimitiveTopology(context, D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    ID3D11DeviceContext_VSSetShader(context, scene->position_vertex, NULL, 0);
    ID3D11DeviceContext_IASetInputLayout(context, scene->half4);
    bind_vertices(context, 0, scene->pyramid_vertices, 8, 0);
    ID3D11DeviceContext_DrawInstanced(context, scene->pyramid.vertex_count, 1, 0, 0);
}

static void record_deferred(Scene *scene)
{
    ID3D11DeviceContext *context = scene->deferred;
    prepare(scene, context);
    ID3D11DeviceContext_IASetPrimitiveTopology(context, D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    ID3D11DeviceContext_VSSetShader(context, scene->position_vertex, NULL, 0);
    ID3D11DeviceContext_IASetInputLayout(context, scene->positions4);
    bind_vertices(context, 0, scene->octahedron_vertices, 16, 0);
    for (int repeat = 0; repeat != scene->repeats; repeat++) {
        ID3D11DeviceContext_Draw(context, scene->octahedron.vertex_count, 0);
    }
    ID3D11CommandList *commands;
    check(ID3D11DeviceContext_FinishCommandList(context, FALSE, &commands), "FinishCommandList");
    ID3D11DeviceContext_ExecuteCommandList(scene->immediate, commands, TRUE);
    ID3D11CommandList_Release(commands);
}

static ID3D11InputLayout *layout_with(Scene *scene, const D3D11_INPUT_ELEMENT_DESC *elements, UINT count, ID3DBlob *code)
{
    ID3D11InputLayout *layout;
    check(ID3D11Device_CreateInputLayout(scene->device, elements, count, ID3D10Blob_GetBufferPointer(code),
        ID3D10Blob_GetBufferSize(code), &layout), "CreateInputLayout");
    return layout;
}

static ID3D11Buffer *immutable_buffer(Scene *scene, UINT bind, const void *data, UINT length)
{
    return buffer_with(scene, D3D11_USAGE_IMMUTABLE, bind, 0, 0, data, length);
}

static ID3D11Buffer *updated_buffer(Scene *scene, UINT bind, const void *data, UINT length)
{
    ID3D11Buffer *buffer = buffer_with(scene, D3D11_USAGE_DEFAULT, bind, 0, 0, NULL, length);
    ID3D11DeviceContext_UpdateSubresource(scene->immediate, (ID3D11Resource *) buffer, 0, NULL, data, 0, 0);
    return buffer;
}

static uint16_t half_of(float value)
{
    uint32_t bits;
    memcpy(&bits, &value, 4);
    uint32_t sign = (bits >> 16) & 0x8000;
    int32_t exponent = (int32_t) ((bits >> 23) & 0xff) - 127 + 15;
    uint32_t mantissa = (bits >> 13) & 0x3ff;
    if (value == 0) {
        return sign;
    }
    return sign | (exponent << 10) | mantissa;
}

static void prepare(Scene *scene, ID3D11DeviceContext *context)
{
    D3D11_VIEWPORT viewport = { 0, 0, TARGET_SIZE, TARGET_SIZE, 0, 1 };
    ID3D11DeviceContext_OMSetRenderTargets(context, 1, &scene->target, scene->depth);
    ID3D11DeviceContext_RSSetViewports(context, 1, &viewport);
    ID3D11DeviceContext_VSSetConstantBuffers(context, 0, 1, &scene->uniforms);
    ID3D11DeviceContext_PSSetShader(context, scene->shade, NULL, 0);
}

static void bind_vertices(ID3D11DeviceContext *context, UINT slot, ID3D11Buffer *buffer, UINT stride, UINT offset)
{
    ID3D11DeviceContext_IASetVertexBuffers(context, slot, 1, &buffer, &stride, &offset);
}

static ID3D11Buffer *buffer_with(Scene *scene, D3D11_USAGE usage, UINT bind, UINT cpu_access, UINT misc, const void *data, UINT length)
{
    D3D11_BUFFER_DESC description = { length, usage, bind, cpu_access, misc, 0 };
    D3D11_SUBRESOURCE_DATA initial = { data, 0, 0 };
    ID3D11Buffer *buffer;
    check(ID3D11Device_CreateBuffer(scene->device, &description, (data != NULL) ? &initial : NULL, &buffer), "CreateBuffer");
    return buffer;
}

static void check(HRESULT result, const char *what)
{
    if (FAILED(result)) {
        printf("%s failed: 0x%08lx\n", what, (unsigned long) result);
        exit(100);
    }
}
