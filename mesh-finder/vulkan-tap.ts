import type { VulkanDriver } from "./vulkan-driver.js";

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

export interface KnownMapping {
    mapped: NativePointer;
    mappedSize: number | null;
}

export interface VulkanTapEvents {
    newDraw(draw: RecordedDraw): void;
    vertexInput(id: UInt64, bindings: NativePointer, bindingCount: number, attributes: NativePointer, attributeCount: number): void;
    copied(source: UInt64, destination: UInt64, sourceOffset: number, destinationOffset: number, size: number): void;
    updated(destination: UInt64, offset: number, size: number, data: NativePointer): void;
    unmapping(memory: UInt64, mapped: NativePointer, offset: number, size: number): void;
    named(buffer: UInt64, name: string): void;
    forgotten(kind: ObjectKind, handle: UInt64): void;
}

export type VertexInputSource = "pipeline" | "command";

export type DrawElements = "indexed" | "vertices";

export type MemoryBacking = "tracked" | "untracked";

export type ObjectKind = "buffer" | "memory";

export type DrawWatch = "observed" | "ignored";

type TapCall =
    | "begin" | "bindPipeline" | "bindVertexBuffers" | "bindVertexBuffers2" | "bindIndexBuffer" | "bindIndexBuffer2"
    | "setVertexInput" | "setPrimitiveTopology" | "draw" | "drawIndexed" | "drawIndirect" | "drawIndexedIndirect" | "drawMulti"
    | "drawMultiIndexed" | "copyBuffer" | "copyBuffer2" | "updateBuffer" | "queueSubmit" | "queueSubmit2" | "createBuffer"
    | "destroyBuffer" | "allocateMemory" | "freeMemory" | "bindBufferMemory" | "bindBufferMemory2" | "mapMemory" | "mapMemory2"
    | "unmapMemory" | "unmapMemory2" | "nameObject" | "deviceActivity";

const tapCalls: [TapCall, string[]][] = [
    ["begin", ["vkBeginCommandBuffer"]],
    ["bindPipeline", ["vkCmdBindPipeline"]],
    ["bindVertexBuffers", ["vkCmdBindVertexBuffers"]],
    ["bindVertexBuffers2", ["vkCmdBindVertexBuffers2", "vkCmdBindVertexBuffers2EXT"]],
    ["bindIndexBuffer", ["vkCmdBindIndexBuffer"]],
    ["bindIndexBuffer2", ["vkCmdBindIndexBuffer2", "vkCmdBindIndexBuffer2KHR"]],
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
    ["updateBuffer", ["vkCmdUpdateBuffer"]],
    ["queueSubmit", ["vkQueueSubmit"]],
    ["queueSubmit2", ["vkQueueSubmit2", "vkQueueSubmit2KHR"]],
    ["createBuffer", ["vkCreateBuffer"]],
    ["destroyBuffer", ["vkDestroyBuffer"]],
    ["allocateMemory", ["vkAllocateMemory"]],
    ["freeMemory", ["vkFreeMemory"]],
    ["bindBufferMemory", ["vkBindBufferMemory"]],
    ["bindBufferMemory2", ["vkBindBufferMemory2", "vkBindBufferMemory2KHR"]],
    ["mapMemory", ["vkMapMemory"]],
    ["mapMemory2", ["vkMapMemory2", "vkMapMemory2KHR"]],
    ["unmapMemory", ["vkUnmapMemory"]],
    ["unmapMemory2", ["vkUnmapMemory2", "vkUnmapMemory2KHR"]],
    ["nameObject", ["vkSetDebugUtilsObjectNameEXT"]],
    ["deviceActivity", ["vkWaitForFences", "vkResetFences", "vkWaitSemaphores", "vkWaitSemaphoresKHR"]],
];

const callsWithResults = new Set<TapCall>(["createBuffer", "allocateMemory", "mapMemory", "mapMemory2"]);

export const tapEntryPointNames = tapCalls.flatMap(([, names]) => names);

const UNSET = "18446744073709551615";
const DRAW_HEADER_FIELDS = 18;
const BINDING_SIZE = 24;
const FACTS_FIELDS = 8;
const LARGEST_BUFFER_COUNT = 65536;
const LARGEST_MAPPING_COUNT = 16384;
const MAPPING_SIZE = 16;
const objectKinds = new Map<number, ObjectKind>([[8, "memory"], [9, "buffer"]]);
const drawWatches: Record<DrawWatch, number> = { ignored: 0, observed: 1 };

const declarations = `
#include <gum/guminterceptor.h>
#include <gum/gumtls.h>
#include <string.h>

#define BINDING_COUNT 32
#define RECORDING_CAPACITY 256
#define COPY_CAPACITY 32
#define SEEN_CAPACITY 65536
#define PIPELINE_CAPACITY 4096
#define BUFFER_CAPACITY 65536
#define MEMORY_CAPACITY 16384
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
  Binding bindings[BINDING_COUNT];
  Copy copies[COPY_CAPACITY];
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
  Recording recordings[RECORDING_CAPACITY];
  guint64 seen[SEEN_CAPACITY];
  guint64 pipelines[PIPELINE_CAPACITY];
  guint32 pipeline_bindings[PIPELINE_CAPACITY];
  BufferEntry buffers[BUFFER_CAPACITY];
  MemoryEntry memories[MEMORY_CAPACITY];
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
#define MEMORY_OBJECT 8
#define BUFFER_OBJECT 9
#define GEOMETRY_USAGE (0x1 | 0x40 | 0x80)
#define LARGEST_SHADOWED_MAPPING (64 * 1048576)
#define HOLDS_GEOMETRY 1
#define KNOWN_TO_SCRIPT 2
#define TAG_DRAW 0x6472617700000000ull
#define TAG_COPY 0x636f707900000000ull
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
  UPDATE_BUFFER,
  QUEUE_SUBMIT,
  QUEUE_SUBMIT2,
  CREATE_BUFFER,
  DESTROY_BUFFER,
  ALLOCATE_MEMORY,
  FREE_MEMORY,
  BIND_BUFFER_MEMORY,
  BIND_BUFFER_MEMORY2,
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
  gpointer mapped;
  guint64 mapped_size;
} Mapping;

typedef struct
{
  gpointer out;
  guint64 size;
  guint64 usage;
  guint64 memory;
  guint64 offset;
} Pending;

typedef struct { gint32 type; gconstpointer next; guint32 flags; guint64 size; guint32 usage; } BufferCreateInfo;
typedef struct { gint32 type; gconstpointer next; guint64 size; guint32 type_index; } MemoryAllocateInfo;
typedef struct { gint32 type; gconstpointer next; guint64 buffer; guint64 memory; guint64 offset; } BindBufferMemoryInfo;
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
extern void deliver_unmapping (guint64 memory, gpointer mapped, guint64 offset, guint64 size);
extern void deliver_named (guint64 buffer, const gchar * name);
extern void deliver_forgotten (guint64 kind, guint64 handle);

static void on_recording_call (GumInvocationContext * ic, guint call, guint driver);
static void on_submission (GumInvocationContext * ic, guint call);
static void on_object_call (GumInvocationContext * ic, guint call, guint driver);
static void map_memory (guint64 memory, gpointer mapped, guint64 offset, guint64 size);
static void bind_vertex_buffer (Recording * recording, guint64 index, guint64 buffer, guint64 offset, guint64 stride);
static void set_vertex_input (Recording * recording, guint32 binding_count, const VertexBinding2 * bindings, guint32 attribute_count,
    const VertexAttribute2 * attributes);
static void draw_direct (Recording * recording, guint64 elements, guint64 count, guint64 first, gint64 vertex_offset);
static void draw_indirect (Recording * recording, guint64 elements, guint64 buffer, guint64 offset, guint64 count, guint64 stride);
static void note_copy (Recording * recording, guint64 source, guint64 destination, guint64 source_offset, guint64 destination_offset,
    guint64 size);
static void submitted (gpointer command_buffer);
static Recording * recording_of (gpointer command_buffer, guint driver, RecordingLookup lookup);
static void reset_recording (Recording * recording);
static gboolean remember_locked (guint64 key);
static void note_device (gpointer device, guint driver);
static void destroy_buffer (guint64 buffer);
static void free_memory (guint64 memory);
static void bind_buffer_memory (guint64 buffer, guint64 memory, guint64 offset);
static void unmap_memory (guint64 memory);
static void name_object (const ObjectNameInfo * info);
static void record_draw (Recording * recording, Draw * draw);
static void on_new_draw (Draw * draw);
static void on_vertex_input (guint64 id, const VertexBinding2 * bindings, guint32 binding_count, const VertexAttribute2 * attributes,
    guint32 attribute_count);
static void on_copied (guint64 source, guint64 destination, guint64 source_offset, guint64 destination_offset, guint64 size);
static void on_updated (guint64 destination, guint64 offset, guint64 size, gconstpointer data);
static void on_unmapping (guint64 memory, gpointer mapped, guint64 offset, guint64 size);
static void on_named (guint64 buffer, const gchar * name);
static void on_forgotten (guint64 kind, guint64 handle);
static void enter_js (void);
static void leave_js (void);
static gboolean remember (guint64 key);
static void entry_remove (gpointer table, gsize entry_size, guint capacity, guint * count, guint64 * entry);
static gboolean holds_geometry (guint64 usage);
static guint32 bindings_that_matter (guint64 pipeline);
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

void mark_buffer_known (guint64 handle)
{
  BufferEntry * entry;
  g_mutex_lock (&tap.lock);
  entry = INSERT_BUFFER (handle);
  if (entry != NULL)
    entry->flags |= KNOWN_TO_SCRIPT;
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
  guint index = home_of (pipeline, PIPELINE_CAPACITY);
  guint probes;
  g_mutex_lock (&tap.lock);
  for (probes = 0; probes != PIPELINE_CAPACITY; probes++)
  {
    if (tap.pipelines[index] == pipeline || tap.pipelines[index] == 0)
    {
      tap.pipelines[index] = pipeline;
      tap.pipeline_bindings[index] = bindings;
      break;
    }
    index = (index + 1) % PIPELINE_CAPACITY;
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
      const BindBufferMemoryInfo * infos = POINTER_ARG (2);
      note_device (POINTER_ARG (0), driver);
      count = ARG (1) & 0xffffffff;
      for (i = 0; i != count; i++)
        bind_buffer_memory (infos[i].buffer, infos[i].memory, infos[i].offset);
      return;
    }
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
    shadowed = (entry->flags & HOLDS_GEOMETRY) != 0 && size <= LARGEST_SHADOWED_MAPPING;
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
  BufferEntry * entry;
  if (info->object_type != BUFFER_OBJECT || info->name == NULL)
    return;
  g_mutex_lock (&tap.lock);
  entry = INSERT_BUFFER (info->handle);
  if (entry != NULL)
    entry->flags |= KNOWN_TO_SCRIPT;
  g_mutex_unlock (&tap.lock);
  if (entry != NULL)
    on_named (info->handle, info->name);
}

static void record_draw (Recording * recording, Draw * draw)
{
  guint64 key;
  guint32 relevant;
  guint i;
  gboolean fresh;

  if (tap.draw_watch != DRAWS_OBSERVED)
    return;
  key = mix (mix (mix (mix (TAG_DRAW, recording->pipeline), recording->topology), recording->vertex_input), draw->elements);
  if (draw->elements == INDEXED)
    key = mix (mix (mix (key, recording->index_buffer), recording->index_offset), recording->index_type);
  key = mix (mix (mix (mix (key, draw->count), draw->first), (guint64) draw->vertex_offset), draw->indirect_buffer);
  key = mix (mix (mix (key, draw->indirect_offset), draw->draw_count), draw->indirect_stride);

  g_mutex_lock (&tap.lock);
  relevant = (recording->vertex_input != 0) ? ALL_BINDINGS : bindings_that_matter (recording->pipeline);
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

static void on_unmapping (guint64 memory, gpointer mapped, guint64 offset, guint64 size)
{
  enter_js ();
  deliver_unmapping (memory, mapped, offset, size);
  leave_js ();
}

static void on_named (guint64 buffer, const gchar * name)
{
  enter_js ();
  deliver_named (buffer, name);
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

static guint32 bindings_that_matter (guint64 pipeline)
{
  guint index = home_of (pipeline, PIPELINE_CAPACITY);
  guint probes;
  for (probes = 0; probes != PIPELINE_CAPACITY; probes++)
  {
    if (tap.pipelines[index] == pipeline)
      return tap.pipeline_bindings[index];
    if (tap.pipelines[index] == 0)
      return ALL_BINDINGS;
    index = (index + 1) % PIPELINE_CAPACITY;
  }
  return ALL_BINDINGS;
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
    private readonly state: NativePointer;
    private readonly callbacks: NativeCallback<any, any>[];
    private readonly tap: CModule;
    private readonly listeners: InvocationListener[] = [];
    private readonly describe: NativeFunction<number, [number | UInt64, NativePointerValue]>;
    private readonly markKnown: NativeFunction<void, [number | UInt64]>;
    private readonly listBuffers: NativeFunction<number, [number | UInt64, NativePointerValue, number]>;
    private readonly listMappings: NativeFunction<number, [NativePointerValue, number]>;
    private readonly deviceFor: NativeFunction<NativePointer, [NativePointerValue, NativePointerValue]>;
    private readonly setDrawWatch: NativeFunction<void, [number]>;
    private readonly setBindings: NativeFunction<void, [number | UInt64, number]>;
    private readonly waitUntilIdle: NativeFunction<void, []>;
    private readonly facts = Memory.alloc(FACTS_FIELDS * 8);
    private readonly driverOut = Memory.alloc(8);

    constructor(drivers: VulkanDriver[], events: VulkanTapEvents) {
        const sizer = new CModule(sizeSource);
        this.state = Memory.alloc(new NativeFunction(sizer.tap_size, "uint64", [])().toNumber());
        this.callbacks = [
            new NativeCallback(draw => events.newDraw(parseDraw(draw)), "void", ["pointer"]),
            new NativeCallback((id, bindings, bindingCount, attributes, attributeCount) =>
                events.vertexInput(id, bindings, bindingCount, attributes, attributeCount), "void",
            ["uint64", "pointer", "uint32", "pointer", "uint32"]),
            new NativeCallback((source, destination, sourceOffset, destinationOffset, size) =>
                events.copied(source, destination, sourceOffset.toNumber(), destinationOffset.toNumber(), size.toNumber()),
            "void", ["uint64", "uint64", "uint64", "uint64", "uint64"]),
            new NativeCallback((destination, offset, size, data) => events.updated(destination, offset.toNumber(), size.toNumber(), data),
                "void", ["uint64", "uint64", "uint64", "pointer"]),
            new NativeCallback((memory, mapped, offset, size) => events.unmapping(memory, mapped, offset.toNumber(), size.toNumber()),
                "void", ["uint64", "pointer", "uint64", "uint64"]),
            new NativeCallback((buffer, name) => events.named(buffer, name.readUtf8String()!), "void", ["uint64", "pointer"]),
            new NativeCallback((kind, handle) => events.forgotten(objectKinds.get(kind.toNumber())!, handle), "void", ["uint64", "uint64"]),
        ];
        const [onNewDraw, onVertexInput, onCopied, onUpdated, onUnmapping, onNamed, onForgotten] = this.callbacks;
        this.tap = new CModule(source, {
            tap: this.state,
            deliver_new_draw: onNewDraw,
            deliver_vertex_input: onVertexInput,
            deliver_copied: onCopied,
            deliver_updated: onUpdated,
            deliver_unmapping: onUnmapping,
            deliver_named: onNamed,
            deliver_forgotten: onForgotten,
        });
        this.describe = new NativeFunction(this.tap.describe_buffer, "uint8", ["uint64", "pointer"]);
        this.markKnown = new NativeFunction(this.tap.mark_buffer_known, "void", ["uint64"]);
        this.listBuffers = new NativeFunction(this.tap.list_buffers, "uint", ["uint64", "pointer", "uint"]);
        this.listMappings = new NativeFunction(this.tap.list_mappings, "uint", ["pointer", "uint"]);
        this.deviceFor = new NativeFunction(this.tap.device_for, "pointer", ["pointer", "pointer"]);
        this.setDrawWatch = new NativeFunction(this.tap.set_draw_watch, "void", ["uint"]);
        this.setBindings = new NativeFunction(this.tap.set_pipeline_bindings, "void", ["uint64", "uint32"]);
        this.waitUntilIdle = new NativeFunction(this.tap.wait_until_idle, "void", []);
        this.attach(drivers);
    }

    describeBuffer(handle: UInt64): BufferFacts | null {
        if (this.describe(handle, this.facts) === 0) {
            return null;
        }
        const field = (index: number) => this.facts.add(index * 8);
        const mappedSize = field(7).readU64();
        return {
            size: field(0).readU64().toNumber(),
            memory: field(1).readU64(),
            memoryOffset: field(2).readU64().toNumber(),
            order: field(3).readU64().toNumber(),
            backing: (field(4).readU64().toNumber() !== 0) ? "tracked" : "untracked",
            mapped: field(5).readPointer(),
            mappedOffset: field(6).readU64().toNumber(),
            mappedSize: (mappedSize.toString() === UNSET) ? null : mappedSize.toNumber(),
        };
    }

    rememberBuffer(handle: UInt64): void {
        this.markKnown(handle);
    }

    buffers(boundTo: UInt64 | 0 = 0): UInt64[] {
        const handles = Memory.alloc(LARGEST_BUFFER_COUNT * 8);
        const count = this.listBuffers(boundTo, handles, LARGEST_BUFFER_COUNT);
        return Array.from({ length: count }, (_, i) => handles.add(i * 8).readU64());
    }

    mappings(): KnownMapping[] {
        const entries = Memory.alloc(LARGEST_MAPPING_COUNT * MAPPING_SIZE);
        const count = this.listMappings(entries, LARGEST_MAPPING_COUNT);
        return Array.from({ length: count }, (_, i) => {
            const entry = entries.add(i * MAPPING_SIZE);
            const size = entry.add(8).readU64();
            return { mapped: entry.readPointer(), mappedSize: (size.toString() === UNSET) ? null : size.toNumber() };
        });
    }

    deviceOf(dispatchable: NativePointer): { device: NativePointer; driver: number } | null {
        const device = this.deviceFor(dispatchable.readPointer(), this.driverOut);
        return device.isNull() ? null : { device, driver: this.driverOut.readU64().toNumber() };
    }

    observeDraws(watch: DrawWatch): void {
        this.setDrawWatch(drawWatches[watch]);
    }

    narrowPipeline(pipeline: UInt64, bindings: number): void {
        this.setBindings(pipeline, bindings >>> 0);
    }

    dispose(): void {
        for (const listener of this.listeners) {
            listener.detach();
        }
        Interceptor.flush();
        this.waitUntilIdle();
        this.tap.dispose();
    }

    private attach(drivers: VulkanDriver[]): void {
        const hooked = new Set<string>();
        for (const driver of drivers) {
            tapCalls.forEach(([call, names], index) => {
                for (const name of names) {
                    const target = driver.entryPoints.get(name);
                    if (target === undefined || hooked.has(target.toString())) {
                        continue;
                    }
                    hooked.add(target.toString());
                    const leave = callsWithResults.has(call) ? { onLeave: this.tap.on_leave } : {};
                    this.listeners.push(Interceptor.attach(target, { onEnter: this.tap.on_enter, ...leave },
                        ptr((driver.index << 8) | (index + 1))));
                }
            });
        }
    }
}

function parseDraw(draw: NativePointer): RecordedDraw {
    const field = (index: number) => draw.add(index * 8);
    const topology = field(3).readU64();
    const vertexInput = field(4).readU64();
    const bound = field(17).readU32();
    const bindings: RecordedBinding[] = [];
    for (let index = 0; index !== 32; index++) {
        if ((bound & (1 << index)) === 0) {
            continue;
        }
        const binding = draw.add(DRAW_HEADER_FIELDS * 8 + index * BINDING_SIZE);
        const stride = binding.add(16).readU64();
        bindings.push({
            index,
            buffer: binding.readU64(),
            offset: binding.add(8).readU64().toNumber(),
            stride: (stride.toString() === UNSET) ? null : stride.toNumber(),
        });
    }
    return {
        commandBuffer: field(0).readPointer(),
        driver: field(1).readU64().toNumber(),
        pipeline: field(2).readU64(),
        topology: (topology.toString() === UNSET) ? null : topology.toNumber(),
        vertexInput: vertexInput.equals(0) ? null : vertexInput,
        latestVertexInput: (field(5).readU64().toNumber() !== 0) ? "command" : "pipeline",
        elements: (field(6).readU64().toNumber() !== 0) ? "indexed" : "vertices",
        indexBuffer: field(7).readU64(),
        indexOffset: field(8).readU64().toNumber(),
        indexType: field(9).readU64().toNumber(),
        count: field(10).readU64().toNumber(),
        first: field(11).readU64().toNumber(),
        vertexOffset: field(12).readS64().toNumber(),
        indirectBuffer: field(13).readU64(),
        indirectOffset: field(14).readU64().toNumber(),
        drawCount: field(15).readU64().toNumber(),
        indirectStride: field(16).readU64().toNumber(),
        bindings,
    };
}
