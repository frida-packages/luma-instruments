import { Draw } from "./d3d11-draw.pat";
import type { HookTarget, TapCall } from "./d3d11-runtime.js";

export interface TapEvents {
    newDraw(draw: TappedDraw): void;
    turn(context: NativePointer, device: NativePointer): void;
    bufferCreated(buffer: NativePointer): void;
    inputLayoutCreated(layout: NativePointer, elements: NativePointer, count: number): void;
}

export type DrawWatch = "observed" | "ignored";

export type DrawKind = "vertices" | "indexed" | "vertices-indirect" | "indexed-indirect";

export interface TappedDraw {
    device: NativePointer;
    kind: DrawKind;
    layout: NativePointer;
    topology: number;
    indexBuffer: NativePointer;
    indexFormat: number;
    indexOffset: number;
    indexCount: number;
    startIndex: number;
    baseVertex: number;
    vertexCount: number;
    startVertex: number;
    indirectBuffer: NativePointer;
    indirectOffset: number;
    slots: TappedSlot[];
}

export interface TappedSlot {
    index: number;
    buffer: NativePointer;
    stride: number;
    offset: number;
}

const TAP_STATE_SIZE = 2 * 1048576;

const callIds: Record<TapCall, number> = {
    setInputLayout: 1,
    setVertexBuffers: 2,
    setIndexBuffer: 3,
    setTopology: 4,
    draw: 5,
    drawIndexed: 6,
    drawInstanced: 7,
    drawIndexedInstanced: 8,
    drawInstancedIndirect: 9,
    drawIndexedInstancedIndirect: 10,
    clearState: 11,
    executeCommandList: 12,
    finishCommandList: 13,
    swapState: 14,
    createBuffer: 15,
    createInputLayout: 16,
    createDeferredContext: 17,
};

const creationCalls = new Set<TapCall>(["createBuffer", "createInputLayout", "createDeferredContext"]);

const drawKinds: DrawKind[] = ["vertices", "indexed", "vertices-indirect", "indexed-indirect"];

const source = `
#include <gum/guminterceptor.h>
#include <gum/gumtls.h>
#include <string.h>

#define SLOT_COUNT 32
#define STATE_COUNT 256
#define SEEN_CAPACITY 65536
#define LAYOUT_CAPACITY 4096
#define TURN_CAPACITY 16
#define ALL_SLOTS 0xffffffffu
#define BIND_VERTEX_BUFFER 0x1
#define BIND_INDEX_BUFFER 0x2
#define USAGE_STAGING 3
#define SMALLEST_MESH_BUFFER 36
#define IMMEDIATE 0
#define FORMAT_R32_UINT 42
#define FORMAT_R16_UINT 57

#define IUNKNOWN_RELEASE 2
#define CONTEXT_GET_DEVICE 3
#define CONTEXT_IA_GET_INPUT_LAYOUT 78
#define CONTEXT_IA_GET_VERTEX_BUFFERS 79
#define CONTEXT_IA_GET_INDEX_BUFFER 80
#define CONTEXT_IA_GET_PRIMITIVE_TOPOLOGY 83
#define CONTEXT_GET_TYPE 112

#define METHOD(object, slot) ((*(gpointer **) (object))[slot])
#define ARG(n) gum_invocation_context_get_nth_argument (ic, n)
#define UINT_ARG(n) ((guint32) (gsize) gum_invocation_context_get_nth_argument (ic, n))
#define INT_ARG(n) ((gint32) (gsize) gum_invocation_context_get_nth_argument (ic, n))

enum
{
  SET_INPUT_LAYOUT = 1,
  SET_VERTEX_BUFFERS,
  SET_INDEX_BUFFER,
  SET_TOPOLOGY,
  DRAW,
  DRAW_INDEXED,
  DRAW_INSTANCED,
  DRAW_INDEXED_INSTANCED,
  DRAW_INSTANCED_INDIRECT,
  DRAW_INDEXED_INSTANCED_INDIRECT,
  CLEAR_STATE,
  EXECUTE_COMMAND_LIST,
  FINISH_COMMAND_LIST,
  SWAP_STATE,
  CREATE_BUFFER,
  CREATE_INPUT_LAYOUT,
  CREATE_DEFERRED_CONTEXT
};

enum { VERTICES, INDEXED, VERTICES_INDIRECT, INDEXED_INDIRECT };

typedef guint32 (COM_CALL * ReleaseFunc) (gpointer self);
typedef void (COM_CALL * GetObjectFunc) (gpointer self, gpointer * object);
typedef void (COM_CALL * GetVertexBuffersFunc) (gpointer self, guint32 start, guint32 count, gpointer * buffers, guint32 * strides,
    guint32 * offsets);
typedef void (COM_CALL * GetIndexBufferFunc) (gpointer self, gpointer * buffer, guint32 * format, guint32 * offset);
typedef void (COM_CALL * GetTopologyFunc) (gpointer self, guint32 * topology);
typedef guint32 (COM_CALL * GetTypeFunc) (gpointer self);

typedef struct
{
  gpointer buffer;
  guint32 stride;
  guint32 offset;
} Binding;

typedef struct
{
  gpointer context;
  gpointer device;
  guint32 kind;
  gboolean synced;
  gpointer layout;
  guint32 topology;
  gpointer index_buffer;
  guint32 index_format;
  guint32 index_offset;
  guint32 bound;
  Binding bindings[SLOT_COUNT];
} ContextState;

typedef struct
{
  guint64 buffer;
  guint64 stride;
  guint64 offset;
} DrawSlot;

typedef struct
{
  guint64 device;
  guint64 kind;
  guint64 layout;
  guint64 topology;
  guint64 index_buffer;
  guint64 index_format;
  guint64 index_offset;
  guint64 index_count;
  guint64 start_index;
  gint64 base_vertex;
  guint64 vertex_count;
  guint64 start_vertex;
  guint64 indirect_buffer;
  guint64 indirect_offset;
  guint64 bound;
  DrawSlot slots[SLOT_COUNT];
} Draw;

typedef struct
{
  gpointer layout;
  guint32 slots;
} LayoutSlots;

typedef struct
{
  gconstpointer description;
  guint32 count;
  gpointer * result;
} Creation;

typedef struct
{
  GMutex lock;
  GCond idle;
  guint callbacks_running;
  GumTlsKey current_state;
  volatile gint observing_draws;
  volatile gint turns_wanted;
  gboolean any_turn_wanted;
  gpointer turn_devices[TURN_CAPACITY];
  guint seen_count;
  ContextState states[STATE_COUNT];
  guint64 seen[SEEN_CAPACITY];
  LayoutSlots layouts[LAYOUT_CAPACITY];
} Tap;

extern Tap tap;
extern void deliver_new_draw (Draw * draw);
extern void deliver_turn (gpointer context, gpointer device);
extern void deliver_buffer_created (gpointer buffer);
extern void deliver_input_layout (gpointer layout, gconstpointer elements, guint32 count);

static void note_creation (GumInvocationContext * ic, guint call);
static ContextState * state_of (gpointer context);
static gboolean claim_turn (gpointer device);
static void on_turn (gpointer context, gpointer device);
static void note_vertex_buffers (ContextState * state, GumInvocationContext * ic);
static void begin_draw (Draw * draw, guint kind);
static void record_draw (ContextState * state, Draw * draw);
static void on_buffer_created (gpointer buffer);
static void on_input_layout (gpointer layout, gconstpointer elements, guint32 count);
static void forget_state (gpointer context);
static void sync_state (ContextState * state);
static gboolean is_mesh_topology (guint32 topology);
static guint32 slots_that_matter (gpointer layout);
static guint64 mix (guint64 hash, guint64 value);
static gboolean remember (guint64 key);
static void on_new_draw (Draw * draw);
static void release (gpointer object);
static void enter_js (void);
static void leave_js (void);
static void bind (ContextState * state, guint32 slot, gpointer buffer, guint32 stride, guint32 offset);
static guint layout_index (gpointer layout);

void init (void)
{
  g_mutex_init (&tap.lock);
  g_cond_init (&tap.idle);
  tap.current_state = gum_tls_key_new ();
}

void finalize (void)
{
  gum_tls_key_free (tap.current_state);
  g_cond_clear (&tap.idle);
  g_mutex_clear (&tap.lock);
}

void on_enter (GumInvocationContext * ic)
{
  guint call = GUM_IC_GET_FUNC_DATA (ic, guintptr);
  gpointer self = ARG (0);
  ContextState * state;
  Draw draw;

  if (call >= CREATE_BUFFER)
  {
    note_creation (ic, call);
    return;
  }
  state = state_of (self);
  if (state == NULL)
    return;
  if (state->kind == IMMEDIATE && tap.turns_wanted != 0 && claim_turn (state->device))
    on_turn (self, state->device);

  switch (call)
  {
    case SET_INPUT_LAYOUT:
      state->layout = ARG (1);
      return;
    case SET_VERTEX_BUFFERS:
      note_vertex_buffers (state, ic);
      return;
    case SET_INDEX_BUFFER:
      state->index_buffer = ARG (1);
      state->index_format = UINT_ARG (2);
      state->index_offset = UINT_ARG (3);
      return;
    case SET_TOPOLOGY:
      state->topology = UINT_ARG (1);
      return;
    case DRAW:
      begin_draw (&draw, VERTICES);
      draw.vertex_count = UINT_ARG (1);
      draw.start_vertex = UINT_ARG (2);
      break;
    case DRAW_INDEXED:
      begin_draw (&draw, INDEXED);
      draw.index_count = UINT_ARG (1);
      draw.start_index = UINT_ARG (2);
      draw.base_vertex = INT_ARG (3);
      break;
    case DRAW_INSTANCED:
      begin_draw (&draw, VERTICES);
      draw.vertex_count = UINT_ARG (1);
      draw.start_vertex = UINT_ARG (3);
      break;
    case DRAW_INDEXED_INSTANCED:
      begin_draw (&draw, INDEXED);
      draw.index_count = UINT_ARG (1);
      draw.start_index = UINT_ARG (3);
      draw.base_vertex = INT_ARG (4);
      break;
    case DRAW_INSTANCED_INDIRECT:
      begin_draw (&draw, VERTICES_INDIRECT);
      draw.indirect_buffer = (guint64) (gsize) ARG (1);
      draw.indirect_offset = UINT_ARG (2);
      break;
    case DRAW_INDEXED_INSTANCED_INDIRECT:
      begin_draw (&draw, INDEXED_INDIRECT);
      draw.indirect_buffer = (guint64) (gsize) ARG (1);
      draw.indirect_offset = UINT_ARG (2);
      break;
    case CLEAR_STATE:
      state->synced = FALSE;
      return;
    case EXECUTE_COMMAND_LIST:
      if (UINT_ARG (2) == 0)
        state->synced = FALSE;
      return;
    case FINISH_COMMAND_LIST:
      if (UINT_ARG (1) == 0)
        state->synced = FALSE;
      return;
    case SWAP_STATE:
      state->synced = FALSE;
      return;
  }
  record_draw (state, &draw);
}

void on_leave (GumInvocationContext * ic)
{
  guint call = GUM_IC_GET_FUNC_DATA (ic, guintptr);
  Creation * creation = GUM_IC_GET_INVOCATION_DATA (ic, Creation);
  gint32 result = (gint32) (gsize) gum_invocation_context_get_return_value (ic);
  const guint32 * description;

  if (result < 0 || creation->result == NULL || *creation->result == NULL)
    return;
  switch (call)
  {
    case CREATE_BUFFER:
      description = creation->description;
      if ((description[2] & (BIND_VERTEX_BUFFER | BIND_INDEX_BUFFER)) != 0 && description[1] != USAGE_STAGING &&
          description[0] >= SMALLEST_MESH_BUFFER)
        on_buffer_created (*creation->result);
      break;
    case CREATE_INPUT_LAYOUT:
      on_input_layout (*creation->result, creation->description, creation->count);
      break;
    case CREATE_DEFERRED_CONTEXT:
      forget_state (*creation->result);
      break;
  }
}

void observe_draws (gint observing)
{
  tap.observing_draws = observing;
}

void request_turn (gpointer device)
{
  guint i, vacant = TURN_CAPACITY;
  g_mutex_lock (&tap.lock);
  for (i = 0; i != TURN_CAPACITY && tap.turn_devices[i] != device; i++)
  {
    if (vacant == TURN_CAPACITY && tap.turn_devices[i] == NULL)
      vacant = i;
  }
  if (i == TURN_CAPACITY && vacant != TURN_CAPACITY)
  {
    tap.turn_devices[vacant] = device;
    tap.turns_wanted++;
  }
  g_mutex_unlock (&tap.lock);
}

void request_any_turn (void)
{
  g_mutex_lock (&tap.lock);
  if (!tap.any_turn_wanted)
  {
    tap.any_turn_wanted = TRUE;
    tap.turns_wanted++;
  }
  g_mutex_unlock (&tap.lock);
}

void narrow_layout (gpointer layout, guint32 slots)
{
  guint index;
  g_mutex_lock (&tap.lock);
  index = layout_index (layout);
  if (index != LAYOUT_CAPACITY)
  {
    tap.layouts[index].layout = layout;
    tap.layouts[index].slots = slots;
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

static void note_creation (GumInvocationContext * ic, guint call)
{
  Creation * creation = GUM_IC_GET_INVOCATION_DATA (ic, Creation);
  creation->description = ARG (1);
  switch (call)
  {
    case CREATE_BUFFER:
      creation->result = ARG (3);
      break;
    case CREATE_INPUT_LAYOUT:
      creation->count = UINT_ARG (2);
      creation->result = ARG (5);
      break;
    case CREATE_DEFERRED_CONTEXT:
      creation->result = ARG (2);
      break;
  }
}

static ContextState * state_of (gpointer context)
{
  ContextState * state = gum_tls_key_get_value (tap.current_state);
  ContextState * vacant = NULL;
  gpointer device = NULL;
  guint i;

  if (state != NULL && state->context == context)
    return state;

  state = NULL;
  g_mutex_lock (&tap.lock);
  for (i = 0; i != STATE_COUNT; i++)
  {
    if (tap.states[i].context == context)
    {
      state = &tap.states[i];
      break;
    }
    if (vacant == NULL && tap.states[i].context == NULL)
      vacant = &tap.states[i];
  }
  if (state == NULL && vacant != NULL)
  {
    state = vacant;
    memset (state, 0, sizeof (ContextState));
    state->context = context;
  }
  g_mutex_unlock (&tap.lock);

  if (state == NULL)
    return NULL;
  if (state->device == NULL)
  {
    state->kind = ((GetTypeFunc) METHOD (context, CONTEXT_GET_TYPE)) (context);
    ((GetObjectFunc) METHOD (context, CONTEXT_GET_DEVICE)) (context, &device);
    release (device);
    state->device = device;
  }
  gum_tls_key_set_value (tap.current_state, state);
  return state;
}

static gboolean claim_turn (gpointer device)
{
  gboolean claimed = FALSE;
  guint i;
  g_mutex_lock (&tap.lock);
  if (tap.any_turn_wanted)
  {
    tap.any_turn_wanted = FALSE;
    tap.turns_wanted--;
    claimed = TRUE;
  }
  for (i = 0; i != TURN_CAPACITY; i++)
  {
    if (tap.turn_devices[i] == device)
    {
      tap.turn_devices[i] = NULL;
      tap.turns_wanted--;
      claimed = TRUE;
      break;
    }
  }
  g_mutex_unlock (&tap.lock);
  return claimed;
}

static void on_turn (gpointer context, gpointer device)
{
  enter_js ();
  deliver_turn (context, device);
  leave_js ();
}

static void note_vertex_buffers (ContextState * state, GumInvocationContext * ic)
{
  guint32 start = UINT_ARG (1), count = UINT_ARG (2), i;
  gpointer * buffers = ARG (3);
  const guint32 * strides = ARG (4), * offsets = ARG (5);
  for (i = 0; i != count; i++)
  {
    bind (state, start + i, (buffers != NULL) ? buffers[i] : NULL, (strides != NULL) ? strides[i] : 0,
        (offsets != NULL) ? offsets[i] : 0);
  }
}

static void begin_draw (Draw * draw, guint kind)
{
  memset (draw, 0, sizeof (Draw) - sizeof (draw->slots));
  draw->kind = kind;
}

static void record_draw (ContextState * state, Draw * draw)
{
  gboolean indexed = draw->kind == INDEXED || draw->kind == INDEXED_INDIRECT;
  guint32 relevant, bound;
  guint64 key;
  guint i;
  gboolean fresh;

  if (!tap.observing_draws)
    return;
  if (!state->synced)
    sync_state (state);
  if (!is_mesh_topology (state->topology))
    return;
  if (indexed && (state->index_buffer == NULL ||
      (state->index_format != FORMAT_R16_UINT && state->index_format != FORMAT_R32_UINT)))
    return;

  draw->device = (guint64) (gsize) state->device;
  draw->layout = (guint64) (gsize) state->layout;
  draw->topology = state->topology;
  draw->index_buffer = indexed ? (guint64) (gsize) state->index_buffer : 0;
  draw->index_format = indexed ? state->index_format : 0;
  draw->index_offset = indexed ? state->index_offset : 0;

  g_mutex_lock (&tap.lock);
  relevant = slots_that_matter (state->layout);
  bound = state->bound & relevant;
  key = mix (mix (mix (mix (mix (draw->layout, draw->topology), draw->kind), draw->index_buffer), draw->index_format),
      draw->index_offset);
  key = mix (mix (mix (mix (mix (key, draw->index_count), draw->start_index), (guint64) draw->base_vertex), draw->vertex_count),
      draw->start_vertex);
  key = mix (mix (key, draw->indirect_buffer), draw->indirect_offset);
  for (i = 0; i != SLOT_COUNT; i++)
  {
    const Binding * binding = &state->bindings[i];
    if ((bound & (1u << i)) == 0)
      continue;
    key = mix (mix (mix (mix (key, i), (guint64) (gsize) binding->buffer), binding->stride), binding->offset);
  }
  fresh = remember (key);
  g_mutex_unlock (&tap.lock);

  if (!fresh)
    return;
  draw->bound = state->bound;
  for (i = 0; i != SLOT_COUNT; i++)
  {
    const Binding * binding = &state->bindings[i];
    if ((state->bound & (1u << i)) == 0)
      continue;
    draw->slots[i].buffer = (guint64) (gsize) binding->buffer;
    draw->slots[i].stride = binding->stride;
    draw->slots[i].offset = binding->offset;
  }
  on_new_draw (draw);
}

static void on_buffer_created (gpointer buffer)
{
  enter_js ();
  deliver_buffer_created (buffer);
  leave_js ();
}

static void on_input_layout (gpointer layout, gconstpointer elements, guint32 count)
{
  enter_js ();
  deliver_input_layout (layout, elements, count);
  leave_js ();
}

static void forget_state (gpointer context)
{
  guint i;
  g_mutex_lock (&tap.lock);
  for (i = 0; i != STATE_COUNT; i++)
  {
    if (tap.states[i].context == context)
      tap.states[i].synced = FALSE;
  }
  g_mutex_unlock (&tap.lock);
}

static void sync_state (ContextState * state)
{
  gpointer context = state->context;
  gpointer buffers[SLOT_COUNT];
  guint32 strides[SLOT_COUNT], offsets[SLOT_COUNT];
  guint32 i;

  ((GetVertexBuffersFunc) METHOD (context, CONTEXT_IA_GET_VERTEX_BUFFERS)) (context, 0, SLOT_COUNT, buffers, strides, offsets);
  for (i = 0; i != SLOT_COUNT; i++)
  {
    bind (state, i, buffers[i], strides[i], offsets[i]);
    release (buffers[i]);
  }
  state->index_buffer = NULL;
  ((GetIndexBufferFunc) METHOD (context, CONTEXT_IA_GET_INDEX_BUFFER)) (context, &state->index_buffer, &state->index_format,
      &state->index_offset);
  release (state->index_buffer);
  state->layout = NULL;
  ((GetObjectFunc) METHOD (context, CONTEXT_IA_GET_INPUT_LAYOUT)) (context, &state->layout);
  release (state->layout);
  ((GetTopologyFunc) METHOD (context, CONTEXT_IA_GET_PRIMITIVE_TOPOLOGY)) (context, &state->topology);
  state->synced = TRUE;
}

static gboolean is_mesh_topology (guint32 topology)
{
  return topology == 1 || topology == 4 || topology == 5 || topology == 35;
}

static guint32 slots_that_matter (gpointer layout)
{
  guint index = layout_index (layout);
  return (index != LAYOUT_CAPACITY && tap.layouts[index].layout == layout) ? tap.layouts[index].slots : ALL_SLOTS;
}

static guint64 mix (guint64 hash, guint64 value)
{
  hash ^= value + 0x9e3779b97f4a7c15ull + (hash << 6) + (hash >> 2);
  return hash * 0x100000001b3ull;
}

static gboolean remember (guint64 key)
{
  guint index;
  if (key == 0)
    key = 1;
  index = (guint) key & (SEEN_CAPACITY - 1);
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

static void release (gpointer object)
{
  if (object != NULL)
    ((ReleaseFunc) METHOD (object, IUNKNOWN_RELEASE)) (object);
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

static void bind (ContextState * state, guint32 slot, gpointer buffer, guint32 stride, guint32 offset)
{
  Binding * binding;
  if (slot >= SLOT_COUNT)
    return;
  binding = &state->bindings[slot];
  binding->buffer = buffer;
  binding->stride = stride;
  binding->offset = offset;
  if (buffer != NULL)
    state->bound |= 1u << slot;
  else
    state->bound &= ~(1u << slot);
}

static guint layout_index (gpointer layout)
{
  guint index = ((gsize) layout >> 4) % LAYOUT_CAPACITY;
  guint probes;
  for (probes = 0; probes != LAYOUT_CAPACITY; probes++)
  {
    if (tap.layouts[index].layout == layout || tap.layouts[index].layout == NULL)
      return index;
    index = (index + 1) % LAYOUT_CAPACITY;
  }
  return LAYOUT_CAPACITY;
}
`;

export class ContextTap {
    readonly #state = Memory.alloc(TAP_STATE_SIZE);
    readonly #callbacks: NativeCallback<any, any>[];
    readonly #tap: CModule;
    readonly #listeners: InvocationListener[] = [];
    readonly #observe: NativeFunction<void, [number]>;
    readonly #requestTurnOf: NativeFunction<void, [NativePointerValue]>;
    readonly #requestAnyTurnNow: NativeFunction<void, []>;
    readonly #narrow: NativeFunction<void, [NativePointerValue, number]>;
    readonly #waitUntilIdle: NativeFunction<void, []>;

    constructor(targets: HookTarget[], events: TapEvents) {
        const onNewDraw = new NativeCallback(draw => events.newDraw(tappedDrawOf(Draw.at(draw))), "void", ["pointer"]);
        const onTurn = new NativeCallback((context, device) => events.turn(context, device), "void", ["pointer", "pointer"]);
        const onBufferCreated = new NativeCallback(buffer => events.bufferCreated(buffer), "void", ["pointer"]);
        const onInputLayout = new NativeCallback((layout, elements, count) => events.inputLayoutCreated(layout, elements, count), "void",
            ["pointer", "pointer", "uint32"]);
        this.#callbacks = [onNewDraw, onTurn, onBufferCreated, onInputLayout];
        const comCall = (Process.arch === "ia32") ? "__attribute__ ((stdcall))" : "";
        this.#tap = new CModule(`#define COM_CALL ${comCall}\n${source}`, {
            tap: this.#state,
            deliver_new_draw: onNewDraw,
            deliver_turn: onTurn,
            deliver_buffer_created: onBufferCreated,
            deliver_input_layout: onInputLayout,
        });
        this.#observe = new NativeFunction(this.#tap.observe_draws, "void", ["int"]);
        this.#requestTurnOf = new NativeFunction(this.#tap.request_turn, "void", ["pointer"]);
        this.#requestAnyTurnNow = new NativeFunction(this.#tap.request_any_turn, "void", []);
        this.#narrow = new NativeFunction(this.#tap.narrow_layout, "void", ["pointer", "uint32"]);
        this.#waitUntilIdle = new NativeFunction(this.#tap.wait_until_idle, "void", []);

        for (const { call, address } of targets) {
            const leave = creationCalls.has(call) ? { onLeave: this.#tap.on_leave } : {};
            this.#listeners.push(Interceptor.attach(address, { onEnter: this.#tap.on_enter, ...leave }, ptr(callIds[call])));
        }
    }

    observeDraws(watch: DrawWatch): void {
        this.#observe((watch === "observed") ? 1 : 0);
    }

    requestTurn(device: NativePointer): void {
        this.#requestTurnOf(device);
    }

    requestAnyTurn(): void {
        this.#requestAnyTurnNow();
    }

    narrowLayout(layout: NativePointer, slots: number): void {
        this.#narrow(layout, slots >>> 0);
    }

    dispose(): void {
        this.#observe(0);
        for (const listener of this.#listeners) {
            listener.detach();
        }
        Interceptor.flush();
        this.#waitUntilIdle();
        this.#tap.dispose();
    }
}

function tappedDrawOf(draw: Draw): TappedDraw {
    const bound = draw.bound.toNumber();
    const slots: TappedSlot[] = [];
    draw.slots.forEach((slot, index) => {
        if (((bound >>> index) & 1) === 0) {
            return;
        }
        slots.push({ index, buffer: slot.buffer, stride: slot.stride.toNumber(), offset: slot.offset.toNumber() });
    });
    return {
        device: draw.device,
        kind: drawKinds[draw.kind.toNumber()],
        layout: draw.layout,
        topology: draw.topology.toNumber(),
        indexBuffer: draw.indexBuffer,
        indexFormat: draw.indexFormat.toNumber(),
        indexOffset: draw.indexOffset.toNumber(),
        indexCount: draw.indexCount.toNumber(),
        startIndex: draw.startIndex.toNumber(),
        baseVertex: draw.baseVertex.toNumber(),
        vertexCount: draw.vertexCount.toNumber(),
        startVertex: draw.startVertex.toNumber(),
        indirectBuffer: draw.indirectBuffer,
        indirectOffset: draw.indirectOffset.toNumber(),
        slots,
    };
}
