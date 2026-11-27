import * as tapFacts from "./vulkan-buffer-facts.pat";
import type { VulkanDriver } from "./vulkan-driver.js";
import { Draw } from "./vulkan-draw.pat";
import * as imageFacts from "./vulkan-image-facts.pat";

export interface RecordedDraw {
    commandBuffer: NativePointer;
    driver: number;
    pipeline: UInt64;
    topology: number | null;
    vertexInput: UInt64 | null;
    latestVertexInput: VertexInputSource;
    elements: DrawElements;
    indexBuffer: UInt64;
    indexOffset: number;
    indexType: number;
    count: number;
    first: number;
    vertexOffset: number;
    indirectBuffer: UInt64;
    indirectOffset: number;
    drawCount: number;
    indirectStride: number;
    bindings: RecordedBinding[];
    descriptorSets: BoundDescriptorSet[];
}

export interface BoundDescriptorSet {
    index: number;
    set: UInt64;
}

export interface RecordedBinding {
    index: number;
    buffer: UInt64;
    offset: number;
    stride: number | null;
}

export interface BufferFacts {
    size: number;
    memory: UInt64;
    memoryOffset: number;
    order: number;
    backing: MemoryBacking;
    mapped: NativePointer;
    mappedOffset: number;
    mappedSize: number | null;
}

export interface ImageFacts {
    order: number;
    width: number;
    height: number;
    format: number;
    tiling: ImageTiling;
    memory: UInt64;
    memoryOffset: number;
    backing: MemoryBacking;
    mapped: NativePointer;
    mappedOffset: number;
    mappedSize: number | null;
}

export interface ViewFacts {
    image: UInt64;
    format: number;
}

export interface RecordedImageCopy {
    source: UInt64;
    image: UInt64;
    bufferOffset: number;
    rowLength: number;
    imageHeight: number;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface KnownMapping {
    mapped: NativePointer;
    mappedSize: number | null;
}

export interface VulkanTapEvents {
    newDraw(draw: RecordedDraw): void;
    vertexInput(id: UInt64, bindings: NativePointer, bindingCount: number, attributes: NativePointer, attributeCount: number): void;
    copied(source: UInt64, destination: UInt64, sourceOffset: number, destinationOffset: number, size: number): void;
    updated(destination: UInt64, offset: number, size: number, data: NativePointer): void;
    imageCopied(copy: RecordedImageCopy): void;
    unmapping(memory: UInt64, mapped: NativePointer, offset: number, size: number): void;
    named(kind: NamedKind, handle: UInt64, name: string): void;
    forgotten(kind: ObjectKind, handle: UInt64): void;
}

export type VertexInputSource = "pipeline" | "command";

export type DrawElements = "indexed" | "vertices";

export type MemoryBacking = "tracked" | "untracked";

export type ObjectKind = "buffer" | "memory" | "image";

export type NamedKind = Exclude<ObjectKind, "memory">;

export type ImageTiling = "optimal" | "linear";

export type DrawWatch = "observed" | "ignored";

type TapCall =
    | "begin" | "bindPipeline" | "bindVertexBuffers" | "bindVertexBuffers2" | "bindIndexBuffer" | "bindIndexBuffer2"
    | "bindDescriptorSets" | "bindDescriptorSets2" | "setVertexInput" | "setPrimitiveTopology" | "draw" | "drawIndexed"
    | "drawIndirect" | "drawIndexedIndirect" | "drawMulti" | "drawMultiIndexed" | "copyBuffer" | "copyBuffer2" | "copyBufferToImage"
    | "copyBufferToImage2" | "updateBuffer" | "queueSubmit" | "queueSubmit2" | "createBuffer" | "destroyBuffer" | "allocateMemory"
    | "freeMemory" | "bindBufferMemory" | "bindBufferMemory2" | "createImage" | "destroyImage" | "bindImageMemory"
    | "bindImageMemory2" | "createImageView" | "destroyImageView" | "updateDescriptorSets" | "createDescriptorUpdateTemplate"
    | "destroyDescriptorUpdateTemplate" | "updateDescriptorSetWithTemplate" | "mapMemory" | "mapMemory2" | "unmapMemory"
    | "unmapMemory2" | "nameObject" | "deviceActivity";

const tapCalls: [TapCall, string[]][] = [
    ["begin", ["vkBeginCommandBuffer"]],
    ["bindPipeline", ["vkCmdBindPipeline"]],
    ["bindVertexBuffers", ["vkCmdBindVertexBuffers"]],
    ["bindVertexBuffers2", ["vkCmdBindVertexBuffers2", "vkCmdBindVertexBuffers2EXT"]],
    ["bindIndexBuffer", ["vkCmdBindIndexBuffer"]],
    ["bindIndexBuffer2", ["vkCmdBindIndexBuffer2", "vkCmdBindIndexBuffer2KHR"]],
    ["bindDescriptorSets", ["vkCmdBindDescriptorSets"]],
    ["bindDescriptorSets2", ["vkCmdBindDescriptorSets2", "vkCmdBindDescriptorSets2KHR"]],
    ["setVertexInput", ["vkCmdSetVertexInputEXT"]],
    ["setPrimitiveTopology", ["vkCmdSetPrimitiveTopology", "vkCmdSetPrimitiveTopologyEXT"]],
    ["draw", ["vkCmdDraw"]],
    ["drawIndexed", ["vkCmdDrawIndexed"]],
    ["drawIndirect", ["vkCmdDrawIndirect"]],
    ["drawIndexedIndirect", ["vkCmdDrawIndexedIndirect"]],
    ["drawMulti", ["vkCmdDrawMultiEXT"]],
    ["drawMultiIndexed", ["vkCmdDrawMultiIndexedEXT"]],
    ["copyBuffer", ["vkCmdCopyBuffer"]],
    ["copyBuffer2", ["vkCmdCopyBuffer2", "vkCmdCopyBuffer2KHR"]],
    ["copyBufferToImage", ["vkCmdCopyBufferToImage"]],
    ["copyBufferToImage2", ["vkCmdCopyBufferToImage2", "vkCmdCopyBufferToImage2KHR"]],
    ["updateBuffer", ["vkCmdUpdateBuffer"]],
    ["queueSubmit", ["vkQueueSubmit"]],
    ["queueSubmit2", ["vkQueueSubmit2", "vkQueueSubmit2KHR"]],
    ["createBuffer", ["vkCreateBuffer"]],
    ["destroyBuffer", ["vkDestroyBuffer"]],
    ["allocateMemory", ["vkAllocateMemory"]],
    ["freeMemory", ["vkFreeMemory"]],
    ["bindBufferMemory", ["vkBindBufferMemory"]],
    ["bindBufferMemory2", ["vkBindBufferMemory2", "vkBindBufferMemory2KHR"]],
    ["createImage", ["vkCreateImage"]],
    ["destroyImage", ["vkDestroyImage"]],
    ["bindImageMemory", ["vkBindImageMemory"]],
    ["bindImageMemory2", ["vkBindImageMemory2", "vkBindImageMemory2KHR"]],
    ["createImageView", ["vkCreateImageView"]],
    ["destroyImageView", ["vkDestroyImageView"]],
    ["updateDescriptorSets", ["vkUpdateDescriptorSets"]],
    ["createDescriptorUpdateTemplate", ["vkCreateDescriptorUpdateTemplate", "vkCreateDescriptorUpdateTemplateKHR"]],
    ["destroyDescriptorUpdateTemplate", ["vkDestroyDescriptorUpdateTemplate", "vkDestroyDescriptorUpdateTemplateKHR"]],
    ["updateDescriptorSetWithTemplate", ["vkUpdateDescriptorSetWithTemplate", "vkUpdateDescriptorSetWithTemplateKHR"]],
    ["mapMemory", ["vkMapMemory"]],
    ["mapMemory2", ["vkMapMemory2", "vkMapMemory2KHR"]],
    ["unmapMemory", ["vkUnmapMemory"]],
    ["unmapMemory2", ["vkUnmapMemory2", "vkUnmapMemory2KHR"]],
    ["nameObject", ["vkSetDebugUtilsObjectNameEXT"]],
    ["deviceActivity", ["vkWaitForFences", "vkResetFences", "vkWaitSemaphores", "vkWaitSemaphoresKHR"]],
];

const callsWithResults = new Set<TapCall>(["createBuffer", "allocateMemory", "createImage", "createImageView",
    "createDescriptorUpdateTemplate", "mapMemory", "mapMemory2"]);

export const tapEntryPointNames = tapCalls.flatMap(([, names]) => names);

const UNSET = uint64("0xffffffffffffffff");
const ALL_BINDINGS = 0xffffffff;
const LARGEST_BUFFER_COUNT = 65536;
const LARGEST_MAPPING_COUNT = 16384;
const SET_BINDING_COUNT = 32;
const LINEAR_TILING = 1;
const objectKinds = new Map<number, ObjectKind>([[8, "memory"], [9, "buffer"], [10, "image"]]);
const objectTypes: Record<NamedKind, number> = { buffer: 9, image: 10 };
const drawWatches: Record<DrawWatch, number> = { ignored: 0, observed: 1 };

const declarations = `
#include <gum/guminterceptor.h>
#include <gum/gumtls.h>
#include <string.h>

#define BINDING_COUNT 32
#define SET_COUNT 8
#define SET_BINDING_COUNT 32
#define RECORDING_CAPACITY 256
#define COPY_CAPACITY 32
#define IMAGE_COPY_CAPACITY 16
#define SEEN_CAPACITY 65536
#define PIPELINE_CAPACITY 4096
#define BUFFER_CAPACITY 65536
#define MEMORY_CAPACITY 16384
#define IMAGE_CAPACITY 65536
#define VIEW_CAPACITY 65536
#define DESCRIPTOR_SET_CAPACITY 32768
#define TEMPLATE_CAPACITY 4096
#define TEMPLATE_IMAGE_CAPACITY 8
#define DEVICE_CAPACITY 16

typedef struct
{
  guint64 buffer;
  guint64 offset;
  guint64 stride;
} Binding;

typedef struct
{
  guint64 source;
  guint64 destination;
  guint64 source_offset;
  guint64 destination_offset;
  guint64 size;
} Copy;

typedef struct
{
  guint64 source;
  guint64 image;
  guint64 buffer_offset;
  guint64 row_length;
  guint64 image_height;
  guint64 x;
  guint64 y;
  guint64 width;
  guint64 height;
} ImageCopy;

typedef struct
{
  gpointer command_buffer;
  guint64 driver;
  guint64 begun;
  guint64 pipeline;
  guint64 topology;
  guint64 vertex_input;
  guint64 latest_vertex_input;
  guint64 index_buffer;
  guint64 index_offset;
  guint64 index_type;
  guint32 bound;
  guint32 copy_count;
  guint32 bound_sets;
  guint32 image_copy_count;
  Binding bindings[BINDING_COUNT];
  guint64 descriptor_sets[SET_COUNT];
  Copy copies[COPY_CAPACITY];
  ImageCopy image_copies[IMAGE_COPY_CAPACITY];
} Recording;

typedef struct
{
  guint64 handle;
  guint64 size;
  guint64 usage;
  guint64 memory;
  guint64 memory_offset;
  guint64 order;
  guint64 flags;
} BufferEntry;

typedef struct
{
  guint64 handle;
  guint64 size;
  gpointer mapped;
  guint64 mapped_offset;
  guint64 mapped_size;
  guint64 flags;
} MemoryEntry;

typedef struct
{
  guint64 handle;
  guint64 order;
  guint64 width;
  guint64 height;
  guint64 format;
  guint64 tiling;
  guint64 memory;
  guint64 memory_offset;
  guint64 flags;
} ImageEntry;

typedef struct
{
  guint64 handle;
  guint64 image;
  guint64 format;
} ViewEntry;

typedef struct
{
  guint64 handle;
  guint64 views[SET_BINDING_COUNT];
} DescriptorSetEntry;

typedef struct
{
  guint64 binding;
  guint64 offset;
} TemplateImage;

typedef struct
{
  guint64 handle;
  guint64 count;
  TemplateImage images[TEMPLATE_IMAGE_CAPACITY];
} TemplateEntry;

typedef struct
{
  gpointer key;
  gpointer device;
  guint64 driver;
} DeviceEntry;

typedef struct
{
  GMutex lock;
  GCond idle;
  guint callbacks_running;
  GumTlsKey current;
  guint64 clock;
  guint64 next_order;
  guint draw_watch;
  guint seen_count;
  guint buffer_count;
  guint memory_count;
  guint image_count;
  guint view_count;
  guint set_count;
  guint template_count;
  Recording recordings[RECORDING_CAPACITY];
  guint64 seen[SEEN_CAPACITY];
  guint64 pipelines[PIPELINE_CAPACITY];
  guint32 pipeline_bindings[PIPELINE_CAPACITY];
  guint32 pipeline_generations[PIPELINE_CAPACITY];
  BufferEntry buffers[BUFFER_CAPACITY];
  MemoryEntry memories[MEMORY_CAPACITY];
  ImageEntry images[IMAGE_CAPACITY];
  ViewEntry views[VIEW_CAPACITY];
  DescriptorSetEntry sets[DESCRIPTOR_SET_CAPACITY];
  TemplateEntry templates[TEMPLATE_CAPACITY];
  DeviceEntry devices[DEVICE_CAPACITY];
} Tap;
`;

const sizeSource = `${declarations}
guint64 tap_size (void)
{
  return sizeof (Tap);
}
`;

const source = `${declarations}
#define ALL_BINDINGS 0xffffffffu
#define UNSET 0xffffffffffffffffull
#define WHOLE_SIZE 0xffffffffffffffffull
#define SUCCESS 0
#define GRAPHICS_BIND_POINT 0
#define FRAGMENT_STAGE 0x10
#define MEMORY_OBJECT 8
#define BUFFER_OBJECT 9
#define IMAGE_OBJECT 10
#define GEOMETRY_USAGE (0x1 | 0x40 | 0x80)
#define LINEAR_TILING 1
#define COMBINED_IMAGE_SAMPLER 1
#define SAMPLED_IMAGE 2
#define DESCRIPTOR_SET_TEMPLATE 0
#define LARGEST_SHADOWED_MAPPING (64 * 1048576)
#define HOLDS_GEOMETRY 1
#define KNOWN_TO_SCRIPT 2
#define HOLDS_TEXELS 4
#define TAG_DRAW 0x6472617700000000ull
#define TAG_COPY 0x636f707900000000ull
#define TAG_IMAGE_COPY 0x696d677900000000ull
#define TAG_UPDATE 0x7570647400000000ull
#define TAG_VERTEX_INPUT 0x76696e7000000000ull

#define ARG(n) ((guint64) gum_invocation_context_get_nth_argument (ic, n))
#define POINTER_ARG(n) gum_invocation_context_get_nth_argument (ic, n)
#define FIND_BUFFER(handle) ((BufferEntry *) entry_find (tap.buffers, sizeof (BufferEntry), BUFFER_CAPACITY, handle))
#define INSERT_BUFFER(handle) \\
    ((BufferEntry *) entry_insert (tap.buffers, sizeof (BufferEntry), BUFFER_CAPACITY, &tap.buffer_count, handle))
#define FIND_MEMORY(handle) ((MemoryEntry *) entry_find (tap.memories, sizeof (MemoryEntry), MEMORY_CAPACITY, handle))
#define INSERT_MEMORY(handle) \\
    ((MemoryEntry *) entry_insert (tap.memories, sizeof (MemoryEntry), MEMORY_CAPACITY, &tap.memory_count, handle))
#define FIND_IMAGE(handle) ((ImageEntry *) entry_find (tap.images, sizeof (ImageEntry), IMAGE_CAPACITY, handle))
#define INSERT_IMAGE(handle) \\
    ((ImageEntry *) entry_insert (tap.images, sizeof (ImageEntry), IMAGE_CAPACITY, &tap.image_count, handle))
#define FIND_VIEW(handle) ((ViewEntry *) entry_find (tap.views, sizeof (ViewEntry), VIEW_CAPACITY, handle))
#define INSERT_VIEW(handle) ((ViewEntry *) entry_insert (tap.views, sizeof (ViewEntry), VIEW_CAPACITY, &tap.view_count, handle))
#define FIND_SET(handle) \\
    ((DescriptorSetEntry *) entry_find (tap.sets, sizeof (DescriptorSetEntry), DESCRIPTOR_SET_CAPACITY, handle))
#define INSERT_SET(handle) \\
    ((DescriptorSetEntry *) entry_insert (tap.sets, sizeof (DescriptorSetEntry), DESCRIPTOR_SET_CAPACITY, &tap.set_count, handle))
#define FIND_TEMPLATE(handle) ((TemplateEntry *) entry_find (tap.templates, sizeof (TemplateEntry), TEMPLATE_CAPACITY, handle))
#define INSERT_TEMPLATE(handle) \\
    ((TemplateEntry *) entry_insert (tap.templates, sizeof (TemplateEntry), TEMPLATE_CAPACITY, &tap.template_count, handle))

enum { DRAWS_IGNORED, DRAWS_OBSERVED };
enum { VERTICES, INDEXED };
enum { VERTEX_INPUT_FROM_PIPELINE, VERTEX_INPUT_FROM_COMMAND };
enum { BACKING_UNTRACKED, BACKING_TRACKED };

typedef enum { EXISTING_RECORDING, CLAIMED_RECORDING } RecordingLookup;

enum
{
  BEGIN = 1,
  BIND_PIPELINE,
  BIND_VERTEX_BUFFERS,
  BIND_VERTEX_BUFFERS2,
  BIND_INDEX_BUFFER,
  BIND_INDEX_BUFFER2,
  BIND_DESCRIPTOR_SETS,
  BIND_DESCRIPTOR_SETS2,
  SET_VERTEX_INPUT,
  SET_PRIMITIVE_TOPOLOGY,
  DRAW,
  DRAW_INDEXED,
  DRAW_INDIRECT,
  DRAW_INDEXED_INDIRECT,
  DRAW_MULTI,
  DRAW_MULTI_INDEXED,
  COPY_BUFFER,
  COPY_BUFFER2,
  COPY_BUFFER_TO_IMAGE,
  COPY_BUFFER_TO_IMAGE2,
  UPDATE_BUFFER,
  QUEUE_SUBMIT,
  QUEUE_SUBMIT2,
  CREATE_BUFFER,
  DESTROY_BUFFER,
  ALLOCATE_MEMORY,
  FREE_MEMORY,
  BIND_BUFFER_MEMORY,
  BIND_BUFFER_MEMORY2,
  CREATE_IMAGE,
  DESTROY_IMAGE,
  BIND_IMAGE_MEMORY,
  BIND_IMAGE_MEMORY2,
  CREATE_IMAGE_VIEW,
  DESTROY_IMAGE_VIEW,
  UPDATE_DESCRIPTOR_SETS,
  CREATE_DESCRIPTOR_UPDATE_TEMPLATE,
  DESTROY_DESCRIPTOR_UPDATE_TEMPLATE,
  UPDATE_DESCRIPTOR_SET_WITH_TEMPLATE,
  MAP_MEMORY,
  MAP_MEMORY2,
  UNMAP_MEMORY,
  UNMAP_MEMORY2,
  NAME_OBJECT,
  DEVICE_ACTIVITY
};

typedef struct
{
  gpointer command_buffer;
  guint64 driver;
  guint64 pipeline;
  guint64 topology;
  guint64 vertex_input;
  guint64 latest_vertex_input;
  guint64 elements;
  guint64 index_buffer;
  guint64 index_offset;
  guint64 index_type;
  guint64 count;
  guint64 first;
  gint64 vertex_offset;
  guint64 indirect_buffer;
  guint64 indirect_offset;
  guint64 draw_count;
  guint64 indirect_stride;
  guint64 bound_sets;
  guint64 descriptor_sets[SET_COUNT];
  guint64 bound;
  Binding bindings[BINDING_COUNT];
} Draw;

typedef struct
{
  guint64 size;
  guint64 memory;
  guint64 memory_offset;
  guint64 order;
  guint64 backing;
  gpointer mapped;
  guint64 mapped_offset;
  guint64 mapped_size;
} BufferFacts;

typedef struct
{
  guint64 order;
  guint64 width;
  guint64 height;
  guint64 format;
  guint64 tiling;
  guint64 memory;
  guint64 memory_offset;
  guint64 backing;
  gpointer mapped;
  guint64 mapped_offset;
  guint64 mapped_size;
} ImageFacts;

typedef struct
{
  guint64 image;
  guint64 format;
} ViewFacts;

typedef struct
{
  gpointer mapped;
  guint64 mapped_size;
} Mapping;

typedef struct
{
  gpointer out;
  gconstpointer info;
  guint64 size;
  guint64 usage;
  guint64 memory;
  guint64 offset;
} Pending;

typedef struct { gint32 type; gconstpointer next; guint32 flags; guint64 size; guint32 usage; } BufferCreateInfo;
typedef struct { gint32 type; gconstpointer next; guint64 size; guint32 type_index; } MemoryAllocateInfo;
typedef struct { gint32 type; gconstpointer next; guint64 object; guint64 memory; guint64 offset; } BindMemoryInfo;
typedef struct { gint32 type; gconstpointer next; guint32 flags; guint32 image_type; guint32 format; guint32 width; guint32 height;
    guint32 depth; guint32 mip_levels; guint32 array_layers; guint32 samples; guint32 tiling; } ImageCreateInfo;
typedef struct { gint32 type; gconstpointer next; guint32 flags; guint64 image; guint32 view_type; guint32 format; } ImageViewCreateInfo;
typedef struct { guint64 sampler; guint64 view; guint32 layout; } DescriptorImageInfo;
typedef struct { gint32 type; gconstpointer next; guint64 set; guint32 binding; guint32 element; guint32 count; guint32 descriptor_type;
    const DescriptorImageInfo * images; gconstpointer buffers; gconstpointer texel_views; } WriteDescriptorSet;
typedef struct { gint32 type; gconstpointer next; guint64 source; guint32 source_binding; guint32 source_element; guint64 destination;
    guint32 destination_binding; guint32 destination_element; guint32 count; } CopyDescriptorSet;
typedef struct { guint32 binding; guint32 element; guint32 count; guint32 descriptor_type; gsize offset; gsize stride; } TemplateEntryInfo;
typedef struct { gint32 type; gconstpointer next; guint32 flags; guint32 entry_count; const TemplateEntryInfo * entries;
    guint32 template_type; } TemplateCreateInfo;
typedef struct { gint32 type; gconstpointer next; guint32 stage_flags; guint64 layout; guint32 first_set; guint32 count;
    const guint64 * sets; } BindDescriptorSetsInfo;
typedef struct { guint64 buffer_offset; guint32 row_length; guint32 image_height; guint32 aspect; guint32 mip_level; guint32 base_layer;
    guint32 layer_count; gint32 x; gint32 y; gint32 z; guint32 width; guint32 height; guint32 depth; } BufferImageCopy;
typedef struct { gint32 type; gconstpointer next; BufferImageCopy region; } BufferImageCopy2;
typedef struct { gint32 type; gconstpointer next; guint64 source; guint64 image; guint32 layout; guint32 count;
    const BufferImageCopy2 * regions; } CopyBufferToImageInfo2;
typedef struct { gint32 type; gconstpointer next; guint32 flags; guint64 memory; guint64 offset; guint64 size; } MemoryMapInfo;
typedef struct { gint32 type; gconstpointer next; guint32 flags; guint64 memory; } MemoryUnmapInfo;
typedef struct { gint32 type; gconstpointer next; guint32 object_type; guint64 handle; const gchar * name; } ObjectNameInfo;
typedef struct { guint64 source_offset; guint64 destination_offset; guint64 size; } BufferCopy;
typedef struct { gint32 type; gconstpointer next; guint64 source_offset; guint64 destination_offset; guint64 size; } BufferCopy2;
typedef struct { gint32 type; gconstpointer next; guint64 source; guint64 destination; guint32 count; const BufferCopy2 * regions; }
    CopyBufferInfo2;
typedef struct { gint32 type; gconstpointer next; guint32 binding; guint32 stride; guint32 input_rate; guint32 divisor; }
    VertexBinding2;
typedef struct { gint32 type; gconstpointer next; guint32 location; guint32 binding; guint32 format; guint32 offset; }
    VertexAttribute2;
typedef struct { guint32 first_vertex; guint32 vertex_count; } MultiDrawInfo;
typedef struct { guint32 first_index; guint32 index_count; gint32 vertex_offset; } MultiDrawIndexedInfo;
typedef struct { gint32 type; gconstpointer next; guint32 wait_count; gconstpointer waits; gconstpointer wait_stages;
    guint32 command_buffer_count; const gpointer * command_buffers; guint32 signal_count; gconstpointer signals; } SubmitInfo;
typedef struct { gint32 type; gconstpointer next; gpointer command_buffer; guint32 device_mask; } CommandBufferSubmitInfo;
typedef struct { gint32 type; gconstpointer next; guint32 flags; guint32 wait_count; gconstpointer waits;
    guint32 command_buffer_count; const CommandBufferSubmitInfo * command_buffers; guint32 signal_count; gconstpointer signals; }
    SubmitInfo2;

extern Tap tap;
extern void deliver_new_draw (Draw * draw);
extern void deliver_vertex_input (guint64 id, const VertexBinding2 * bindings, guint32 binding_count, const VertexAttribute2 * attributes,
    guint32 attribute_count);
extern void deliver_copied (guint64 source, guint64 destination, guint64 source_offset, guint64 destination_offset, guint64 size);
extern void deliver_updated (guint64 destination, guint64 offset, guint64 size, gconstpointer data);
extern void deliver_image_copied (const ImageCopy * copy);
extern void deliver_unmapping (guint64 memory, gpointer mapped, guint64 offset, guint64 size);
extern void deliver_named (guint64 kind, guint64 handle, const gchar * name);
extern void deliver_forgotten (guint64 kind, guint64 handle);

static void on_recording_call (GumInvocationContext * ic, guint call, guint driver);
static void on_submission (GumInvocationContext * ic, guint call);
static void on_object_call (GumInvocationContext * ic, guint call, guint driver);
static void create_image (guint64 handle, const ImageCreateInfo * info);
static void create_view (guint64 handle, const ImageViewCreateInfo * info);
static void create_template (guint64 handle, const TemplateCreateInfo * info);
static void map_memory (guint64 memory, gpointer mapped, guint64 offset, guint64 size);
static gboolean mark_known_locked (guint64 object_type, guint64 handle);
static void bind_vertex_buffer (Recording * recording, guint64 index, guint64 buffer, guint64 offset, guint64 stride);
static void bind_descriptor_sets (Recording * recording, guint32 first, guint32 count, const guint64 * sets);
static void set_vertex_input (Recording * recording, guint32 binding_count, const VertexBinding2 * bindings, guint32 attribute_count,
    const VertexAttribute2 * attributes);
static void draw_direct (Recording * recording, guint64 elements, guint64 count, guint64 first, gint64 vertex_offset);
static void draw_indirect (Recording * recording, guint64 elements, guint64 buffer, guint64 offset, guint64 count, guint64 stride);
static void note_copy (Recording * recording, guint64 source, guint64 destination, guint64 source_offset, guint64 destination_offset,
    guint64 size);
static void note_image_copy (Recording * recording, guint64 source, guint64 image, const BufferImageCopy * region);
static void submitted (gpointer command_buffer);
static Recording * recording_of (gpointer command_buffer, guint driver, RecordingLookup lookup);
static void reset_recording (Recording * recording);
static gboolean remember_locked (guint64 key);
static void note_device (gpointer device, guint driver);
static void destroy_buffer (guint64 buffer);
static void free_memory (guint64 memory);
static void bind_buffer_memory (guint64 buffer, guint64 memory, guint64 offset);
static void destroy_image (guint64 image);
static void bind_image_memory (guint64 image, guint64 memory, guint64 offset);
static void destroy_view (guint64 view);
static void update_descriptor_sets (guint32 write_count, const WriteDescriptorSet * writes, guint32 copy_count,
    const CopyDescriptorSet * copies);
static void destroy_template (guint64 handle);
static void update_with_template (guint64 set, guint64 handle, gconstpointer data);
static void unmap_memory (guint64 memory);
static void name_object (const ObjectNameInfo * info);
static void record_draw (Recording * recording, Draw * draw);
static void on_new_draw (Draw * draw);
static void on_vertex_input (guint64 id, const VertexBinding2 * bindings, guint32 binding_count, const VertexAttribute2 * attributes,
    guint32 attribute_count);
static void on_copied (guint64 source, guint64 destination, guint64 source_offset, guint64 destination_offset, guint64 size);
static void on_updated (guint64 destination, guint64 offset, guint64 size, gconstpointer data);
static void on_image_copied (const ImageCopy * copy);
static void on_unmapping (guint64 memory, gpointer mapped, guint64 offset, guint64 size);
static void on_named (guint64 kind, guint64 handle, const gchar * name);
static void on_forgotten (guint64 kind, guint64 handle);
static void enter_js (void);
static void leave_js (void);
static gboolean remember (guint64 key);
static void entry_remove (gpointer table, gsize entry_size, guint capacity, guint * count, guint64 * entry);
static gboolean holds_geometry (guint64 usage);
static void set_descriptor (guint64 set, guint32 binding, guint64 view);
static gboolean is_image_descriptor (guint32 descriptor_type);
static guint claim_pipeline (guint64 pipeline);
static guint find_pipeline (guint64 pipeline);
static gpointer entry_find (gpointer table, gsize entry_size, guint capacity, guint64 handle);
static gpointer entry_insert (gpointer table, gsize entry_size, guint capacity, guint * count, guint64 handle);
static guint home_of (guint64 handle, guint capacity);
static guint64 mix (guint64 hash, guint64 value);

void init (void)
{
  g_mutex_init (&tap.lock);
  g_cond_init (&tap.idle);
  tap.current = gum_tls_key_new ();
}

void finalize (void)
{
  gum_tls_key_free (tap.current);
  g_cond_clear (&tap.idle);
  g_mutex_clear (&tap.lock);
}

void on_enter (GumInvocationContext * ic)
{
  guint data = GUM_IC_GET_FUNC_DATA (ic, guintptr);
  guint call = data & 0xff, driver = data >> 8;

  if (call <= UPDATE_BUFFER)
    on_recording_call (ic, call, driver);
  else if (call <= QUEUE_SUBMIT2)
    on_submission (ic, call);
  else
    on_object_call (ic, call, driver);
}

void on_leave (GumInvocationContext * ic)
{
  guint data = GUM_IC_GET_FUNC_DATA (ic, guintptr);
  guint call = data & 0xff;
  Pending * pending = GUM_IC_GET_INVOCATION_DATA (ic, Pending);
  gint32 result = (gint32) (gsize) gum_invocation_context_get_return_value (ic);
  BufferEntry * buffer;
  MemoryEntry * memory;

  if (result != SUCCESS)
    return;
  switch (call)
  {
    case CREATE_BUFFER:
      g_mutex_lock (&tap.lock);
      buffer = INSERT_BUFFER (*(guint64 *) pending->out);
      if (buffer != NULL)
      {
        buffer->size = pending->size;
        buffer->usage = pending->usage;
        buffer->order = ++tap.next_order;
      }
      g_mutex_unlock (&tap.lock);
      return;
    case ALLOCATE_MEMORY:
      g_mutex_lock (&tap.lock);
      memory = INSERT_MEMORY (*(guint64 *) pending->out);
      if (memory != NULL)
        memory->size = pending->size;
      g_mutex_unlock (&tap.lock);
      return;
    case CREATE_IMAGE:
      create_image (*(guint64 *) pending->out, pending->info);
      return;
    case CREATE_IMAGE_VIEW:
      create_view (*(guint64 *) pending->out, pending->info);
      return;
    case CREATE_DESCRIPTOR_UPDATE_TEMPLATE:
      create_template (*(guint64 *) pending->out, pending->info);
      return;
    case MAP_MEMORY:
    case MAP_MEMORY2:
      map_memory (pending->memory, *(gpointer *) pending->out, pending->offset, pending->size);
      return;
  }
}

guint8 describe_buffer (guint64 handle, BufferFacts * facts)
{
  BufferEntry * entry;
  MemoryEntry * backing;
  gboolean found;

  memset (facts, 0, sizeof (BufferFacts));
  g_mutex_lock (&tap.lock);
  entry = FIND_BUFFER (handle);
  found = entry != NULL;
  if (found)
  {
    facts->size = entry->size;
    facts->memory = entry->memory;
    facts->memory_offset = entry->memory_offset;
    facts->order = entry->order;
    backing = (entry->memory != 0) ? FIND_MEMORY (entry->memory) : NULL;
    if (backing != NULL)
    {
      facts->backing = BACKING_TRACKED;
      facts->mapped = backing->mapped;
      facts->mapped_offset = backing->mapped_offset;
      facts->mapped_size = backing->mapped_size;
    }
  }
  g_mutex_unlock (&tap.lock);
  return found;
}

guint8 describe_image (guint64 handle, ImageFacts * facts)
{
  ImageEntry * entry;
  MemoryEntry * backing;
  gboolean found;

  memset (facts, 0, sizeof (ImageFacts));
  g_mutex_lock (&tap.lock);
  entry = FIND_IMAGE (handle);
  found = entry != NULL;
  if (found)
  {
    facts->order = entry->order;
    facts->width = entry->width;
    facts->height = entry->height;
    facts->format = entry->format;
    facts->tiling = entry->tiling;
    facts->memory = entry->memory;
    facts->memory_offset = entry->memory_offset;
    backing = (entry->memory != 0) ? FIND_MEMORY (entry->memory) : NULL;
    if (backing != NULL)
    {
      facts->backing = BACKING_TRACKED;
      facts->mapped = backing->mapped;
      facts->mapped_offset = backing->mapped_offset;
      facts->mapped_size = backing->mapped_size;
    }
  }
  g_mutex_unlock (&tap.lock);
  return found;
}

guint8 describe_view (guint64 handle, ViewFacts * facts)
{
  ViewEntry * entry;
  gboolean found;

  g_mutex_lock (&tap.lock);
  entry = FIND_VIEW (handle);
  found = entry != NULL;
  if (found)
  {
    facts->image = entry->image;
    facts->format = entry->format;
  }
  g_mutex_unlock (&tap.lock);
  return found;
}

guint8 describe_descriptor_set (guint64 handle, guint64 * views)
{
  DescriptorSetEntry * entry;
  gboolean found;

  g_mutex_lock (&tap.lock);
  entry = FIND_SET (handle);
  found = entry != NULL;
  if (found)
    memcpy (views, entry->views, sizeof (entry->views));
  g_mutex_unlock (&tap.lock);
  return found;
}

void mark_known (guint64 object_type, guint64 handle)
{
  g_mutex_lock (&tap.lock);
  mark_known_locked (object_type, handle);
  g_mutex_unlock (&tap.lock);
}

guint list_buffers (guint64 memory, guint64 * handles, guint capacity)
{
  guint count = 0, i;
  g_mutex_lock (&tap.lock);
  for (i = 0; i != BUFFER_CAPACITY && count != capacity; i++)
  {
    const BufferEntry * entry = &tap.buffers[i];
    if (entry->handle != 0 && entry->memory != 0 && (memory == 0 || entry->memory == memory))
      handles[count++] = entry->handle;
  }
  g_mutex_unlock (&tap.lock);
  return count;
}

guint list_mappings (Mapping * mappings, guint capacity)
{
  guint count = 0, i;
  g_mutex_lock (&tap.lock);
  for (i = 0; i != MEMORY_CAPACITY && count != capacity; i++)
  {
    const MemoryEntry * entry = &tap.memories[i];
    if (entry->handle != 0 && entry->mapped != NULL)
    {
      mappings[count].mapped = entry->mapped;
      mappings[count].mapped_size = entry->mapped_size;
      count++;
    }
  }
  g_mutex_unlock (&tap.lock);
  return count;
}

gpointer device_for (gpointer key, guint64 * driver)
{
  guint i;
  for (i = 0; i != DEVICE_CAPACITY; i++)
  {
    if (tap.devices[i].key == key)
    {
      *driver = tap.devices[i].driver;
      return tap.devices[i].device;
    }
  }
  return NULL;
}

void set_draw_watch (guint draw_watch)
{
  tap.draw_watch = draw_watch;
}

void set_pipeline_bindings (guint64 pipeline, guint32 bindings)
{
  guint index;
  g_mutex_lock (&tap.lock);
  index = claim_pipeline (pipeline);
  if (index != PIPELINE_CAPACITY)
    tap.pipeline_bindings[index] = bindings;
  g_mutex_unlock (&tap.lock);
}

void renew_pipeline (guint64 pipeline, guint32 bindings)
{
  guint index;
  g_mutex_lock (&tap.lock);
  index = claim_pipeline (pipeline);
  if (index != PIPELINE_CAPACITY)
  {
    tap.pipeline_bindings[index] = bindings;
    tap.pipeline_generations[index]++;
  }
  g_mutex_unlock (&tap.lock);
}

void wait_until_idle (void)
{
  g_mutex_lock (&tap.lock);
  while (tap.callbacks_running != 0)
    g_cond_wait (&tap.idle, &tap.lock);
  g_mutex_unlock (&tap.lock);
}

static void on_recording_call (GumInvocationContext * ic, guint call, guint driver)
{
  Recording * recording = recording_of (POINTER_ARG (0), driver, CLAIMED_RECORDING);
  guint32 i, count;

  switch (call)
  {
    case BEGIN:
      reset_recording (recording);
      recording->driver = driver;
      g_mutex_lock (&tap.lock);
      recording->begun = ++tap.clock;
      g_mutex_unlock (&tap.lock);
      return;
    case BIND_PIPELINE:
      if (ARG (1) == GRAPHICS_BIND_POINT)
      {
        recording->pipeline = ARG (2);
        recording->latest_vertex_input = VERTEX_INPUT_FROM_PIPELINE;
      }
      return;
    case BIND_VERTEX_BUFFERS:
    case BIND_VERTEX_BUFFERS2:
    {
      guint64 first = ARG (1) & 0xffffffff;
      const guint64 * buffers = POINTER_ARG (3);
      const guint64 * offsets = POINTER_ARG (4);
      const guint64 * strides = (call == BIND_VERTEX_BUFFERS2) ? POINTER_ARG (6) : NULL;
      count = ARG (2) & 0xffffffff;
      for (i = 0; i != count; i++)
        bind_vertex_buffer (recording, first + i, buffers[i], offsets[i], (strides != NULL) ? strides[i] : UNSET);
      return;
    }
    case BIND_INDEX_BUFFER:
      recording->index_buffer = ARG (1);
      recording->index_offset = ARG (2);
      recording->index_type = ARG (3) & 0xffffffff;
      return;
    case BIND_INDEX_BUFFER2:
      recording->index_buffer = ARG (1);
      recording->index_offset = ARG (2);
      recording->index_type = ARG (4) & 0xffffffff;
      return;
    case BIND_DESCRIPTOR_SETS:
      if (ARG (1) == GRAPHICS_BIND_POINT)
        bind_descriptor_sets (recording, ARG (3) & 0xffffffff, ARG (4) & 0xffffffff, POINTER_ARG (5));
      return;
    case BIND_DESCRIPTOR_SETS2:
    {
      const BindDescriptorSetsInfo * info = POINTER_ARG (1);
      if ((info->stage_flags & FRAGMENT_STAGE) != 0)
        bind_descriptor_sets (recording, info->first_set, info->count, info->sets);
      return;
    }
    case SET_VERTEX_INPUT:
      set_vertex_input (recording, ARG (1) & 0xffffffff, POINTER_ARG (2), ARG (3) & 0xffffffff, POINTER_ARG (4));
      return;
    case SET_PRIMITIVE_TOPOLOGY:
      recording->topology = ARG (1) & 0xffffffff;
      return;
    case DRAW:
      if ((ARG (2) & 0xffffffff) != 0)
        draw_direct (recording, VERTICES, ARG (1) & 0xffffffff, ARG (3) & 0xffffffff, 0);
      return;
    case DRAW_INDEXED:
      if ((ARG (2) & 0xffffffff) != 0)
        draw_direct (recording, INDEXED, ARG (1) & 0xffffffff, ARG (3) & 0xffffffff, (gint32) ARG (4));
      return;
    case DRAW_INDIRECT:
    case DRAW_INDEXED_INDIRECT:
      draw_indirect (recording, (call == DRAW_INDEXED_INDIRECT) ? INDEXED : VERTICES, ARG (1), ARG (2), ARG (3) & 0xffffffff,
          ARG (4) & 0xffffffff);
      return;
    case DRAW_MULTI:
    {
      const guint8 * infos = POINTER_ARG (2);
      guint32 stride = ARG (5) & 0xffffffff;
      count = ARG (1) & 0xffffffff;
      if ((ARG (3) & 0xffffffff) == 0)
        return;
      for (i = 0; i != count; i++)
      {
        const MultiDrawInfo * info = (const MultiDrawInfo *) (infos + i * stride);
        draw_direct (recording, VERTICES, info->vertex_count, info->first_vertex, 0);
      }
      return;
    }
    case DRAW_MULTI_INDEXED:
    {
      const guint8 * infos = POINTER_ARG (2);
      guint32 stride = ARG (5) & 0xffffffff;
      const gint32 * shared_offset = POINTER_ARG (6);
      count = ARG (1) & 0xffffffff;
      if ((ARG (3) & 0xffffffff) == 0)
        return;
      for (i = 0; i != count; i++)
      {
        const MultiDrawIndexedInfo * info = (const MultiDrawIndexedInfo *) (infos + i * stride);
        draw_direct (recording, INDEXED, info->index_count, info->first_index,
            (shared_offset != NULL) ? *shared_offset : info->vertex_offset);
      }
      return;
    }
    case COPY_BUFFER:
    {
      const BufferCopy * regions = POINTER_ARG (4);
      count = ARG (3) & 0xffffffff;
      for (i = 0; i != count; i++)
        note_copy (recording, ARG (1), ARG (2), regions[i].source_offset, regions[i].destination_offset, regions[i].size);
      return;
    }
    case COPY_BUFFER2:
    {
      const CopyBufferInfo2 * info = POINTER_ARG (1);
      for (i = 0; i != info->count; i++)
        note_copy (recording, info->source, info->destination, info->regions[i].source_offset, info->regions[i].destination_offset,
            info->regions[i].size);
      return;
    }
    case COPY_BUFFER_TO_IMAGE:
    {
      const BufferImageCopy * regions = POINTER_ARG (5);
      count = ARG (4) & 0xffffffff;
      for (i = 0; i != count; i++)
        note_image_copy (recording, ARG (1), ARG (2), &regions[i]);
      return;
    }
    case COPY_BUFFER_TO_IMAGE2:
    {
      const CopyBufferToImageInfo2 * info = POINTER_ARG (1);
      for (i = 0; i != info->count; i++)
        note_image_copy (recording, info->source, info->image, &info->regions[i].region);
      return;
    }
    case UPDATE_BUFFER:
      if (remember_locked (mix (mix (mix (TAG_UPDATE, ARG (1)), ARG (2)), ARG (3))))
        on_updated (ARG (1), ARG (2), ARG (3), POINTER_ARG (4));
      return;
  }
}

static void on_submission (GumInvocationContext * ic, guint call)
{
  guint32 submit_count = ARG (1) & 0xffffffff, i, j;

  if (call == QUEUE_SUBMIT)
  {
    const SubmitInfo * submits = POINTER_ARG (2);
    for (i = 0; i != submit_count; i++)
      for (j = 0; j != submits[i].command_buffer_count; j++)
        submitted (submits[i].command_buffers[j]);
  }
  else
  {
    const SubmitInfo2 * submits = POINTER_ARG (2);
    for (i = 0; i != submit_count; i++)
      for (j = 0; j != submits[i].command_buffer_count; j++)
        submitted (submits[i].command_buffers[j].command_buffer);
  }
}

static void on_object_call (GumInvocationContext * ic, guint call, guint driver)
{
  Pending * pending;
  guint32 i, count;

  switch (call)
  {
    case CREATE_BUFFER:
    {
      const BufferCreateInfo * info = POINTER_ARG (1);
      note_device (POINTER_ARG (0), driver);
      pending = GUM_IC_GET_INVOCATION_DATA (ic, Pending);
      pending->out = POINTER_ARG (3);
      pending->size = info->size;
      pending->usage = info->usage;
      return;
    }
    case DESTROY_BUFFER:
      if (ARG (1) != 0)
        destroy_buffer (ARG (1));
      return;
    case ALLOCATE_MEMORY:
      note_device (POINTER_ARG (0), driver);
      pending = GUM_IC_GET_INVOCATION_DATA (ic, Pending);
      pending->out = POINTER_ARG (3);
      pending->size = ((const MemoryAllocateInfo *) POINTER_ARG (1))->size;
      return;
    case FREE_MEMORY:
      if (ARG (1) != 0)
        free_memory (ARG (1));
      return;
    case BIND_BUFFER_MEMORY:
      note_device (POINTER_ARG (0), driver);
      bind_buffer_memory (ARG (1), ARG (2), ARG (3));
      return;
    case BIND_BUFFER_MEMORY2:
    {
      const BindMemoryInfo * infos = POINTER_ARG (2);
      note_device (POINTER_ARG (0), driver);
      count = ARG (1) & 0xffffffff;
      for (i = 0; i != count; i++)
        bind_buffer_memory (infos[i].object, infos[i].memory, infos[i].offset);
      return;
    }
    case CREATE_IMAGE:
    case CREATE_IMAGE_VIEW:
    case CREATE_DESCRIPTOR_UPDATE_TEMPLATE:
      note_device (POINTER_ARG (0), driver);
      pending = GUM_IC_GET_INVOCATION_DATA (ic, Pending);
      pending->info = POINTER_ARG (1);
      pending->out = POINTER_ARG (3);
      return;
    case DESTROY_IMAGE:
      if (ARG (1) != 0)
        destroy_image (ARG (1));
      return;
    case BIND_IMAGE_MEMORY:
      note_device (POINTER_ARG (0), driver);
      bind_image_memory (ARG (1), ARG (2), ARG (3));
      return;
    case BIND_IMAGE_MEMORY2:
    {
      const BindMemoryInfo * infos = POINTER_ARG (2);
      note_device (POINTER_ARG (0), driver);
      count = ARG (1) & 0xffffffff;
      for (i = 0; i != count; i++)
        bind_image_memory (infos[i].object, infos[i].memory, infos[i].offset);
      return;
    }
    case DESTROY_IMAGE_VIEW:
      if (ARG (1) != 0)
        destroy_view (ARG (1));
      return;
    case UPDATE_DESCRIPTOR_SETS:
      update_descriptor_sets (ARG (1) & 0xffffffff, POINTER_ARG (2), ARG (3) & 0xffffffff, POINTER_ARG (4));
      return;
    case DESTROY_DESCRIPTOR_UPDATE_TEMPLATE:
      if (ARG (1) != 0)
        destroy_template (ARG (1));
      return;
    case UPDATE_DESCRIPTOR_SET_WITH_TEMPLATE:
      update_with_template (ARG (1), ARG (2), POINTER_ARG (3));
      return;
    case MAP_MEMORY:
      note_device (POINTER_ARG (0), driver);
      pending = GUM_IC_GET_INVOCATION_DATA (ic, Pending);
      pending->memory = ARG (1);
      pending->offset = ARG (2);
      pending->size = ARG (3);
      pending->out = POINTER_ARG (5);
      return;
    case MAP_MEMORY2:
    {
      const MemoryMapInfo * info = POINTER_ARG (1);
      note_device (POINTER_ARG (0), driver);
      pending = GUM_IC_GET_INVOCATION_DATA (ic, Pending);
      pending->memory = info->memory;
      pending->offset = info->offset;
      pending->size = info->size;
      pending->out = POINTER_ARG (2);
      return;
    }
    case UNMAP_MEMORY:
      unmap_memory (ARG (1));
      return;
    case UNMAP_MEMORY2:
      unmap_memory (((const MemoryUnmapInfo *) POINTER_ARG (1))->memory);
      return;
    case NAME_OBJECT:
      name_object (POINTER_ARG (1));
      return;
    case DEVICE_ACTIVITY:
      note_device (POINTER_ARG (0), driver);
      return;
  }
}

static void create_image (guint64 handle, const ImageCreateInfo * info)
{
  ImageEntry * image;
  g_mutex_lock (&tap.lock);
  image = INSERT_IMAGE (handle);
  if (image != NULL)
  {
    image->order = ++tap.next_order;
    image->width = info->width;
    image->height = info->height;
    image->format = info->format;
    image->tiling = info->tiling;
  }
  g_mutex_unlock (&tap.lock);
}

static void create_view (guint64 handle, const ImageViewCreateInfo * info)
{
  ViewEntry * view;
  g_mutex_lock (&tap.lock);
  view = INSERT_VIEW (handle);
  if (view != NULL)
  {
    view->image = info->image;
    view->format = info->format;
  }
  g_mutex_unlock (&tap.lock);
}

static void create_template (guint64 handle, const TemplateCreateInfo * info)
{
  TemplateEntry * entry;
  guint32 i;
  if (info->template_type != DESCRIPTOR_SET_TEMPLATE)
    return;
  g_mutex_lock (&tap.lock);
  entry = INSERT_TEMPLATE (handle);
  if (entry != NULL)
  {
    entry->count = 0;
    for (i = 0; i != info->entry_count && entry->count != TEMPLATE_IMAGE_CAPACITY; i++)
    {
      const TemplateEntryInfo * update = &info->entries[i];
      if (update->element != 0 || update->binding >= SET_BINDING_COUNT || !is_image_descriptor (update->descriptor_type))
        continue;
      entry->images[entry->count].binding = update->binding;
      entry->images[entry->count].offset = update->offset;
      entry->count++;
    }
  }
  g_mutex_unlock (&tap.lock);
}

static void map_memory (guint64 memory, gpointer mapped, guint64 offset, guint64 size)
{
  MemoryEntry * entry;
  g_mutex_lock (&tap.lock);
  entry = INSERT_MEMORY (memory);
  if (entry != NULL)
  {
    entry->mapped = mapped;
    entry->mapped_offset = offset;
    entry->mapped_size = (size == WHOLE_SIZE && entry->size != 0) ? entry->size - offset : size;
  }
  g_mutex_unlock (&tap.lock);
}

static gboolean mark_known_locked (guint64 object_type, guint64 handle)
{
  BufferEntry * buffer;
  ImageEntry * image;
  if (object_type == BUFFER_OBJECT)
  {
    buffer = INSERT_BUFFER (handle);
    if (buffer != NULL)
      buffer->flags |= KNOWN_TO_SCRIPT;
    return buffer != NULL;
  }
  image = INSERT_IMAGE (handle);
  if (image != NULL)
    image->flags |= KNOWN_TO_SCRIPT;
  return image != NULL;
}

static void bind_vertex_buffer (Recording * recording, guint64 index, guint64 buffer, guint64 offset, guint64 stride)
{
  Binding * binding;
  if (index >= BINDING_COUNT)
    return;
  binding = &recording->bindings[index];
  binding->buffer = buffer;
  binding->offset = offset;
  binding->stride = stride;
  if (buffer != 0)
    recording->bound |= 1u << index;
  else
    recording->bound &= ~(1u << index);
}

static void bind_descriptor_sets (Recording * recording, guint32 first, guint32 count, const guint64 * sets)
{
  guint32 i;
  for (i = 0; i != count && first + i < SET_COUNT; i++)
  {
    recording->descriptor_sets[first + i] = sets[i];
    if (sets[i] != 0)
      recording->bound_sets |= 1u << (first + i);
    else
      recording->bound_sets &= ~(1u << (first + i));
  }
}

static void set_vertex_input (Recording * recording, guint32 binding_count, const VertexBinding2 * bindings, guint32 attribute_count,
    const VertexAttribute2 * attributes)
{
  guint64 id = 0;
  guint32 i;
  for (i = 0; i != binding_count; i++)
    id = mix (mix (mix (mix (id, bindings[i].binding), bindings[i].stride), bindings[i].input_rate), bindings[i].divisor);
  for (i = 0; i != attribute_count; i++)
    id = mix (mix (mix (mix (id, attributes[i].location), attributes[i].binding), attributes[i].format), attributes[i].offset);
  id |= 1;
  recording->vertex_input = id;
  recording->latest_vertex_input = VERTEX_INPUT_FROM_COMMAND;
  if (remember_locked (mix (TAG_VERTEX_INPUT, id)))
    on_vertex_input (id, bindings, binding_count, attributes, attribute_count);
}

static void draw_direct (Recording * recording, guint64 elements, guint64 count, guint64 first, gint64 vertex_offset)
{
  Draw draw;
  memset (&draw, 0, sizeof (draw) - sizeof (draw.bindings));
  draw.elements = elements;
  draw.count = count;
  draw.first = first;
  draw.vertex_offset = vertex_offset;
  draw.draw_count = 1;
  record_draw (recording, &draw);
}

static void draw_indirect (Recording * recording, guint64 elements, guint64 buffer, guint64 offset, guint64 count, guint64 stride)
{
  Draw draw;
  memset (&draw, 0, sizeof (draw) - sizeof (draw.bindings));
  draw.elements = elements;
  draw.indirect_buffer = buffer;
  draw.indirect_offset = offset;
  draw.draw_count = count;
  draw.indirect_stride = stride;
  record_draw (recording, &draw);
}

static void note_copy (Recording * recording, guint64 source, guint64 destination, guint64 source_offset, guint64 destination_offset,
    guint64 size)
{
  Copy * copy;
  if (recording->copy_count == COPY_CAPACITY)
    return;
  copy = &recording->copies[recording->copy_count++];
  copy->source = source;
  copy->destination = destination;
  copy->source_offset = source_offset;
  copy->destination_offset = destination_offset;
  copy->size = size;
}

static void note_image_copy (Recording * recording, guint64 source, guint64 image, const BufferImageCopy * region)
{
  ImageCopy * copy;
  if (region->mip_level != 0 || region->base_layer != 0 || region->z != 0 || recording->image_copy_count == IMAGE_COPY_CAPACITY)
    return;
  copy = &recording->image_copies[recording->image_copy_count++];
  copy->source = source;
  copy->image = image;
  copy->buffer_offset = region->buffer_offset;
  copy->row_length = region->row_length;
  copy->image_height = region->image_height;
  copy->x = region->x;
  copy->y = region->y;
  copy->width = region->width;
  copy->height = region->height;
}

static void submitted (gpointer command_buffer)
{
  Recording * recording = recording_of (command_buffer, 0, EXISTING_RECORDING);
  guint i;
  if (recording == NULL)
    return;
  for (i = 0; i != recording->copy_count; i++)
  {
    const Copy * copy = &recording->copies[i];
    guint64 key = mix (mix (mix (mix (mix (TAG_COPY, copy->source), copy->destination), copy->source_offset), copy->destination_offset),
        copy->size);
    if (remember_locked (key))
      on_copied (copy->source, copy->destination, copy->source_offset, copy->destination_offset, copy->size);
  }
  for (i = 0; i != recording->image_copy_count; i++)
  {
    const ImageCopy * copy = &recording->image_copies[i];
    guint64 key = mix (mix (mix (mix (mix (TAG_IMAGE_COPY, copy->source), copy->image), copy->buffer_offset), copy->x), copy->y);
    if (remember_locked (mix (mix (mix (key, copy->width), copy->height), copy->row_length)))
      on_image_copied (copy);
  }
}

static Recording * recording_of (gpointer command_buffer, guint driver, RecordingLookup lookup)
{
  Recording * recording = gum_tls_key_get_value (tap.current);
  Recording * oldest = NULL;
  guint i;

  if (recording != NULL && recording->command_buffer == command_buffer)
    return recording;

  recording = NULL;
  g_mutex_lock (&tap.lock);
  for (i = 0; i != RECORDING_CAPACITY; i++)
  {
    Recording * candidate = &tap.recordings[i];
    if (candidate->command_buffer == command_buffer)
    {
      recording = candidate;
      break;
    }
    if (oldest == NULL || candidate->begun < oldest->begun)
      oldest = candidate;
  }
  if (recording == NULL && lookup == CLAIMED_RECORDING)
  {
    recording = oldest;
    recording->command_buffer = command_buffer;
    recording->driver = driver;
    recording->begun = ++tap.clock;
    reset_recording (recording);
  }
  g_mutex_unlock (&tap.lock);

  if (recording != NULL)
    gum_tls_key_set_value (tap.current, recording);
  return recording;
}

static void reset_recording (Recording * recording)
{
  recording->pipeline = 0;
  recording->topology = UNSET;
  recording->vertex_input = 0;
  recording->latest_vertex_input = VERTEX_INPUT_FROM_PIPELINE;
  recording->index_buffer = 0;
  recording->index_offset = 0;
  recording->index_type = 0;
  recording->bound = 0;
  recording->copy_count = 0;
  recording->bound_sets = 0;
  recording->image_copy_count = 0;
}

static gboolean remember_locked (guint64 key)
{
  gboolean fresh;
  g_mutex_lock (&tap.lock);
  fresh = remember (key);
  g_mutex_unlock (&tap.lock);
  return fresh;
}

static void note_device (gpointer device, guint driver)
{
  gpointer key = *(gpointer *) device;
  guint i;
  for (i = 0; i != DEVICE_CAPACITY; i++)
  {
    if (tap.devices[i].key == key)
      return;
  }
  g_mutex_lock (&tap.lock);
  for (i = 0; i != DEVICE_CAPACITY; i++)
  {
    if (tap.devices[i].key == key)
      break;
    if (tap.devices[i].key == NULL)
    {
      tap.devices[i].device = device;
      tap.devices[i].driver = driver;
      tap.devices[i].key = key;
      break;
    }
  }
  g_mutex_unlock (&tap.lock);
}

static void destroy_buffer (guint64 buffer)
{
  BufferEntry * entry;
  gboolean known = FALSE;
  g_mutex_lock (&tap.lock);
  entry = FIND_BUFFER (buffer);
  if (entry != NULL)
  {
    known = (entry->flags & KNOWN_TO_SCRIPT) != 0;
    entry_remove (tap.buffers, sizeof (BufferEntry), BUFFER_CAPACITY, &tap.buffer_count, &entry->handle);
  }
  g_mutex_unlock (&tap.lock);
  if (known)
    on_forgotten (BUFFER_OBJECT, buffer);
}

static void free_memory (guint64 memory)
{
  MemoryEntry * entry;
  gboolean known = FALSE;
  g_mutex_lock (&tap.lock);
  entry = FIND_MEMORY (memory);
  if (entry != NULL)
  {
    known = (entry->flags & KNOWN_TO_SCRIPT) != 0;
    entry_remove (tap.memories, sizeof (MemoryEntry), MEMORY_CAPACITY, &tap.memory_count, &entry->handle);
  }
  g_mutex_unlock (&tap.lock);
  if (known)
    on_forgotten (MEMORY_OBJECT, memory);
}

static void bind_buffer_memory (guint64 buffer, guint64 memory, guint64 offset)
{
  BufferEntry * entry;
  MemoryEntry * backing;
  g_mutex_lock (&tap.lock);
  entry = INSERT_BUFFER (buffer);
  if (entry != NULL)
  {
    entry->memory = memory;
    entry->memory_offset = offset;
    backing = FIND_MEMORY (memory);
    if (backing != NULL && holds_geometry (entry->usage))
      backing->flags |= HOLDS_GEOMETRY;
  }
  g_mutex_unlock (&tap.lock);
}

static void destroy_image (guint64 image)
{
  ImageEntry * entry;
  gboolean known = FALSE;
  g_mutex_lock (&tap.lock);
  entry = FIND_IMAGE (image);
  if (entry != NULL)
  {
    known = (entry->flags & KNOWN_TO_SCRIPT) != 0;
    entry_remove (tap.images, sizeof (ImageEntry), IMAGE_CAPACITY, &tap.image_count, &entry->handle);
  }
  g_mutex_unlock (&tap.lock);
  if (known)
    on_forgotten (IMAGE_OBJECT, image);
}

static void bind_image_memory (guint64 image, guint64 memory, guint64 offset)
{
  ImageEntry * entry;
  MemoryEntry * backing;
  g_mutex_lock (&tap.lock);
  entry = INSERT_IMAGE (image);
  if (entry != NULL)
  {
    entry->memory = memory;
    entry->memory_offset = offset;
    backing = FIND_MEMORY (memory);
    if (backing != NULL && entry->tiling == LINEAR_TILING)
      backing->flags |= HOLDS_TEXELS;
  }
  g_mutex_unlock (&tap.lock);
}

static void destroy_view (guint64 view)
{
  ViewEntry * entry;
  g_mutex_lock (&tap.lock);
  entry = FIND_VIEW (view);
  if (entry != NULL)
    entry_remove (tap.views, sizeof (ViewEntry), VIEW_CAPACITY, &tap.view_count, &entry->handle);
  g_mutex_unlock (&tap.lock);
}

static void update_descriptor_sets (guint32 write_count, const WriteDescriptorSet * writes, guint32 copy_count,
    const CopyDescriptorSet * copies)
{
  guint32 i;
  g_mutex_lock (&tap.lock);
  for (i = 0; i != write_count; i++)
  {
    const WriteDescriptorSet * write = &writes[i];
    if (write->element == 0 && write->binding < SET_BINDING_COUNT)
      set_descriptor (write->set, write->binding, is_image_descriptor (write->descriptor_type) ? write->images[0].view : 0);
  }
  for (i = 0; i != copy_count; i++)
  {
    const CopyDescriptorSet * copy = &copies[i];
    const DescriptorSetEntry * source;
    if (copy->source_element != 0 || copy->destination_element != 0 || copy->source_binding >= SET_BINDING_COUNT
        || copy->destination_binding >= SET_BINDING_COUNT)
      continue;
    source = FIND_SET (copy->source);
    set_descriptor (copy->destination, copy->destination_binding, (source != NULL) ? source->views[copy->source_binding] : 0);
  }
  g_mutex_unlock (&tap.lock);
}

static void destroy_template (guint64 handle)
{
  TemplateEntry * entry;
  g_mutex_lock (&tap.lock);
  entry = FIND_TEMPLATE (handle);
  if (entry != NULL)
    entry_remove (tap.templates, sizeof (TemplateEntry), TEMPLATE_CAPACITY, &tap.template_count, &entry->handle);
  g_mutex_unlock (&tap.lock);
}

static void update_with_template (guint64 set, guint64 handle, gconstpointer data)
{
  const TemplateEntry * entry;
  guint64 i;
  g_mutex_lock (&tap.lock);
  entry = FIND_TEMPLATE (handle);
  for (i = 0; entry != NULL && i != entry->count; i++)
  {
    const DescriptorImageInfo * image = (const DescriptorImageInfo *) ((const guint8 *) data + entry->images[i].offset);
    set_descriptor (set, entry->images[i].binding, image->view);
  }
  g_mutex_unlock (&tap.lock);
}

static void unmap_memory (guint64 memory)
{
  MemoryEntry * entry;
  gpointer mapped = NULL;
  guint64 offset = 0, size = 0;
  gboolean shadowed = FALSE;

  g_mutex_lock (&tap.lock);
  entry = FIND_MEMORY (memory);
  if (entry != NULL && entry->mapped != NULL)
  {
    mapped = entry->mapped;
    offset = entry->mapped_offset;
    size = entry->mapped_size;
    shadowed = (entry->flags & (HOLDS_GEOMETRY | HOLDS_TEXELS)) != 0 && size <= LARGEST_SHADOWED_MAPPING;
    if (shadowed)
      entry->flags |= KNOWN_TO_SCRIPT;
    entry->mapped = NULL;
  }
  g_mutex_unlock (&tap.lock);
  if (shadowed)
    on_unmapping (memory, mapped, offset, size);
}

static void name_object (const ObjectNameInfo * info)
{
  gboolean known;
  if ((info->object_type != BUFFER_OBJECT && info->object_type != IMAGE_OBJECT) || info->name == NULL)
    return;
  g_mutex_lock (&tap.lock);
  known = mark_known_locked (info->object_type, info->handle);
  g_mutex_unlock (&tap.lock);
  if (known)
    on_named (info->object_type, info->handle, info->name);
}

static void record_draw (Recording * recording, Draw * draw)
{
  guint64 key;
  guint32 relevant;
  guint pipeline, i;
  gboolean fresh;

  if (tap.draw_watch != DRAWS_OBSERVED)
    return;
  key = mix (mix (mix (mix (TAG_DRAW, recording->pipeline), recording->topology), recording->vertex_input), draw->elements);
  if (draw->elements == INDEXED)
    key = mix (mix (mix (key, recording->index_buffer), recording->index_offset), recording->index_type);
  key = mix (mix (mix (mix (key, draw->count), draw->first), (guint64) draw->vertex_offset), draw->indirect_buffer);
  key = mix (mix (mix (key, draw->indirect_offset), draw->draw_count), draw->indirect_stride);

  g_mutex_lock (&tap.lock);
  pipeline = find_pipeline (recording->pipeline);
  if (pipeline != PIPELINE_CAPACITY)
    key = mix (key, tap.pipeline_generations[pipeline]);
  relevant = (recording->vertex_input == 0 && pipeline != PIPELINE_CAPACITY) ? tap.pipeline_bindings[pipeline] : ALL_BINDINGS;
  for (i = 0; i != BINDING_COUNT; i++)
  {
    const Binding * binding = &recording->bindings[i];
    if ((recording->bound & (1u << i)) == 0)
      continue;
    key = mix (mix (key, i), binding->buffer);
    if ((relevant & (1u << i)) != 0)
      key = mix (mix (key, binding->offset), binding->stride);
  }
  fresh = remember (key);
  g_mutex_unlock (&tap.lock);

  if (!fresh)
    return;
  draw->command_buffer = recording->command_buffer;
  draw->driver = recording->driver;
  draw->pipeline = recording->pipeline;
  draw->topology = recording->topology;
  draw->vertex_input = recording->vertex_input;
  draw->latest_vertex_input = recording->latest_vertex_input;
  draw->index_buffer = recording->index_buffer;
  draw->index_offset = recording->index_offset;
  draw->index_type = recording->index_type;
  draw->bound = recording->bound;
  memcpy (draw->bindings, recording->bindings, sizeof (recording->bindings));
  draw->bound_sets = recording->bound_sets;
  memcpy (draw->descriptor_sets, recording->descriptor_sets, sizeof (recording->descriptor_sets));
  on_new_draw (draw);
}

static void on_new_draw (Draw * draw)
{
  enter_js ();
  deliver_new_draw (draw);
  leave_js ();
}

static void on_vertex_input (guint64 id, const VertexBinding2 * bindings, guint32 binding_count, const VertexAttribute2 * attributes,
    guint32 attribute_count)
{
  enter_js ();
  deliver_vertex_input (id, bindings, binding_count, attributes, attribute_count);
  leave_js ();
}

static void on_copied (guint64 source, guint64 destination, guint64 source_offset, guint64 destination_offset, guint64 size)
{
  enter_js ();
  deliver_copied (source, destination, source_offset, destination_offset, size);
  leave_js ();
}

static void on_updated (guint64 destination, guint64 offset, guint64 size, gconstpointer data)
{
  enter_js ();
  deliver_updated (destination, offset, size, data);
  leave_js ();
}

static void on_image_copied (const ImageCopy * copy)
{
  enter_js ();
  deliver_image_copied (copy);
  leave_js ();
}

static void on_unmapping (guint64 memory, gpointer mapped, guint64 offset, guint64 size)
{
  enter_js ();
  deliver_unmapping (memory, mapped, offset, size);
  leave_js ();
}

static void on_named (guint64 kind, guint64 handle, const gchar * name)
{
  enter_js ();
  deliver_named (kind, handle, name);
  leave_js ();
}

static void on_forgotten (guint64 kind, guint64 handle)
{
  enter_js ();
  deliver_forgotten (kind, handle);
  leave_js ();
}

static void enter_js (void)
{
  g_mutex_lock (&tap.lock);
  tap.callbacks_running++;
  g_mutex_unlock (&tap.lock);
}

static void leave_js (void)
{
  g_mutex_lock (&tap.lock);
  if (--tap.callbacks_running == 0)
    g_cond_broadcast (&tap.idle);
  g_mutex_unlock (&tap.lock);
}

static gboolean remember (guint64 key)
{
  guint index;
  if (key == 0)
    key = 1;
  index = key % SEEN_CAPACITY;
  if (tap.seen_count >= SEEN_CAPACITY / 2)
    return FALSE;
  for (;;)
  {
    if (tap.seen[index] == key)
      return FALSE;
    if (tap.seen[index] == 0)
    {
      tap.seen[index] = key;
      tap.seen_count++;
      return TRUE;
    }
    index = (index + 1) % SEEN_CAPACITY;
  }
}

static void entry_remove (gpointer table, gsize entry_size, guint capacity, guint * count, guint64 * entry)
{
  guint hole = ((guint8 *) entry - (guint8 *) table) / entry_size;
  guint next = hole;
  memset (entry, 0, entry_size);
  (*count)--;
  for (;;)
  {
    guint64 * candidate;
    guint home;
    next = (next + 1) % capacity;
    candidate = (guint64 *) ((guint8 *) table + next * entry_size);
    if (*candidate == 0)
      return;
    home = home_of (*candidate, capacity);
    if ((next > hole) ? (home <= hole || home > next) : (home <= hole && home > next))
    {
      memcpy ((guint8 *) table + hole * entry_size, candidate, entry_size);
      memset (candidate, 0, entry_size);
      hole = next;
    }
  }
}

static gboolean holds_geometry (guint64 usage)
{
  return usage == 0 || (usage & GEOMETRY_USAGE) != 0;
}

static void set_descriptor (guint64 set, guint32 binding, guint64 view)
{
  DescriptorSetEntry * entry = (view != 0) ? INSERT_SET (set) : FIND_SET (set);
  if (entry != NULL)
    entry->views[binding] = view;
}

static gboolean is_image_descriptor (guint32 descriptor_type)
{
  return descriptor_type == COMBINED_IMAGE_SAMPLER || descriptor_type == SAMPLED_IMAGE;
}

static guint claim_pipeline (guint64 pipeline)
{
  guint index = home_of (pipeline, PIPELINE_CAPACITY);
  guint probes;
  for (probes = 0; probes != PIPELINE_CAPACITY; probes++)
  {
    if (tap.pipelines[index] == pipeline || tap.pipelines[index] == 0)
    {
      tap.pipelines[index] = pipeline;
      return index;
    }
    index = (index + 1) % PIPELINE_CAPACITY;
  }
  return PIPELINE_CAPACITY;
}

static guint find_pipeline (guint64 pipeline)
{
  guint index = home_of (pipeline, PIPELINE_CAPACITY);
  guint probes;
  for (probes = 0; probes != PIPELINE_CAPACITY; probes++)
  {
    if (tap.pipelines[index] == pipeline)
      return index;
    if (tap.pipelines[index] == 0)
      return PIPELINE_CAPACITY;
    index = (index + 1) % PIPELINE_CAPACITY;
  }
  return PIPELINE_CAPACITY;
}

static gpointer entry_find (gpointer table, gsize entry_size, guint capacity, guint64 handle)
{
  guint index = home_of (handle, capacity);
  guint probes;
  for (probes = 0; probes != capacity; probes++)
  {
    guint64 * entry = (guint64 *) ((guint8 *) table + index * entry_size);
    if (*entry == handle)
      return entry;
    if (*entry == 0)
      return NULL;
    index = (index + 1) % capacity;
  }
  return NULL;
}

static gpointer entry_insert (gpointer table, gsize entry_size, guint capacity, guint * count, guint64 handle)
{
  guint index = home_of (handle, capacity);
  for (;;)
  {
    guint64 * entry = (guint64 *) ((guint8 *) table + index * entry_size);
    if (*entry == handle)
      return entry;
    if (*entry == 0)
    {
      if (*count >= capacity / 4 * 3)
        return NULL;
      memset (entry, 0, entry_size);
      *entry = handle;
      (*count)++;
      return entry;
    }
    index = (index + 1) % capacity;
  }
}

static guint home_of (guint64 handle, guint capacity)
{
  return mix (0, handle) % capacity;
}

static guint64 mix (guint64 hash, guint64 value)
{
  hash ^= value + 0x9e3779b97f4a7c15ull + (hash << 6) + (hash >> 2);
  return hash * 0x100000001b3ull;
}
`;

export class VulkanTap {
    readonly #state: NativePointer;
    readonly #callbacks: NativeCallback<any, any>[];
    readonly #tap: CModule;
    readonly #listeners: InvocationListener[] = [];
    readonly #describe: NativeFunction<number, [number | UInt64, NativePointerValue]>;
    readonly #describeImage: NativeFunction<number, [number | UInt64, NativePointerValue]>;
    readonly #describeView: NativeFunction<number, [number | UInt64, NativePointerValue]>;
    readonly #describeSet: NativeFunction<number, [number | UInt64, NativePointerValue]>;
    readonly #markKnown: NativeFunction<void, [number, number | UInt64]>;
    readonly #listBuffers: NativeFunction<number, [number | UInt64, NativePointerValue, number]>;
    readonly #listMappings: NativeFunction<number, [NativePointerValue, number]>;
    readonly #deviceFor: NativeFunction<NativePointer, [NativePointerValue, NativePointerValue]>;
    readonly #setDrawWatch: NativeFunction<void, [number]>;
    readonly #setBindings: NativeFunction<void, [number | UInt64, number]>;
    readonly #renew: NativeFunction<void, [number | UInt64, number]>;
    readonly #waitUntilIdle: NativeFunction<void, []>;
    readonly #facts = tapFacts.BufferFacts.at(Memory.alloc(tapFacts.BufferFacts.size));
    readonly #imageFacts = imageFacts.ImageFacts.at(Memory.alloc(imageFacts.ImageFacts.size));
    readonly #viewFacts = imageFacts.ViewFacts.at(Memory.alloc(imageFacts.ViewFacts.size));
    readonly #setViews = Memory.alloc(SET_BINDING_COUNT * 8);
    readonly #driverOut = Memory.alloc(8);

    constructor(drivers: VulkanDriver[], events: VulkanTapEvents) {
        const sizer = new CModule(sizeSource);
        this.#state = Memory.alloc(new NativeFunction(sizer.tap_size, "uint64", [])().toNumber());
        this.#callbacks = [
            new NativeCallback(draw => events.newDraw(recordedDrawOf(Draw.at(draw))), "void", ["pointer"]),
            new NativeCallback((id, bindings, bindingCount, attributes, attributeCount) =>
                events.vertexInput(id, bindings, bindingCount, attributes, attributeCount), "void",
            ["uint64", "pointer", "uint32", "pointer", "uint32"]),
            new NativeCallback((source, destination, sourceOffset, destinationOffset, size) =>
                events.copied(source, destination, sourceOffset.toNumber(), destinationOffset.toNumber(), size.toNumber()),
            "void", ["uint64", "uint64", "uint64", "uint64", "uint64"]),
            new NativeCallback((destination, offset, size, data) => events.updated(destination, offset.toNumber(), size.toNumber(), data),
                "void", ["uint64", "uint64", "uint64", "pointer"]),
            new NativeCallback(copy => events.imageCopied(recordedImageCopyOf(imageFacts.ImageCopy.at(copy))), "void", ["pointer"]),
            new NativeCallback((memory, mapped, offset, size) => events.unmapping(memory, mapped, offset.toNumber(), size.toNumber()),
                "void", ["uint64", "pointer", "uint64", "uint64"]),
            new NativeCallback((kind, handle, name) =>
                events.named(objectKinds.get(kind.toNumber()) as NamedKind, handle, name.readUtf8String()!), "void",
            ["uint64", "uint64", "pointer"]),
            new NativeCallback((kind, handle) => events.forgotten(objectKinds.get(kind.toNumber())!, handle), "void", ["uint64", "uint64"]),
        ];
        const [onNewDraw, onVertexInput, onCopied, onUpdated, onImageCopied, onUnmapping, onNamed, onForgotten] = this.#callbacks;
        this.#tap = new CModule(source, {
            tap: this.#state,
            deliver_new_draw: onNewDraw,
            deliver_vertex_input: onVertexInput,
            deliver_copied: onCopied,
            deliver_updated: onUpdated,
            deliver_image_copied: onImageCopied,
            deliver_unmapping: onUnmapping,
            deliver_named: onNamed,
            deliver_forgotten: onForgotten,
        });
        this.#describe = new NativeFunction(this.#tap.describe_buffer, "uint8", ["uint64", "pointer"]);
        this.#describeImage = new NativeFunction(this.#tap.describe_image, "uint8", ["uint64", "pointer"]);
        this.#describeView = new NativeFunction(this.#tap.describe_view, "uint8", ["uint64", "pointer"]);
        this.#describeSet = new NativeFunction(this.#tap.describe_descriptor_set, "uint8", ["uint64", "pointer"]);
        this.#markKnown = new NativeFunction(this.#tap.mark_known, "void", ["uint64", "uint64"]);
        this.#listBuffers = new NativeFunction(this.#tap.list_buffers, "uint", ["uint64", "pointer", "uint"]);
        this.#listMappings = new NativeFunction(this.#tap.list_mappings, "uint", ["pointer", "uint"]);
        this.#deviceFor = new NativeFunction(this.#tap.device_for, "pointer", ["pointer", "pointer"]);
        this.#setDrawWatch = new NativeFunction(this.#tap.set_draw_watch, "void", ["uint"]);
        this.#setBindings = new NativeFunction(this.#tap.set_pipeline_bindings, "void", ["uint64", "uint32"]);
        this.#renew = new NativeFunction(this.#tap.renew_pipeline, "void", ["uint64", "uint32"]);
        this.#waitUntilIdle = new NativeFunction(this.#tap.wait_until_idle, "void", []);
        this.#attach(drivers);
    }

    describeBuffer(handle: UInt64): BufferFacts | null {
        const facts = this.#facts;
        if (this.#describe(handle, facts.$address) === 0) {
            return null;
        }
        const { mappedSize } = facts;
        return {
            size: facts.size.toNumber(),
            memory: facts.memory,
            memoryOffset: facts.memoryOffset.toNumber(),
            order: facts.order.toNumber(),
            backing: (facts.backing.toNumber() !== 0) ? "tracked" : "untracked",
            mapped: facts.mapped,
            mappedOffset: facts.mappedOffset.toNumber(),
            mappedSize: mappedSize.equals(UNSET) ? null : mappedSize.toNumber(),
        };
    }

    describeImage(handle: UInt64): ImageFacts | null {
        const facts = this.#imageFacts;
        if (this.#describeImage(handle, facts.$address) === 0) {
            return null;
        }
        const { mappedSize } = facts;
        return {
            order: facts.order.toNumber(),
            width: facts.width.toNumber(),
            height: facts.height.toNumber(),
            format: facts.format.toNumber(),
            tiling: (facts.tiling.toNumber() === LINEAR_TILING) ? "linear" : "optimal",
            memory: facts.memory,
            memoryOffset: facts.memoryOffset.toNumber(),
            backing: (facts.backing.toNumber() !== 0) ? "tracked" : "untracked",
            mapped: facts.mapped,
            mappedOffset: facts.mappedOffset.toNumber(),
            mappedSize: mappedSize.equals(UNSET) ? null : mappedSize.toNumber(),
        };
    }

    describeView(handle: UInt64): ViewFacts | null {
        const facts = this.#viewFacts;
        if (this.#describeView(handle, facts.$address) === 0) {
            return null;
        }
        return { image: facts.image, format: facts.format.toNumber() };
    }

    describeDescriptorSet(handle: UInt64): UInt64[] | null {
        const views = this.#setViews;
        if (this.#describeSet(handle, views) === 0) {
            return null;
        }
        return Array.from({ length: SET_BINDING_COUNT }, (_, binding) => views.add(binding * 8).readU64());
    }

    rememberBuffer(handle: UInt64): void {
        this.#markKnown(objectTypes.buffer, handle);
    }

    rememberImage(handle: UInt64): void {
        this.#markKnown(objectTypes.image, handle);
    }

    buffers(boundTo: UInt64 | 0 = 0): UInt64[] {
        const handles = Memory.alloc(LARGEST_BUFFER_COUNT * 8);
        const count = this.#listBuffers(boundTo, handles, LARGEST_BUFFER_COUNT);
        return Array.from({ length: count }, (_, i) => handles.add(i * 8).readU64());
    }

    mappings(): KnownMapping[] {
        const entries = Memory.alloc(LARGEST_MAPPING_COUNT * tapFacts.Mapping.size);
        const count = this.#listMappings(entries, LARGEST_MAPPING_COUNT);
        return Array.from({ length: count }, (_, i) => {
            const { mapped, mappedSize } = tapFacts.Mapping.at(entries.add(i * tapFacts.Mapping.size));
            return { mapped, mappedSize: mappedSize.equals(UNSET) ? null : mappedSize.toNumber() };
        });
    }

    deviceOf(dispatchable: NativePointer): { device: NativePointer; driver: number } | null {
        const device = this.#deviceFor(dispatchable.readPointer(), this.#driverOut);
        return device.isNull() ? null : { device, driver: this.#driverOut.readU64().toNumber() };
    }

    observeDraws(watch: DrawWatch): void {
        this.#setDrawWatch(drawWatches[watch]);
    }

    narrowPipeline(pipeline: UInt64, bindings: number): void {
        this.#setBindings(pipeline, bindings >>> 0);
    }

    renewPipeline(pipeline: UInt64, positionSlot: number | null): void {
        this.#renew(pipeline, (positionSlot !== null) ? (1 << positionSlot) >>> 0 : ALL_BINDINGS);
    }

    dispose(): void {
        for (const listener of this.#listeners) {
            listener.detach();
        }
        Interceptor.flush();
        this.#waitUntilIdle();
        this.#tap.dispose();
    }

    #attach(drivers: VulkanDriver[]): void {
        const hooked = new Set<string>();
        for (const driver of drivers) {
            tapCalls.forEach(([call, names], index) => {
                for (const name of names) {
                    const target = driver.entryPoints.get(name);
                    if (target === undefined || hooked.has(target.toString())) {
                        continue;
                    }
                    hooked.add(target.toString());
                    const leave = callsWithResults.has(call) ? { onLeave: this.#tap.on_leave } : {};
                    this.#listeners.push(Interceptor.attach(target, { onEnter: this.#tap.on_enter, ...leave },
                        ptr((driver.index << 8) | (index + 1))));
                }
            });
        }
    }
}

function recordedDrawOf(draw: Draw): RecordedDraw {
    const { topology, vertexInput } = draw;
    const bound = draw.bound.toNumber();
    const bindings: RecordedBinding[] = [];
    draw.bindings.forEach((binding, index) => {
        if ((bound & (1 << index)) === 0) {
            return;
        }
        const { stride } = binding;
        bindings.push({
            index,
            buffer: binding.buffer,
            offset: binding.offset.toNumber(),
            stride: stride.equals(UNSET) ? null : stride.toNumber(),
        });
    });
    const boundSets = draw.boundSets.toNumber();
    const descriptorSets = draw.descriptorSets.flatMap((set, index) => ((boundSets & (1 << index)) !== 0) ? [{ index, set }] : []);
    return {
        commandBuffer: draw.commandBuffer,
        driver: draw.driver.toNumber(),
        pipeline: draw.pipeline,
        topology: topology.equals(UNSET) ? null : topology.toNumber(),
        vertexInput: vertexInput.equals(0) ? null : vertexInput,
        latestVertexInput: (draw.latestVertexInput.toNumber() !== 0) ? "command" : "pipeline",
        elements: (draw.elements.toNumber() !== 0) ? "indexed" : "vertices",
        indexBuffer: draw.indexBuffer,
        indexOffset: draw.indexOffset.toNumber(),
        indexType: draw.indexType.toNumber(),
        count: draw.count.toNumber(),
        first: draw.first.toNumber(),
        vertexOffset: draw.vertexOffset.toNumber(),
        indirectBuffer: draw.indirectBuffer,
        indirectOffset: draw.indirectOffset.toNumber(),
        drawCount: draw.drawCount.toNumber(),
        indirectStride: draw.indirectStride.toNumber(),
        bindings,
        descriptorSets,
    };
}

function recordedImageCopyOf(copy: imageFacts.ImageCopy): RecordedImageCopy {
    return {
        source: copy.source,
        image: copy.image,
        bufferOffset: copy.bufferOffset.toNumber(),
        rowLength: copy.rowLength.toNumber(),
        imageHeight: copy.imageHeight.toNumber(),
        x: copy.x.toNumber(),
        y: copy.y.toNumber(),
        width: copy.width.toNumber(),
        height: copy.height.toNumber(),
    };
}
