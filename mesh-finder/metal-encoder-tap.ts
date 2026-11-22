import { implementationOf } from "./objc.js";

export interface EncodedDraw {
    pipeline: NativePointer;
    primitive: number;
    indexType: number;
    indexBuffer: NativePointer;
    indexOffset: number;
    indexCount: number;
    vertexStart: number;
    vertexCount: number;
    baseVertex: number;
    indirectBuffer: NativePointer;
    indirectOffset: number;
    slots: EncodedSlot[];
}

export interface EncodedSlot {
    index: number;
    buffer: NativePointer;
    offset: number;
    stride: number | null;
    bytes: NativePointer;
    bytesLength: number;
}

const SLOT_COUNT = 31;
const DRAW_HEADER_SIZE = 104;
const SLOT_SIZE = 40;
const STATIC_STRIDE = "18446744073709551615";
const TAP_STATE_SIZE = 1048576;

const source = `
#include <gum/guminterceptor.h>
#include <gum/gumtls.h>
#include <string.h>

#define SLOT_COUNT 31
#define STATE_COUNT 64
#define BYTES_CAPACITY 4096
#define SEEN_CAPACITY 65536
#define PIPELINE_CAPACITY 4096
#define ALL_SLOTS 0x7fffffffu
#define STATIC_STRIDE 0xffffffffffffffffull
#define IGNORED_CAPACITY 8
#define ADDRESS_BITS 0x00007fffffffffffull

enum
{
  SET_BUFFER = 1,
  SET_BUFFER_WITH_STRIDE,
  SET_OFFSET,
  SET_OFFSET_WITH_STRIDE,
  SET_BUFFERS,
  SET_BUFFERS_WITH_STRIDES,
  SET_BYTES,
  SET_BYTES_WITH_STRIDE,
  SET_PIPELINE,
  DRAW,
  DRAW_INSTANCED,
  DRAW_INSTANCED_FROM,
  DRAW_INDIRECT,
  DRAW_INDEXED,
  DRAW_INDEXED_INSTANCED,
  DRAW_INDEXED_INSTANCED_FROM,
  DRAW_INDEXED_INDIRECT,
  END_ENCODING
};

typedef struct
{
  gpointer buffer;
  guint64 offset;
  guint64 stride;
  guint8 * bytes;
  guint64 bytes_length;
} Slot;

typedef struct
{
  gpointer encoder;
  gpointer pipeline;
  guint32 bound;
  Slot slots[SLOT_COUNT];
} EncoderState;

typedef struct
{
  gpointer pipeline;
  guint64 primitive;
  guint64 index_type;
  gpointer index_buffer;
  guint64 index_offset;
  guint64 index_count;
  guint64 vertex_start;
  guint64 vertex_count;
  gint64 base_vertex;
  guint64 instance_count;
  gpointer indirect_buffer;
  guint64 indirect_offset;
  guint64 bound;
  Slot slots[SLOT_COUNT];
} Draw;

typedef struct
{
  guint64 start;
  guint64 end;
} CallerRange;

typedef struct
{
  GMutex lock;
  GCond idle;
  guint callbacks_running;
  GumTlsKey current_state;
  guint seen_count;
  guint ignored_count;
  CallerRange ignored[IGNORED_CAPACITY];
  EncoderState states[STATE_COUNT];
  guint64 seen[SEEN_CAPACITY];
  gpointer pipelines[PIPELINE_CAPACITY];
  guint32 pipeline_slots[PIPELINE_CAPACITY];
} Tap;

extern Tap tap;
extern void deliver_new_draw (Draw * draw);

static gboolean is_ignored_caller (GumInvocationContext * ic);
static void end_encoding (gpointer encoder);
static EncoderState * state_of (gpointer encoder);
static void bind_buffer (EncoderState * state, guint64 index, gpointer buffer, guint64 offset, guint64 stride);
static void move_buffer (EncoderState * state, guint64 index, guint64 offset, guint64 stride);
static void bind_bytes (EncoderState * state, guint64 index, gconstpointer bytes, guint64 length, guint64 stride);
static void record_draw (EncoderState * state, Draw * draw);
static guint32 slots_that_matter (gpointer pipeline);
static guint64 mix (guint64 hash, guint64 value);
static gboolean remember (guint64 key);
static void on_new_draw (Draw * draw);
static guint pipeline_index (gpointer pipeline);
static void enter_js (void);
static void leave_js (void);

void init (void)
{
  g_mutex_init (&tap.lock);
  g_cond_init (&tap.idle);
  tap.current_state = gum_tls_key_new ();
}

void finalize (void)
{
  guint i, j;
  for (i = 0; i != STATE_COUNT; i++)
    for (j = 0; j != SLOT_COUNT; j++)
      g_free (tap.states[i].slots[j].bytes);
  gum_tls_key_free (tap.current_state);
  g_cond_clear (&tap.idle);
  g_mutex_clear (&tap.lock);
}

void on_encoder_call (GumInvocationContext * ic)
{
  guint call = GUM_IC_GET_FUNC_DATA (ic, guintptr);
  gpointer encoder = gum_invocation_context_get_nth_argument (ic, 0);
  EncoderState * state;
  Draw draw;
  guint64 i, first, count;
  gpointer * buffers;
  guint64 * offsets, * strides;

#define ARG(n) ((guint64) gum_invocation_context_get_nth_argument (ic, n))
#define POINTER_ARG(n) gum_invocation_context_get_nth_argument (ic, n)

  if (is_ignored_caller (ic))
    return;
  if (call == END_ENCODING)
  {
    end_encoding (encoder);
    return;
  }
  state = state_of (encoder);
  if (state == NULL)
    return;

  switch (call)
  {
    case SET_BUFFER:
      bind_buffer (state, ARG (4), POINTER_ARG (2), ARG (3), STATIC_STRIDE);
      return;
    case SET_BUFFER_WITH_STRIDE:
      bind_buffer (state, ARG (5), POINTER_ARG (2), ARG (3), ARG (4));
      return;
    case SET_OFFSET:
      move_buffer (state, ARG (3), ARG (2), STATIC_STRIDE);
      return;
    case SET_OFFSET_WITH_STRIDE:
      move_buffer (state, ARG (4), ARG (2), ARG (3));
      return;
    case SET_BUFFERS:
    case SET_BUFFERS_WITH_STRIDES:
      buffers = POINTER_ARG (2);
      offsets = POINTER_ARG (3);
      strides = (call == SET_BUFFERS_WITH_STRIDES) ? POINTER_ARG (4) : NULL;
      first = ARG ((call == SET_BUFFERS_WITH_STRIDES) ? 5 : 4);
      count = ARG ((call == SET_BUFFERS_WITH_STRIDES) ? 6 : 5);
      for (i = 0; i != count; i++)
        bind_buffer (state, first + i, buffers[i], offsets[i], (strides != NULL) ? strides[i] : STATIC_STRIDE);
      return;
    case SET_BYTES:
      bind_bytes (state, ARG (4), POINTER_ARG (2), ARG (3), STATIC_STRIDE);
      return;
    case SET_BYTES_WITH_STRIDE:
      bind_bytes (state, ARG (5), POINTER_ARG (2), ARG (3), ARG (4));
      return;
    case SET_PIPELINE:
      state->pipeline = POINTER_ARG (2);
      return;
  }

  memset (&draw, 0, sizeof (draw) - sizeof (draw.slots));
  draw.primitive = ARG (2);
  draw.instance_count = 1;
  switch (call)
  {
    case DRAW:
    case DRAW_INSTANCED:
    case DRAW_INSTANCED_FROM:
      draw.vertex_start = ARG (3);
      draw.vertex_count = ARG (4);
      break;
    case DRAW_INDIRECT:
      draw.indirect_buffer = POINTER_ARG (3);
      draw.indirect_offset = ARG (4);
      break;
    case DRAW_INDEXED:
    case DRAW_INDEXED_INSTANCED:
    case DRAW_INDEXED_INSTANCED_FROM:
      draw.index_count = ARG (3);
      draw.index_type = ARG (4);
      draw.index_buffer = POINTER_ARG (5);
      draw.index_offset = ARG (6);
      if (call == DRAW_INDEXED_INSTANCED_FROM)
        draw.base_vertex = (gint64) ARG (8);
      break;
    case DRAW_INDEXED_INDIRECT:
      draw.index_type = ARG (3);
      draw.index_buffer = POINTER_ARG (4);
      draw.index_offset = ARG (5);
      draw.indirect_buffer = POINTER_ARG (6);
      draw.indirect_offset = ARG (7);
      break;
  }
  record_draw (state, &draw);
}

void set_pipeline_slots (gpointer pipeline, guint32 slots)
{
  guint index;
  g_mutex_lock (&tap.lock);
  index = pipeline_index (pipeline);
  if (index != PIPELINE_CAPACITY)
  {
    tap.pipelines[index] = pipeline;
    tap.pipeline_slots[index] = slots;
  }
  g_mutex_unlock (&tap.lock);
}

void ignore_callers (guint64 start, guint64 end)
{
  g_mutex_lock (&tap.lock);
  if (tap.ignored_count != IGNORED_CAPACITY)
  {
    tap.ignored[tap.ignored_count].start = start;
    tap.ignored[tap.ignored_count].end = end;
    tap.ignored_count++;
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

static gboolean is_ignored_caller (GumInvocationContext * ic)
{
  guint64 caller = (guint64) gum_invocation_context_get_return_address (ic) & ADDRESS_BITS;
  guint i;
  for (i = 0; i != tap.ignored_count; i++)
  {
    if (caller >= tap.ignored[i].start && caller < tap.ignored[i].end)
      return TRUE;
  }
  return FALSE;
}

static void end_encoding (gpointer encoder)
{
  guint i;
  g_mutex_lock (&tap.lock);
  for (i = 0; i != STATE_COUNT; i++)
  {
    if (tap.states[i].encoder == encoder)
      tap.states[i].encoder = NULL;
  }
  g_mutex_unlock (&tap.lock);
}

static EncoderState * state_of (gpointer encoder)
{
  EncoderState * state = gum_tls_key_get_value (tap.current_state);
  EncoderState * vacant = NULL;
  guint i;

  if (state != NULL && state->encoder == encoder)
    return state;

  state = NULL;
  g_mutex_lock (&tap.lock);
  for (i = 0; i != STATE_COUNT; i++)
  {
    if (tap.states[i].encoder == encoder)
    {
      state = &tap.states[i];
      break;
    }
    if (vacant == NULL && tap.states[i].encoder == NULL)
      vacant = &tap.states[i];
  }
  if (state == NULL && vacant != NULL)
  {
    state = vacant;
    state->encoder = encoder;
    state->pipeline = NULL;
    state->bound = 0;
  }
  g_mutex_unlock (&tap.lock);

  if (state != NULL)
    gum_tls_key_set_value (tap.current_state, state);
  return state;
}

static void bind_buffer (EncoderState * state, guint64 index, gpointer buffer, guint64 offset, guint64 stride)
{
  Slot * slot;
  if (index >= SLOT_COUNT)
    return;
  slot = &state->slots[index];
  slot->buffer = buffer;
  slot->offset = offset;
  slot->stride = stride;
  slot->bytes_length = 0;
  if (buffer != NULL)
    state->bound |= 1u << index;
  else
    state->bound &= ~(1u << index);
}

static void move_buffer (EncoderState * state, guint64 index, guint64 offset, guint64 stride)
{
  if (index >= SLOT_COUNT)
    return;
  state->slots[index].offset = offset;
  state->slots[index].stride = stride;
}

static void bind_bytes (EncoderState * state, guint64 index, gconstpointer bytes, guint64 length, guint64 stride)
{
  Slot * slot;
  if (index >= SLOT_COUNT)
    return;
  slot = &state->slots[index];
  if (slot->bytes == NULL)
    slot->bytes = g_malloc (BYTES_CAPACITY);
  if (length > BYTES_CAPACITY)
    length = BYTES_CAPACITY;
  memcpy (slot->bytes, bytes, length);
  slot->buffer = NULL;
  slot->offset = 0;
  slot->stride = stride;
  slot->bytes_length = length;
  state->bound |= 1u << index;
}

static void record_draw (EncoderState * state, Draw * draw)
{
  guint64 key;
  guint32 relevant;
  guint i;
  gboolean fresh;

  g_mutex_lock (&tap.lock);
  relevant = slots_that_matter (state->pipeline);
  key = mix (mix (mix (mix ((guint64) state->pipeline, draw->primitive), draw->index_type), (guint64) draw->index_buffer),
      draw->index_offset);
  key = mix (mix (mix (mix (key, draw->index_count), draw->vertex_start), draw->vertex_count), (guint64) draw->base_vertex);
  key = mix (mix (key, (guint64) draw->indirect_buffer), draw->indirect_offset);
  for (i = 0; i != SLOT_COUNT; i++)
  {
    const Slot * slot = &state->slots[i];
    if ((state->bound & (1u << i)) == 0)
      continue;
    key = mix (mix (key, i), (guint64) slot->buffer);
    if ((relevant & (1u << i)) != 0)
      key = mix (mix (mix (key, slot->offset), slot->stride), slot->bytes_length);
  }
  fresh = remember (key);
  g_mutex_unlock (&tap.lock);

  if (!fresh)
    return;
  draw->pipeline = state->pipeline;
  draw->bound = state->bound;
  memcpy (draw->slots, state->slots, sizeof (state->slots));
  on_new_draw (draw);
}

static guint32 slots_that_matter (gpointer pipeline)
{
  guint index = pipeline_index (pipeline);
  return (index != PIPELINE_CAPACITY && tap.pipelines[index] == pipeline) ? tap.pipeline_slots[index] : ALL_SLOTS;
}

static guint64 mix (guint64 hash, guint64 value)
{
  hash ^= value + 0x9e3779b97f4a7c15ull + (hash << 6) + (hash >> 2);
  return hash * 0x100000001b3ull;
}

static gboolean remember (guint64 key)
{
  guint index = key % SEEN_CAPACITY;
  if (key == 0)
    key = 1;
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

static void on_new_draw (Draw * draw)
{
  enter_js ();
  deliver_new_draw (draw);
  leave_js ();
}

static guint pipeline_index (gpointer pipeline)
{
  guint index = ((guint64) pipeline >> 4) % PIPELINE_CAPACITY;
  guint probes;
  for (probes = 0; probes != PIPELINE_CAPACITY; probes++)
  {
    if (tap.pipelines[index] == pipeline || tap.pipelines[index] == NULL)
      return index;
    index = (index + 1) % PIPELINE_CAPACITY;
  }
  return PIPELINE_CAPACITY;
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
`;

const encoderCalls: [string, number][] = [
    ["setVertexBuffer:offset:atIndex:", 1],
    ["setVertexBuffer:offset:attributeStride:atIndex:", 2],
    ["setVertexBufferOffset:atIndex:", 3],
    ["setVertexBufferOffset:attributeStride:atIndex:", 4],
    ["setVertexBuffers:offsets:withRange:", 5],
    ["setVertexBuffers:offsets:attributeStrides:withRange:", 6],
    ["setVertexBytes:length:atIndex:", 7],
    ["setVertexBytes:length:attributeStride:atIndex:", 8],
    ["setRenderPipelineState:", 9],
    ["drawPrimitives:vertexStart:vertexCount:", 10],
    ["drawPrimitives:vertexStart:vertexCount:instanceCount:", 11],
    ["drawPrimitives:vertexStart:vertexCount:instanceCount:baseInstance:", 12],
    ["drawPrimitives:indirectBuffer:indirectBufferOffset:", 13],
    ["drawIndexedPrimitives:indexCount:indexType:indexBuffer:indexBufferOffset:", 14],
    ["drawIndexedPrimitives:indexCount:indexType:indexBuffer:indexBufferOffset:instanceCount:", 15],
    ["drawIndexedPrimitives:indexCount:indexType:indexBuffer:indexBufferOffset:instanceCount:baseVertex:baseInstance:", 16],
    ["drawIndexedPrimitives:indexType:indexBuffer:indexBufferOffset:indirectBuffer:indirectBufferOffset:", 17],
    ["endEncoding", 18],
];

export class EncoderTap {
    private readonly onNewDraw: NativeCallback<"void", ["pointer"]>;
    private readonly state: NativePointer;
    private readonly tap: CModule;
    private readonly listeners: InvocationListener[] = [];
    private readonly setSlots: NativeFunction<void, [NativePointerValue, number]>;
    private readonly ignore: NativeFunction<void, [number | UInt64, number | UInt64]>;
    private readonly waitUntilIdle: NativeFunction<void, []>;

    constructor(deliver: (draw: EncodedDraw) => void) {
        this.onNewDraw = new NativeCallback(draw => deliver(parseDraw(draw)), "void", ["pointer"]);
        this.state = Memory.alloc(TAP_STATE_SIZE);
        this.tap = new CModule(source, { tap: this.state, deliver_new_draw: this.onNewDraw });
        this.setSlots = new NativeFunction(this.tap.set_pipeline_slots, "void", ["pointer", "uint32"]);
        this.ignore = new NativeFunction(this.tap.ignore_callers, "void", ["uint64", "uint64"]);
        this.waitUntilIdle = new NativeFunction(this.tap.wait_until_idle, "void", []);
    }

    start(encoderClasses: NativePointer[]): void {
        const hooked = new Set<string>();
        for (const cls of encoderClasses) {
            for (const [selectorName, call] of encoderCalls) {
                const implementation = implementationOf(cls, selectorName);
                if (implementation === null || hooked.has(implementation.toString())) {
                    continue;
                }
                hooked.add(implementation.toString());
                this.listeners.push(Interceptor.attach(implementation, { onEnter: this.tap.on_encoder_call }, ptr(call)));
            }
        }
    }

    ignoreCallsFrom(module: Module): void {
        this.ignore(uint64(module.base.toString()), uint64(module.base.add(module.size).toString()));
    }

    narrowPipeline(pipeline: NativePointer, slots: number): void {
        this.setSlots(pipeline, slots >>> 0);
    }

    dispose(): void {
        for (const listener of this.listeners) {
            listener.detach();
        }
        Interceptor.flush();
        this.waitUntilIdle();
        this.tap.dispose();
    }
}

function parseDraw(draw: NativePointer): EncodedDraw {
    const field = (index: number) => draw.add(index * 8);
    const bound = field(12).readU32();
    const slots: EncodedSlot[] = [];
    for (let index = 0; index !== SLOT_COUNT; index++) {
        if ((bound & (1 << index)) === 0) {
            continue;
        }
        const slot = draw.add(DRAW_HEADER_SIZE + index * SLOT_SIZE);
        const stride = slot.add(16).readU64();
        slots.push({
            index,
            buffer: slot.readPointer(),
            offset: slot.add(8).readU64().toNumber(),
            stride: (stride.toString() === STATIC_STRIDE) ? null : stride.toNumber(),
            bytes: slot.add(24).readPointer(),
            bytesLength: slot.add(32).readU64().toNumber(),
        });
    }
    return {
        pipeline: field(0).readPointer(),
        primitive: field(1).readU64().toNumber(),
        indexType: field(2).readU64().toNumber(),
        indexBuffer: field(3).readPointer(),
        indexOffset: field(4).readU64().toNumber(),
        indexCount: field(5).readU64().toNumber(),
        vertexStart: field(6).readU64().toNumber(),
        vertexCount: field(7).readU64().toNumber(),
        baseVertex: field(8).readS64().toNumber(),
        indirectBuffer: field(10).readPointer(),
        indirectOffset: field(11).readU64().toNumber(),
        slots,
    };
}
