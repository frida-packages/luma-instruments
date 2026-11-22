#include <vulkan/vulkan.h>
#include <signal.h>
#include <time.h>
#include <unistd.h>
#include "meshes.h"

static const uint32_t described_vert[] =
#include "vulkan-described.vert.inc"
;
static const uint32_t positions_vert[] =
#include "vulkan-positions.vert.inc"
;
static const uint32_t homogeneous_vert[] =
#include "vulkan-homogeneous.vert.inc"
;
static const uint32_t shade_frag[] =
#include "vulkan-shade.frag.inc"
;

enum { SIZE = 256, SPHERE_OFFSET = 256, SPHERE_INDEX_OFFSET = 64, RELOAD_SHIFT = 10, PIPELINE_REBUILD_FRAMES = 120 };

typedef enum { KEEP_MAPPED, UNMAP_AFTER_WRITE } Mapping;

typedef struct {
    VkBuffer buffer;
    VkDeviceMemory memory;
} Buffer;

typedef struct {
    VkInstance instance;
    VkPhysicalDevice physical;
    VkPhysicalDeviceMemoryProperties memory;
    VkDevice device;
    VkQueue queue;
    uint32_t family;
    VkCommandPool pool;
    VkCommandBuffer commands;
    VkFence fence;
    int dynamic_vertex_input;
    PFN_vkCmdSetVertexInputEXT set_vertex_input;
} Gpu;

typedef struct {
    Mesh cube, sphere, torus, ribbon, octahedron, pyramid;
    Buffer cube_vertices, cube_indices;
    Buffer sphere_positions, sphere_normals, sphere_indices;
    Buffer torus_vertices, torus_indices;
    Buffer ribbon_vertices;
    Buffer homogeneous;
} Scene;

typedef struct {
    VkPipelineLayout layout;
    VkPipeline described, separate, dynamic, strip, homogeneous;
} Pipelines;

typedef struct {
    const uint32_t *vertex_code;
    size_t vertex_size;
    VkPrimitiveTopology topology;
    uint32_t binding_count;
    VkVertexInputBindingDescription bindings[2];
    uint32_t attribute_count;
    VkVertexInputAttributeDescription attributes[2];
    VkDynamicState extra_state;
} PipelineSpec;

typedef struct {
    VkImage image;
    VkImageView view;
} Attachment;

static volatile sig_atomic_t reload_requested;
static Buffer hidden_buffers[2];

static const PipelineSpec described_spec = {
    described_vert, sizeof(described_vert), VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST,
    1, { { 0, sizeof(Vertex), VK_VERTEX_INPUT_RATE_VERTEX } },
    2, { { 0, 0, VK_FORMAT_R32G32B32_SFLOAT, 0 }, { 1, 0, VK_FORMAT_R32G32B32_SFLOAT, 12 } },
    VK_DYNAMIC_STATE_MAX_ENUM,
};

static const PipelineSpec separate_spec = {
    positions_vert, sizeof(positions_vert), VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST,
    2, { { 0, sizeof(Vertex), VK_VERTEX_INPUT_RATE_VERTEX }, { 1, 12, VK_VERTEX_INPUT_RATE_VERTEX } },
    2, { { 0, 0, VK_FORMAT_R32G32B32_SFLOAT, 12 }, { 2, 1, VK_FORMAT_R32G32B32_SFLOAT, 0 } },
    VK_DYNAMIC_STATE_MAX_ENUM,
};

static const PipelineSpec dynamic_spec = {
    described_vert, sizeof(described_vert), VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST, 0, { { 0 } }, 0, { { 0 } },
    VK_DYNAMIC_STATE_VERTEX_INPUT_EXT,
};

static const PipelineSpec pulled_spec = {
    described_vert, sizeof(described_vert), VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST,
    1, { { 0, 24, VK_VERTEX_INPUT_RATE_VERTEX } },
    2, { { 0, 0, VK_FORMAT_R32G32B32_SFLOAT, 0 }, { 1, 0, VK_FORMAT_R32G32B32_SFLOAT, 12 } },
    VK_DYNAMIC_STATE_MAX_ENUM,
};

static const PipelineSpec strip_spec = {
    described_vert, sizeof(described_vert), VK_PRIMITIVE_TOPOLOGY_TRIANGLE_STRIP,
    1, { { 0, sizeof(Vertex), VK_VERTEX_INPUT_RATE_VERTEX } },
    2, { { 0, 0, VK_FORMAT_R32G32B32_SFLOAT, 0 }, { 1, 0, VK_FORMAT_R32G32B32_SFLOAT, 12 } },
    VK_DYNAMIC_STATE_MAX_ENUM,
};

static const PipelineSpec homogeneous_spec = {
    homogeneous_vert, sizeof(homogeneous_vert), VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST,
    1, { { 0, 0, VK_VERTEX_INPUT_RATE_VERTEX } },
    1, { { 0, 0, VK_FORMAT_R32G32B32A32_SFLOAT, 0 } },
    VK_DYNAMIC_STATE_VERTEX_INPUT_BINDING_STRIDE,
};

static Gpu gpu_open(void);
static Attachment attachment_new(const Gpu *gpu, VkFormat format, VkImageUsageFlags usage, VkImageAspectFlags aspect);
static Pipelines pipelines_new(const Gpu *gpu);
static Scene scene_new(const Gpu *gpu, const char *const names[6], float dx, Mapping cube_mapping);
static Mesh shifted(Mesh mesh, const char *name, float dx);
static void scene_expect(const Scene *scene, const char *when, Contents contents);
static void request_reload(int signal);
static void scene_free(const Gpu *gpu, Scene *scene);
static void upload_late(const Gpu *gpu, const Mesh *late, Buffer *vertices, Buffer *indices);
static VkPipeline pipeline_new(const Gpu *gpu, VkPipelineLayout layout, const PipelineSpec *spec);
static void transition(VkCommandBuffer commands, VkImage image, VkImageAspectFlags aspect, VkImageLayout layout,
    VkPipelineStageFlags stage, VkAccessFlags access);
static void draw_scene(const Gpu *gpu, const Pipelines *pipelines, const Scene *scene, const float matrix[16]);
static double milliseconds_since(const struct timespec *start);
static int has_extension(VkPhysicalDevice physical, const char *name);
static void *padded(const void *data, size_t length, size_t padding);
static Buffer staged_buffer(const Gpu *gpu, VkBufferUsageFlags usage, const void *data, VkDeviceSize size);
static Buffer host_buffer(const Gpu *gpu, VkBufferUsageFlags usage, const void *data, VkDeviceSize size, Mapping mapping);
static void submit_and_wait(const Gpu *gpu);
static void buffer_free(const Gpu *gpu, Buffer *buffer);
static VkShaderModule shader_module(const Gpu *gpu, const uint32_t *code, size_t size);
static Buffer buffer_new(const Gpu *gpu, VkDeviceSize size, VkBufferUsageFlags usage, VkMemoryPropertyFlags wanted,
    VkMemoryPropertyFlags unwanted);
static void check(VkResult result, const char *what);
static uint32_t memory_type(const Gpu *gpu, uint32_t allowed, VkMemoryPropertyFlags wanted, VkMemoryPropertyFlags unwanted);

int main(int argc, char **argv)
{
    int repeats = (argc > 1) ? atoi(argv[1]) : 1;
    Gpu gpu = gpu_open();
    Attachment color = attachment_new(&gpu, VK_FORMAT_R8G8B8A8_UNORM, VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT, VK_IMAGE_ASPECT_COLOR_BIT);
    Attachment depth = attachment_new(&gpu, VK_FORMAT_D32_SFLOAT, VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT, VK_IMAGE_ASPECT_DEPTH_BIT);
    Pipelines pipelines = pipelines_new(&gpu);

    static const char *const before[6] = { "cube", "sphere", "torus", "ribbon", "octahedron", "pyramid" };
    static const char *const after[6] = { "reloaded-cube", "reloaded-sphere", "reloaded-torus", "reloaded-ribbon",
        "reloaded-octahedron", "reloaded-pyramid" };
    Scene scene = scene_new(&gpu, before, 0, KEEP_MAPPED);
    Scene expected_reload;
    expected_reload.cube = shifted(make_cube("cube", 0, 0, 0), after[0], RELOAD_SHIFT);
    expected_reload.sphere = shifted(make_sphere("sphere", 4, 0, 0, 1.5f, 16, 32), after[1], RELOAD_SHIFT);
    expected_reload.torus = shifted(make_torus("torus", 0, 4, 0, 1.2f, 0.4f, 48, 16), after[2], RELOAD_SHIFT);
    expected_reload.ribbon = shifted(make_ribbon("ribbon", 0, 0, 4, 20), after[3], RELOAD_SHIFT);
    expected_reload.octahedron = shifted(make_octahedron("octahedron", 0, -4, 0), after[4], RELOAD_SHIFT);
    expected_reload.pyramid = shifted(make_pyramid("pyramid", -4, 4, 0), after[5], RELOAD_SHIFT);

    Mesh hidden = make_torus("hidden-torus", -4, 0, 0, 2.0f, 0.5f, 32, 12);
    uint16_t *hidden_indices = indices16(&hidden);
    hidden_buffers[0] = host_buffer(&gpu, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, hidden.vertices, hidden.vertex_count * sizeof(Vertex),
        KEEP_MAPPED);
    hidden_buffers[1] = host_buffer(&gpu, VK_BUFFER_USAGE_INDEX_BUFFER_BIT, hidden_indices, hidden.index_count * 2, KEEP_MAPPED);
    free(hidden_indices);
    Mesh late = make_sphere("late-sphere", 0, 0, -4, 0.75f, 8, 12);
    Buffer late_vertices = { 0 }, late_indices = { 0 };

    scene_expect(&scene, "drawn from buffers bound before attach", CONTENTS_UNLOCATED);
    scene_expect(&expected_reload, "reloaded after attach", CONTENTS_CPU_VISIBLE);
    expect(&hidden, "persistently mapped before attach, never drawn", hidden.index_count / 3, CONTENTS_CPU_VISIBLE);
    expect(&late, "staged into device-local memory after attach, never drawn", late.index_count / 3, CONTENTS_CPU_VISIBLE);

    signal(SIGUSR1, request_reload);
    printf("pid %d ready, %d draws per frame, dynamic vertex input %s\n", getpid(), repeats * 6,
        gpu.dynamic_vertex_input ? "supported" : "not supported");
    fflush(stdout);

    double total = 0, worst = 0, recording = 0;
    int frames = 0;
    for (uint64_t frame = 0;; frame++) {
        if (reload_requested) {
            reload_requested = 0;
            vkDeviceWaitIdle(gpu.device);
            scene_free(&gpu, &scene);
            scene = scene_new(&gpu, after, RELOAD_SHIFT, UNMAP_AFTER_WRITE);
            upload_late(&gpu, &late, &late_vertices, &late_indices);
        }
        if (frame % PIPELINE_REBUILD_FRAMES == PIPELINE_REBUILD_FRAMES - 1) {
            vkDeviceWaitIdle(gpu.device);
            vkDestroyPipeline(gpu.device, pipelines.separate, NULL);
            vkDestroyPipeline(gpu.device, pipelines.strip, NULL);
            pipelines.separate = pipeline_new(&gpu, pipelines.layout, &separate_spec);
            pipelines.strip = pipeline_new(&gpu, pipelines.layout, &strip_spec);
        }
        struct timespec start;
        clock_gettime(CLOCK_MONOTONIC, &start);
        float angle = frame * 0.01f;
        float matrix[16] = {
            cosf(angle) * 0.1f, 0, -sinf(angle) * 0.05f, 0,
            0, 0.1f, 0, 0,
            sinf(angle) * 0.1f, 0, cosf(angle) * 0.05f, 0,
            0, 0, 0.5f, 1,
        };

        VkCommandBufferBeginInfo begin = { .sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO,
            .flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT };
        vkBeginCommandBuffer(gpu.commands, &begin);
        transition(gpu.commands, color.image, VK_IMAGE_ASPECT_COLOR_BIT, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,
            VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT, VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT);
        transition(gpu.commands, depth.image, VK_IMAGE_ASPECT_DEPTH_BIT, VK_IMAGE_LAYOUT_DEPTH_ATTACHMENT_OPTIMAL,
            VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT, VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT);
        VkRenderingAttachmentInfo color_attachment = { .sType = VK_STRUCTURE_TYPE_RENDERING_ATTACHMENT_INFO, .imageView = color.view,
            .imageLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL, .loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR,
            .storeOp = VK_ATTACHMENT_STORE_OP_STORE };
        VkRenderingAttachmentInfo depth_attachment = { .sType = VK_STRUCTURE_TYPE_RENDERING_ATTACHMENT_INFO, .imageView = depth.view,
            .imageLayout = VK_IMAGE_LAYOUT_DEPTH_ATTACHMENT_OPTIMAL, .loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR,
            .storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE, .clearValue = { .depthStencil = { 1.0f, 0 } } };
        VkRenderingInfo rendering = { .sType = VK_STRUCTURE_TYPE_RENDERING_INFO, .renderArea = { { 0, 0 }, { SIZE, SIZE } },
            .layerCount = 1, .colorAttachmentCount = 1, .pColorAttachments = &color_attachment, .pDepthAttachment = &depth_attachment };
        vkCmdBeginRendering(gpu.commands, &rendering);
        VkViewport viewport = { 0, 0, SIZE, SIZE, 0, 1 };
        VkRect2D scissor = { { 0, 0 }, { SIZE, SIZE } };
        vkCmdSetViewport(gpu.commands, 0, 1, &viewport);
        vkCmdSetScissor(gpu.commands, 0, 1, &scissor);
        for (int repeat = 0; repeat != repeats; repeat++) {
            draw_scene(&gpu, &pipelines, &scene, matrix);
        }
        vkCmdEndRendering(gpu.commands);
        vkEndCommandBuffer(gpu.commands);
        recording += milliseconds_since(&start);
        submit_and_wait(&gpu);

        double elapsed = milliseconds_since(&start);
        total += elapsed;
        worst = fmax(worst, elapsed);
        if (++frames == 120) {
            printf("frame time: mean %.3f ms, worst %.3f ms; recording: mean %.3f ms\n", total / frames, worst, recording / frames);
            fflush(stdout);
            total = worst = recording = 0;
            frames = 0;
        }
        usleep(16000);
    }
}

static Gpu gpu_open(void)
{
    Gpu gpu = { 0 };
    VkApplicationInfo application = { .sType = VK_STRUCTURE_TYPE_APPLICATION_INFO, .pApplicationName = "mesh-finder-target",
        .apiVersion = VK_API_VERSION_1_3 };
    VkInstanceCreateInfo instance_info = { .sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO, .pApplicationInfo = &application };
    check(vkCreateInstance(&instance_info, NULL, &gpu.instance), "vkCreateInstance");

    uint32_t count = 1;
    vkEnumeratePhysicalDevices(gpu.instance, &count, &gpu.physical);
    vkGetPhysicalDeviceMemoryProperties(gpu.physical, &gpu.memory);
    uint32_t families = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(gpu.physical, &families, NULL);
    VkQueueFamilyProperties *properties = calloc(families, sizeof(VkQueueFamilyProperties));
    vkGetPhysicalDeviceQueueFamilyProperties(gpu.physical, &families, properties);
    while ((properties[gpu.family].queueFlags & VK_QUEUE_GRAPHICS_BIT) == 0) {
        gpu.family++;
    }
    free(properties);

    gpu.dynamic_vertex_input = has_extension(gpu.physical, VK_EXT_VERTEX_INPUT_DYNAMIC_STATE_EXTENSION_NAME);
    VkPhysicalDeviceVertexInputDynamicStateFeaturesEXT vertex_input = {
        .sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VERTEX_INPUT_DYNAMIC_STATE_FEATURES_EXT, .vertexInputDynamicState = VK_TRUE };
    VkPhysicalDeviceVulkan13Features features13 = { .sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_3_FEATURES,
        .pNext = gpu.dynamic_vertex_input ? &vertex_input : NULL, .dynamicRendering = VK_TRUE };
    float priority = 1.0f;
    VkDeviceQueueCreateInfo queue_info = { .sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO, .queueFamilyIndex = gpu.family,
        .queueCount = 1, .pQueuePriorities = &priority };
    const char *extensions[] = { VK_EXT_VERTEX_INPUT_DYNAMIC_STATE_EXTENSION_NAME };
    VkDeviceCreateInfo device_info = { .sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO, .pNext = &features13, .queueCreateInfoCount = 1,
        .pQueueCreateInfos = &queue_info, .enabledExtensionCount = gpu.dynamic_vertex_input ? 1 : 0,
        .ppEnabledExtensionNames = extensions };
    check(vkCreateDevice(gpu.physical, &device_info, NULL, &gpu.device), "vkCreateDevice");
    vkGetDeviceQueue(gpu.device, gpu.family, 0, &gpu.queue);
    if (gpu.dynamic_vertex_input) {
        gpu.set_vertex_input = (PFN_vkCmdSetVertexInputEXT) vkGetDeviceProcAddr(gpu.device, "vkCmdSetVertexInputEXT");
    }

    VkCommandPoolCreateInfo pool_info = { .sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO,
        .flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT, .queueFamilyIndex = gpu.family };
    check(vkCreateCommandPool(gpu.device, &pool_info, NULL, &gpu.pool), "vkCreateCommandPool");
    VkCommandBufferAllocateInfo allocate_info = { .sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO, .commandPool = gpu.pool,
        .level = VK_COMMAND_BUFFER_LEVEL_PRIMARY, .commandBufferCount = 1 };
    check(vkAllocateCommandBuffers(gpu.device, &allocate_info, &gpu.commands), "vkAllocateCommandBuffers");
    VkFenceCreateInfo fence_info = { .sType = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO };
    check(vkCreateFence(gpu.device, &fence_info, NULL, &gpu.fence), "vkCreateFence");
    return gpu;
}

static Attachment attachment_new(const Gpu *gpu, VkFormat format, VkImageUsageFlags usage, VkImageAspectFlags aspect)
{
    Attachment attachment;
    VkImageCreateInfo info = { .sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO, .imageType = VK_IMAGE_TYPE_2D, .format = format,
        .extent = { SIZE, SIZE, 1 }, .mipLevels = 1, .arrayLayers = 1, .samples = VK_SAMPLE_COUNT_1_BIT,
        .tiling = VK_IMAGE_TILING_OPTIMAL, .usage = usage };
    check(vkCreateImage(gpu->device, &info, NULL, &attachment.image), "vkCreateImage");
    VkMemoryRequirements requirements;
    vkGetImageMemoryRequirements(gpu->device, attachment.image, &requirements);
    VkMemoryAllocateInfo allocation = { .sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO, .allocationSize = requirements.size,
        .memoryTypeIndex = memory_type(gpu, requirements.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, 0) };
    VkDeviceMemory memory;
    check(vkAllocateMemory(gpu->device, &allocation, NULL, &memory), "vkAllocateMemory");
    vkBindImageMemory(gpu->device, attachment.image, memory, 0);
    VkImageViewCreateInfo view = { .sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO, .image = attachment.image,
        .viewType = VK_IMAGE_VIEW_TYPE_2D, .format = format, .subresourceRange = { aspect, 0, 1, 0, 1 } };
    check(vkCreateImageView(gpu->device, &view, NULL, &attachment.view), "vkCreateImageView");
    return attachment;
}

static Pipelines pipelines_new(const Gpu *gpu)
{
    Pipelines pipelines;
    VkPushConstantRange range = { VK_SHADER_STAGE_VERTEX_BIT, 0, 64 };
    VkPipelineLayoutCreateInfo layout_info = { .sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO, .pushConstantRangeCount = 1,
        .pPushConstantRanges = &range };
    check(vkCreatePipelineLayout(gpu->device, &layout_info, NULL, &pipelines.layout), "vkCreatePipelineLayout");
    pipelines.described = pipeline_new(gpu, pipelines.layout, &described_spec);
    pipelines.separate = pipeline_new(gpu, pipelines.layout, &separate_spec);
    pipelines.dynamic = pipeline_new(gpu, pipelines.layout, gpu->dynamic_vertex_input ? &dynamic_spec : &pulled_spec);
    pipelines.strip = pipeline_new(gpu, pipelines.layout, &strip_spec);
    pipelines.homogeneous = pipeline_new(gpu, pipelines.layout, &homogeneous_spec);
    return pipelines;
}

static Scene scene_new(const Gpu *gpu, const char *const names[6], float dx, Mapping cube_mapping)
{
    Scene scene;
    scene.cube = shifted(make_cube("cube", 0, 0, 0), names[0], dx);
    scene.sphere = shifted(make_sphere("sphere", 4, 0, 0, 1.5f, 16, 32), names[1], dx);
    scene.torus = shifted(make_torus("torus", 0, 4, 0, 1.2f, 0.4f, 48, 16), names[2], dx);
    scene.ribbon = shifted(make_ribbon("ribbon", 0, 0, 4, 20), names[3], dx);
    scene.octahedron = shifted(make_octahedron("octahedron", 0, -4, 0), names[4], dx);
    scene.pyramid = shifted(make_pyramid("pyramid", -4, 4, 0), names[5], dx);

    const VkBufferUsageFlags vertex = VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, index = VK_BUFFER_USAGE_INDEX_BUFFER_BIT;
    uint16_t *cube_indices = indices16(&scene.cube);
    scene.cube_vertices = host_buffer(gpu, vertex, scene.cube.vertices, scene.cube.vertex_count * sizeof(Vertex), cube_mapping);
    scene.cube_indices = host_buffer(gpu, index, cube_indices, scene.cube.index_count * 2, cube_mapping);
    free(cube_indices);

    void *sphere_positions = positions_with_stride(&scene.sphere, 12);
    void *padded_positions = padded(sphere_positions, scene.sphere.vertex_count * 12, SPHERE_OFFSET);
    void *padded_indices = padded(scene.sphere.indices, scene.sphere.index_count * 4, SPHERE_INDEX_OFFSET);
    scene.sphere_positions = staged_buffer(gpu, vertex, padded_positions, SPHERE_OFFSET + scene.sphere.vertex_count * 12);
    scene.sphere_normals = staged_buffer(gpu, vertex, scene.sphere.vertices, scene.sphere.vertex_count * sizeof(Vertex));
    scene.sphere_indices = staged_buffer(gpu, index, padded_indices, SPHERE_INDEX_OFFSET + scene.sphere.index_count * 4);
    free(sphere_positions);
    free(padded_positions);
    free(padded_indices);

    void *torus_vertices = pulled_vertices(&scene.torus);
    scene.torus_vertices = host_buffer(gpu, vertex, torus_vertices, scene.torus.vertex_count * 24, KEEP_MAPPED);
    scene.torus_indices = host_buffer(gpu, index, scene.torus.indices, scene.torus.index_count * 4, KEEP_MAPPED);
    free(torus_vertices);

    scene.ribbon_vertices = staged_buffer(gpu, vertex, scene.ribbon.vertices, scene.ribbon.vertex_count * sizeof(Vertex));

    uint32_t homogeneous_count = scene.octahedron.vertex_count + scene.pyramid.vertex_count;
    uint8_t *homogeneous = malloc(homogeneous_count * 16);
    void *octahedron_positions = positions_with_stride(&scene.octahedron, 16);
    void *pyramid_positions = positions_with_stride(&scene.pyramid, 16);
    memcpy(homogeneous, octahedron_positions, scene.octahedron.vertex_count * 16);
    memcpy(homogeneous + scene.octahedron.vertex_count * 16, pyramid_positions, scene.pyramid.vertex_count * 16);
    scene.homogeneous = host_buffer(gpu, vertex, homogeneous, homogeneous_count * 16, KEEP_MAPPED);
    free(homogeneous);
    free(octahedron_positions);
    free(pyramid_positions);
    return scene;
}

static Mesh shifted(Mesh mesh, const char *name, float dx)
{
    Vertex *vertices = calloc(mesh.vertex_count, sizeof(Vertex));
    for (uint32_t i = 0; i != mesh.vertex_count; i++) {
        vertices[i] = mesh.vertices[i];
        vertices[i].position[0] += dx;
    }
    mesh.vertices = vertices;
    mesh.name = name;
    return mesh;
}

static void scene_expect(const Scene *scene, const char *when, Contents contents)
{
    char how[6][160];
    snprintf(how[0], sizeof(how[0]), "%s; interleaved position, normal and uv in host-visible memory; 16-bit indices", when);
    snprintf(how[1], sizeof(how[1]), "%s; positions alone at an offset, staged into device-local memory; 32-bit indices at an offset",
        when);
    snprintf(how[2], sizeof(how[2]), "%s; vkCmdSetVertexInputEXT, persistently mapped; 32-bit indices", when);
    snprintf(how[3], sizeof(how[3]), "%s; triangle strip, vkCmdDraw, staged into device-local memory", when);
    snprintf(how[4], sizeof(how[4]), "%s; vkCmdDraw with four-component positions, stride from vkCmdBindVertexBuffers2", when);
    snprintf(how[5], sizeof(how[5]), "%s; vkCmdDraw from vertex 24 of the octahedron's buffer", when);
    expect(&scene->cube, how[0], 12, contents);
    expect(&scene->sphere, how[1], scene->sphere.index_count / 3, contents);
    expect(&scene->torus, how[2], scene->torus.index_count / 3, contents);
    expect(&scene->ribbon, how[3], scene->ribbon.vertex_count - 2, contents);
    expect(&scene->octahedron, how[4], 8, contents);
    expect(&scene->pyramid, how[5], 6, contents);
}

static void request_reload(int signal)
{
    reload_requested = 1;
}

static void scene_free(const Gpu *gpu, Scene *scene)
{
    Buffer *buffers[] = { &scene->cube_vertices, &scene->cube_indices, &scene->sphere_positions, &scene->sphere_normals,
        &scene->sphere_indices, &scene->torus_vertices, &scene->torus_indices, &scene->ribbon_vertices, &scene->homogeneous };
    for (size_t i = 0; i != sizeof(buffers) / sizeof(buffers[0]); i++) {
        buffer_free(gpu, buffers[i]);
    }
}

static void upload_late(const Gpu *gpu, const Mesh *late, Buffer *vertices, Buffer *indices)
{
    *vertices = staged_buffer(gpu, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, late->vertices, late->vertex_count * sizeof(Vertex));
    uint16_t *narrow = indices16(late);
    *indices = staged_buffer(gpu, VK_BUFFER_USAGE_INDEX_BUFFER_BIT, narrow, late->index_count * 2);
    free(narrow);
    printf("reloaded the scene and uploaded the late mesh\n");
    fflush(stdout);
}

static VkPipeline pipeline_new(const Gpu *gpu, VkPipelineLayout layout, const PipelineSpec *spec)
{
    VkShaderModule vertex = shader_module(gpu, spec->vertex_code, spec->vertex_size);
    VkShaderModule fragment = shader_module(gpu, shade_frag, sizeof(shade_frag));
    VkPipelineShaderStageCreateInfo stages[] = {
        { .sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO, .stage = VK_SHADER_STAGE_VERTEX_BIT, .module = vertex,
            .pName = "main" },
        { .sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO, .stage = VK_SHADER_STAGE_FRAGMENT_BIT, .module = fragment,
            .pName = "main" },
    };
    VkPipelineVertexInputStateCreateInfo vertex_input = { .sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO,
        .vertexBindingDescriptionCount = spec->binding_count, .pVertexBindingDescriptions = spec->bindings,
        .vertexAttributeDescriptionCount = spec->attribute_count, .pVertexAttributeDescriptions = spec->attributes };
    VkPipelineInputAssemblyStateCreateInfo assembly = { .sType = VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO,
        .topology = spec->topology };
    VkPipelineViewportStateCreateInfo viewport = { .sType = VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO, .viewportCount = 1,
        .scissorCount = 1 };
    VkPipelineRasterizationStateCreateInfo raster = { .sType = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO,
        .polygonMode = VK_POLYGON_MODE_FILL, .cullMode = VK_CULL_MODE_NONE, .lineWidth = 1.0f };
    VkPipelineMultisampleStateCreateInfo multisample = { .sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO,
        .rasterizationSamples = VK_SAMPLE_COUNT_1_BIT };
    VkPipelineDepthStencilStateCreateInfo depth = { .sType = VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO,
        .depthTestEnable = VK_TRUE, .depthWriteEnable = VK_TRUE, .depthCompareOp = VK_COMPARE_OP_LESS };
    VkPipelineColorBlendAttachmentState attachment = { .colorWriteMask = 0xf };
    VkPipelineColorBlendStateCreateInfo blend = { .sType = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO,
        .attachmentCount = 1, .pAttachments = &attachment };
    VkDynamicState states[] = { VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR, spec->extra_state };
    VkPipelineDynamicStateCreateInfo dynamic = { .sType = VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO,
        .dynamicStateCount = (spec->extra_state != VK_DYNAMIC_STATE_MAX_ENUM) ? 3 : 2, .pDynamicStates = states };
    VkFormat color_format = VK_FORMAT_R8G8B8A8_UNORM;
    VkPipelineRenderingCreateInfo rendering = { .sType = VK_STRUCTURE_TYPE_PIPELINE_RENDERING_CREATE_INFO, .colorAttachmentCount = 1,
        .pColorAttachmentFormats = &color_format, .depthAttachmentFormat = VK_FORMAT_D32_SFLOAT };
    VkGraphicsPipelineCreateInfo info = { .sType = VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO, .pNext = &rendering,
        .stageCount = 2, .pStages = stages,
        .pVertexInputState = (spec->extra_state == VK_DYNAMIC_STATE_VERTEX_INPUT_EXT) ? NULL : &vertex_input,
        .pInputAssemblyState = &assembly, .pViewportState = &viewport, .pRasterizationState = &raster,
        .pMultisampleState = &multisample, .pDepthStencilState = &depth, .pColorBlendState = &blend, .pDynamicState = &dynamic,
        .layout = layout };
    VkPipeline pipeline;
    check(vkCreateGraphicsPipelines(gpu->device, VK_NULL_HANDLE, 1, &info, NULL, &pipeline), "vkCreateGraphicsPipelines");
    vkDestroyShaderModule(gpu->device, vertex, NULL);
    vkDestroyShaderModule(gpu->device, fragment, NULL);
    return pipeline;
}

static void transition(VkCommandBuffer commands, VkImage image, VkImageAspectFlags aspect, VkImageLayout layout,
    VkPipelineStageFlags stage, VkAccessFlags access)
{
    VkImageMemoryBarrier barrier = { .sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER, .dstAccessMask = access,
        .oldLayout = VK_IMAGE_LAYOUT_UNDEFINED, .newLayout = layout, .srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
        .dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED, .image = image, .subresourceRange = { aspect, 0, 1, 0, 1 } };
    vkCmdPipelineBarrier(commands, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, stage, 0, 0, NULL, 0, NULL, 1, &barrier);
}

static void draw_scene(const Gpu *gpu, const Pipelines *pipelines, const Scene *scene, const float matrix[16])
{
    VkCommandBuffer commands = gpu->commands;
    VkDeviceSize zero = 0;

    vkCmdBindPipeline(commands, VK_PIPELINE_BIND_POINT_GRAPHICS, pipelines->described);
    vkCmdPushConstants(commands, pipelines->layout, VK_SHADER_STAGE_VERTEX_BIT, 0, 64, matrix);
    vkCmdBindVertexBuffers(commands, 0, 1, &scene->cube_vertices.buffer, &zero);
    vkCmdBindIndexBuffer(commands, scene->cube_indices.buffer, 0, VK_INDEX_TYPE_UINT16);
    vkCmdDrawIndexed(commands, scene->cube.index_count, 1, 0, 0, 0);

    vkCmdBindPipeline(commands, VK_PIPELINE_BIND_POINT_GRAPHICS, pipelines->separate);
    VkBuffer sphere_buffers[] = { scene->sphere_normals.buffer, scene->sphere_positions.buffer };
    VkDeviceSize sphere_offsets[] = { 0, SPHERE_OFFSET };
    vkCmdBindVertexBuffers(commands, 0, 2, sphere_buffers, sphere_offsets);
    vkCmdBindIndexBuffer(commands, scene->sphere_indices.buffer, 0, VK_INDEX_TYPE_UINT32);
    vkCmdDrawIndexed(commands, scene->sphere.index_count, 1, SPHERE_INDEX_OFFSET / 4, 0, 0);

    vkCmdBindPipeline(commands, VK_PIPELINE_BIND_POINT_GRAPHICS, pipelines->dynamic);
    if (gpu->dynamic_vertex_input) {
        VkVertexInputBindingDescription2EXT binding = { .sType = VK_STRUCTURE_TYPE_VERTEX_INPUT_BINDING_DESCRIPTION_2_EXT,
            .binding = 0, .stride = 24, .inputRate = VK_VERTEX_INPUT_RATE_VERTEX, .divisor = 1 };
        VkVertexInputAttributeDescription2EXT attributes[] = {
            { .sType = VK_STRUCTURE_TYPE_VERTEX_INPUT_ATTRIBUTE_DESCRIPTION_2_EXT, .location = 0, .binding = 0,
                .format = VK_FORMAT_R32G32B32_SFLOAT, .offset = 0 },
            { .sType = VK_STRUCTURE_TYPE_VERTEX_INPUT_ATTRIBUTE_DESCRIPTION_2_EXT, .location = 1, .binding = 0,
                .format = VK_FORMAT_R32G32B32_SFLOAT, .offset = 12 },
        };
        gpu->set_vertex_input(commands, 1, &binding, 2, attributes);
    }
    vkCmdBindVertexBuffers(commands, 0, 1, &scene->torus_vertices.buffer, &zero);
    vkCmdBindIndexBuffer(commands, scene->torus_indices.buffer, 0, VK_INDEX_TYPE_UINT32);
    vkCmdDrawIndexed(commands, scene->torus.index_count, 1, 0, 0, 0);

    vkCmdBindPipeline(commands, VK_PIPELINE_BIND_POINT_GRAPHICS, pipelines->strip);
    vkCmdBindVertexBuffers(commands, 0, 1, &scene->ribbon_vertices.buffer, &zero);
    vkCmdDraw(commands, scene->ribbon.vertex_count, 1, 0, 0);

    vkCmdBindPipeline(commands, VK_PIPELINE_BIND_POINT_GRAPHICS, pipelines->homogeneous);
    VkDeviceSize homogeneous_stride = 16;
    vkCmdBindVertexBuffers2(commands, 0, 1, &scene->homogeneous.buffer, &zero, NULL, &homogeneous_stride);
    vkCmdDraw(commands, scene->octahedron.vertex_count, 1, 0, 0);
    vkCmdDraw(commands, scene->pyramid.vertex_count, 1, scene->octahedron.vertex_count, 0);
}

static double milliseconds_since(const struct timespec *start)
{
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return (now.tv_sec - start->tv_sec) * 1e3 + (now.tv_nsec - start->tv_nsec) / 1e6;
}

static int has_extension(VkPhysicalDevice physical, const char *name)
{
    uint32_t count = 0;
    vkEnumerateDeviceExtensionProperties(physical, NULL, &count, NULL);
    VkExtensionProperties *extensions = calloc(count, sizeof(VkExtensionProperties));
    vkEnumerateDeviceExtensionProperties(physical, NULL, &count, extensions);
    int found = 0;
    for (uint32_t i = 0; i != count; i++) {
        found |= strcmp(extensions[i].extensionName, name) == 0;
    }
    free(extensions);
    return found;
}

static void *padded(const void *data, size_t length, size_t padding)
{
    uint8_t *bytes = calloc(1, padding + length);
    memcpy(bytes + padding, data, length);
    return bytes;
}

static Buffer staged_buffer(const Gpu *gpu, VkBufferUsageFlags usage, const void *data, VkDeviceSize size)
{
    Buffer staging = host_buffer(gpu, VK_BUFFER_USAGE_TRANSFER_SRC_BIT, data, size, UNMAP_AFTER_WRITE);
    Buffer result = buffer_new(gpu, size, usage | VK_BUFFER_USAGE_TRANSFER_DST_BIT, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT,
        VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT);
    VkCommandBufferBeginInfo begin = { .sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO,
        .flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT };
    vkBeginCommandBuffer(gpu->commands, &begin);
    VkBufferCopy region = { .size = size };
    vkCmdCopyBuffer(gpu->commands, staging.buffer, result.buffer, 1, &region);
    vkEndCommandBuffer(gpu->commands);
    submit_and_wait(gpu);
    buffer_free(gpu, &staging);
    return result;
}

static Buffer host_buffer(const Gpu *gpu, VkBufferUsageFlags usage, const void *data, VkDeviceSize size, Mapping mapping)
{
    Buffer result = buffer_new(gpu, size, usage, VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT, 0);
    void *mapped;
    check(vkMapMemory(gpu->device, result.memory, 0, VK_WHOLE_SIZE, 0, &mapped), "vkMapMemory");
    memcpy(mapped, data, size);
    if (mapping == UNMAP_AFTER_WRITE) {
        vkUnmapMemory(gpu->device, result.memory);
    }
    return result;
}

static void submit_and_wait(const Gpu *gpu)
{
    VkSubmitInfo submit = { .sType = VK_STRUCTURE_TYPE_SUBMIT_INFO, .commandBufferCount = 1, .pCommandBuffers = &gpu->commands };
    check(vkQueueSubmit(gpu->queue, 1, &submit, gpu->fence), "vkQueueSubmit");
    check(vkWaitForFences(gpu->device, 1, &gpu->fence, VK_TRUE, UINT64_MAX), "vkWaitForFences");
    vkResetFences(gpu->device, 1, &gpu->fence);
}

static void buffer_free(const Gpu *gpu, Buffer *buffer)
{
    vkDestroyBuffer(gpu->device, buffer->buffer, NULL);
    vkFreeMemory(gpu->device, buffer->memory, NULL);
}

static VkShaderModule shader_module(const Gpu *gpu, const uint32_t *code, size_t size)
{
    VkShaderModuleCreateInfo info = { .sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO, .codeSize = size, .pCode = code };
    VkShaderModule module;
    check(vkCreateShaderModule(gpu->device, &info, NULL, &module), "vkCreateShaderModule");
    return module;
}

static Buffer buffer_new(const Gpu *gpu, VkDeviceSize size, VkBufferUsageFlags usage, VkMemoryPropertyFlags wanted,
    VkMemoryPropertyFlags unwanted)
{
    Buffer result;
    VkBufferCreateInfo info = { .sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO, .size = size, .usage = usage,
        .sharingMode = VK_SHARING_MODE_EXCLUSIVE };
    check(vkCreateBuffer(gpu->device, &info, NULL, &result.buffer), "vkCreateBuffer");
    VkMemoryRequirements requirements;
    vkGetBufferMemoryRequirements(gpu->device, result.buffer, &requirements);
    VkMemoryAllocateInfo allocation = { .sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO, .allocationSize = requirements.size,
        .memoryTypeIndex = memory_type(gpu, requirements.memoryTypeBits, wanted, unwanted) };
    check(vkAllocateMemory(gpu->device, &allocation, NULL, &result.memory), "vkAllocateMemory");
    check(vkBindBufferMemory(gpu->device, result.buffer, result.memory, 0), "vkBindBufferMemory");
    return result;
}

static void check(VkResult result, const char *what)
{
    if (result != VK_SUCCESS) {
        fprintf(stderr, "%s failed: %d\n", what, result);
        exit(1);
    }
}

static uint32_t memory_type(const Gpu *gpu, uint32_t allowed, VkMemoryPropertyFlags wanted, VkMemoryPropertyFlags unwanted)
{
    for (uint32_t i = 0; i != gpu->memory.memoryTypeCount; i++) {
        VkMemoryPropertyFlags flags = gpu->memory.memoryTypes[i].propertyFlags;
        if ((allowed & (1u << i)) != 0 && (flags & wanted) == wanted && (flags & unwanted) == 0) {
            return i;
        }
    }
    return (unwanted != 0) ? memory_type(gpu, allowed, wanted, 0) : UINT32_MAX;
}
