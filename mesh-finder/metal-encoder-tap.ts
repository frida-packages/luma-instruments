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
    role: SlotRole;
    buffer: NativePointer;
    offset: number;
    stride: number | null;
    bytes: NativePointer;
    bytesLength: number;
    bytesDigest: string;
}

export type SlotRole = "may-hold-vertices" | "bystander";

const SLOT_COUNT = 31;
const DRAW_HEADER_SIZE = 112;
const SLOT_SIZE = 56;
const STATIC_STRIDE = "18446744073709551615";
const TAP_STATE_SIZE = 4 * 1048576;

const source = `
#include <gum/guminterceptor.h>
#include <gum/gumtls.h>
#include <string.h>

#define SLOT_COUNT 31
#define STATE_COUNT 64
#define BYTES_CAPACITY 4096
#define SEEN_BUCKETS 8192
#define SEEN_PER_BUCKET 8
#define PIPELINE_CAPACITY 4096
#define PLACE_BUCKETS 2048
#define PLACES_PER_BUCKET 8
#define SAMPLED_WINDOWS 3
#define SAMPLE_SPACING 64
#define WATCHED_BUFFER_CAPACITY 4096
#define REWRITES_OF_SCRATCH 8
#define QUIET_PASSES 32
#define REWRITE_WINDOW 1048576
#define UNANNOUNCED_CAPACITY 64
#define FINGERPRINT_WINDOW 32
#define ALL_SLOTS 0x7fffffffu
#define STATIC_STRIDE 0xffffffffffffffffull
#define IGNORED_CAPACITY 8
#define ADDRESS_BITS 0x00007fffffffffffull
#define MIX(hash, value) \\
    hash = ((hash) ^ ((guint64) (value) + 0x9e3779b97f4a7c15ull + ((hash) << 6) + ((hash) >> 2))) * 0x100000001b3ull

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
  guint64 bytes_digest;
  guint64 bound_after_draws;
} Slot;

typedef enum { BUFFER_QUIET, BUFFER_UNSETTLED, BUFFER_SCRATCH } BufferState;

typedef struct
{
  gpointer buffer;
  guint64 probe_offset;
  guint64 probe_sample;
  guint64 probed_in_pass;
  guint64 quiet_since_pass;
  guint64 counting_since;
  guint32 rewrites;
  gboolean is_scratch;
} WatchedBuffer;

typedef struct
{
  gpointer encoder;
  gpointer pipeline;
  guint32 bound;
  guint64 draws_made;
  guint64 began_at;
  gpointer indices;
  WatchedBuffer * watched_indices;
  WatchedBuffer * watched[SLOT_COUNT];
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
  guint64 may_hold_vertices;
  Slot slots[SLOT_COUNT];
} Draw;

typedef struct
{
  guint64 key;
  guint64 seen_at;
} Seen;

typedef struct
{
  guint64 place;
  guint64 seen_at;
  guint64 unchanged_since;
  guint64 sample;
} Place;

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
  guint ignored_count;
  guint unannounced_count;
  guint64 draws_seen;
  guint64 passes_begun;
  gpointer contents_selector;
  gpointer length_selector;
  CallerRange ignored[IGNORED_CAPACITY];
  gpointer unannounced[UNANNOUNCED_CAPACITY];
  EncoderState states[STATE_COUNT];
  gpointer pipelines[PIPELINE_CAPACITY];
  guint32 pipeline_slots[PIPELINE_CAPACITY];
  guint32 pipeline_slots_guessed[PIPELINE_CAPACITY];
  WatchedBuffer watched[WATCHED_BUFFER_CAPACITY];
  Seen seen[SEEN_BUCKETS * SEEN_PER_BUCKET];
  Place places[PLACE_BUCKETS * PLACES_PER_BUCKET];
} Tap;

typedef gpointer (* PointerGetter) (gpointer self, gpointer op);
typedef guint64 (* ValueGetter) (gpointer self, gpointer op);

extern Tap tap;
extern void deliver_new_draw (Draw * draw);
extern void deliver_scratch_buffer (gpointer buffer);
extern gpointer objc_msgSend (gpointer self, gpointer op, ...);
extern gpointer sel_registerName (const gchar * name);

static gboolean is_ignored_caller (GumInvocationContext * ic);
static void end_encoding (gpointer encoder);
static EncoderState * state_of (gpointer encoder);
static void bind_buffer (EncoderState * state, guint64 index, gpointer buffer, guint64 offset, guint64 stride);
static void move_buffer (EncoderState * state, guint64 index, guint64 offset, guint64 stride);
static void bind_bytes (EncoderState * state, guint64 index, gconstpointer bytes, guint64 length, guint64 stride);
static guint64 digest_of (const guint8 * bytes, guint64 length);
static void record_draw (EncoderState * state, Draw * draw);
static guint64 indices_of (EncoderState * state, const Draw * draw, gboolean * settled);
static guint64 fingerprint_of (const guint8 * data, guint64 length);
static guint32 slots_that_matter (gpointer pipeline);
static guint32 slots_guessed_to_hold_vertices (gpointer pipeline);
static guint32 slots_holding_still (EncoderState * state, guint32 slots);
static guint64 place_of (gpointer buffer, guint64 offset);
static gboolean is_settled (guint64 place, guint64 sample, guint64 before);
static BufferState watch_buffer (gpointer buffer, guint64 offset, WatchedBuffer ** known);
static WatchedBuffer * watched_buffer_of (gpointer buffer);
static guint64 sample_at (gpointer buffer, guint64 offset);
static guint32 last_bound_of (const EncoderState * state, guint32 slots);
static guint64 binding_of (const Slot * slot);
static gboolean remember (guint64 key);
static void announce_scratch_buffers (void);
static void on_new_draw (Draw * draw);
static guint pipeline_index (gpointer pipeline);
static void enter_js (void);
static void leave_js (void);

void init (void)
{
  g_mutex_init (&tap.lock);
  g_cond_init (&tap.idle);
  tap.current_state = gum_tls_key_new ();
  tap.contents_selector = sel_registerName ("contents");
  tap.length_selector = sel_registerName ("length");
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

void note_guessed_slot (gpointer pipeline, guint32 slot)
{
  guint index;
  g_mutex_lock (&tap.lock);
  index = pipeline_index (pipeline);
  if (index != PIPELINE_CAPACITY)
  {
    tap.pipelines[index] = pipeline;
    tap.pipeline_slots_guessed[index] |= 1u << slot;
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
    state->draws_made = 0;
    state->began_at = tap.draws_seen;
    state->indices = NULL;
    tap.passes_begun++;
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
  if (slot->buffer != buffer)
    state->watched[index] = NULL;
  slot->buffer = buffer;
  slot->offset = offset;
  slot->stride = stride;
  slot->bytes_length = 0;
  slot->bound_after_draws = state->draws_made;
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
  state->slots[index].bound_after_draws = state->draws_made;
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
  slot->bytes_digest = digest_of (slot->bytes, length);
  slot->bound_after_draws = state->draws_made;
  state->bound |= 1u << index;
}

static guint64 digest_of (const guint8 * bytes, guint64 length)
{
  guint64 digest = length, word, i;
  for (i = 0; i + 8 <= length; i += 8)
  {
    memcpy (&word, bytes + i, 8);
    MIX (digest, word);
  }
  for (; i != length; i++)
    MIX (digest, bytes[i]);
  return digest;
}

static void record_draw (EncoderState * state, Draw * draw)
{
  guint64 key;
  guint32 declared, relevant;
  guint i;
  gboolean indices_settled = TRUE, fresh, scratch_found;

  key = (guint64) state->pipeline;
  MIX (key, draw->primitive | (draw->index_type << 8));
  MIX (key, draw->index_count);
  MIX (key, draw->vertex_start);
  MIX (key, draw->vertex_count);
  MIX (key, draw->base_vertex);
  if (draw->indirect_buffer != NULL)
  {
    MIX (key, draw->indirect_buffer);
    MIX (key, draw->indirect_offset);
  }

  g_mutex_lock (&tap.lock);
  tap.draws_seen++;
  if (draw->index_buffer != NULL)
    MIX (key, indices_of (state, draw, &indices_settled));
  declared = slots_that_matter (state->pipeline);
  relevant = slots_holding_still (state, declared & state->bound);
  if (declared == ALL_SLOTS)
    relevant &= last_bound_of (state, (relevant | slots_guessed_to_hold_vertices (state->pipeline)) & state->bound);
  for (i = 0; (relevant >> i) != 0; i++)
  {
    if ((relevant & (1u << i)) != 0)
    {
      MIX (key, i);
      MIX (key, binding_of (&state->slots[i]));
    }
  }
  fresh = relevant != 0 && indices_settled && remember (key);
  scratch_found = tap.unannounced_count != 0;
  g_mutex_unlock (&tap.lock);
  state->draws_made++;

  if (scratch_found)
    announce_scratch_buffers ();
  if (!fresh)
    return;
  draw->pipeline = state->pipeline;
  draw->bound = state->bound;
  draw->may_hold_vertices = relevant;
  memcpy (draw->slots, state->slots, sizeof (state->slots));
  on_new_draw (draw);
}

static guint64 indices_of (EncoderState * state, const Draw * draw, gboolean * settled)
{
  gpointer buffer = draw->index_buffer;
  BufferState buffer_state;
  const guint8 * contents;
  guint64 place;

  if (state->indices != buffer)
  {
    state->indices = buffer;
    state->watched_indices = NULL;
  }
  buffer_state = watch_buffer (buffer, draw->index_offset, &state->watched_indices);
  if (buffer_state == BUFFER_SCRATCH && draw->indirect_buffer == NULL)
  {
    contents = ((PointerGetter) objc_msgSend) (buffer, tap.contents_selector);
    return fingerprint_of (contents + draw->index_offset, draw->index_count * ((draw->index_type == 0) ? 2 : 4));
  }
  place = place_of (buffer, draw->index_offset);
  *settled = buffer_state == BUFFER_QUIET && is_settled (place, sample_at (buffer, draw->index_offset), state->began_at);
  return place;
}

static guint64 fingerprint_of (const guint8 * data, guint64 length)
{
  guint64 middle = (length / 2) & ~(guint64) 3;
  guint64 fingerprint = length, words[FINGERPRINT_WINDOW / 8];
  guint64 starts[3];
  guint i, k;

  if (length < 3 * FINGERPRINT_WINDOW)
    return digest_of (data, length);
  starts[0] = 0;
  starts[1] = middle;
  starts[2] = length - FINGERPRINT_WINDOW;
  for (i = 0; i != 3; i++)
  {
    memcpy (words, data + starts[i], FINGERPRINT_WINDOW);
    for (k = 0; k != FINGERPRINT_WINDOW / 8; k++)
      MIX (fingerprint, words[k]);
  }
  return fingerprint;
}

static guint32 slots_that_matter (gpointer pipeline)
{
  guint index = pipeline_index (pipeline);
  gboolean declared = index != PIPELINE_CAPACITY && tap.pipelines[index] == pipeline && tap.pipeline_slots[index] != 0;
  return declared ? tap.pipeline_slots[index] : ALL_SLOTS;
}

static guint32 slots_guessed_to_hold_vertices (gpointer pipeline)
{
  guint index = pipeline_index (pipeline);
  return (index != PIPELINE_CAPACITY && tap.pipelines[index] == pipeline) ? tap.pipeline_slots_guessed[index] : 0;
}

static guint32 slots_holding_still (EncoderState * state, guint32 slots)
{
  guint32 still = 0;
  guint i;

  for (i = 0; (slots >> i) != 0; i++)
  {
    const Slot * slot = &state->slots[i];
    gboolean settled;

    if ((slots & (1u << i)) == 0)
      continue;
    if (slot->bytes_length != 0)
      settled = is_settled (place_of (NULL, slot->bytes_digest), 0, state->began_at);
    else if (watch_buffer (slot->buffer, slot->offset, &state->watched[i]) != BUFFER_QUIET)
      continue;
    else
      settled = is_settled (place_of (slot->buffer, slot->offset), sample_at (slot->buffer, slot->offset), state->began_at);
    if (settled)
      still |= 1u << i;
  }
  return still;
}

static guint64 place_of (gpointer buffer, guint64 offset)
{
  guint64 place = (guint64) buffer;
  MIX (place, offset);
  return place;
}

static gboolean is_settled (guint64 place, guint64 sample, guint64 before)
{
  Place * bucket = &tap.places[((place >> 40) % PLACE_BUCKETS) * PLACES_PER_BUCKET];
  Place * longest_unseen = bucket;
  guint i;

  for (i = 0; i != PLACES_PER_BUCKET; i++)
  {
    if (bucket[i].place == place)
    {
      bucket[i].seen_at = tap.draws_seen;
      if (bucket[i].sample == sample)
        return bucket[i].unchanged_since <= before;
      bucket[i].sample = sample;
      bucket[i].unchanged_since = tap.draws_seen;
      return FALSE;
    }
    if (bucket[i].seen_at < longest_unseen->seen_at)
      longest_unseen = &bucket[i];
  }
  longest_unseen->place = place;
  longest_unseen->sample = sample;
  longest_unseen->seen_at = tap.draws_seen;
  longest_unseen->unchanged_since = tap.draws_seen;
  return FALSE;
}

static BufferState watch_buffer (gpointer buffer, guint64 offset, WatchedBuffer ** known)
{
  WatchedBuffer * watched = *known;

  if (watched == NULL)
  {
    watched = watched_buffer_of (buffer);
    if (watched == NULL)
      return BUFFER_UNSETTLED;
    *known = watched;
  }
  if (watched->is_scratch)
    return BUFFER_SCRATCH;
  if (watched->buffer == NULL)
  {
    watched->buffer = buffer;
    watched->probe_offset = offset;
    watched->probe_sample = sample_at (buffer, offset);
    watched->probed_in_pass = tap.passes_begun;
    watched->quiet_since_pass = tap.passes_begun;
    watched->counting_since = tap.draws_seen;
    return BUFFER_UNSETTLED;
  }
  if (watched->probed_in_pass != tap.passes_begun)
  {
    watched->probed_in_pass = tap.passes_begun;
    if (sample_at (buffer, watched->probe_offset) != watched->probe_sample)
    {
      if (tap.draws_seen - watched->counting_since > REWRITE_WINDOW)
      {
        watched->counting_since = tap.draws_seen;
        watched->rewrites = 0;
      }
      watched->probe_offset = offset;
      watched->probe_sample = sample_at (buffer, offset);
      watched->quiet_since_pass = tap.passes_begun;
      if (++watched->rewrites >= REWRITES_OF_SCRATCH && tap.unannounced_count != UNANNOUNCED_CAPACITY)
      {
        watched->is_scratch = TRUE;
        tap.unannounced[tap.unannounced_count++] = buffer;
        return BUFFER_SCRATCH;
      }
    }
  }
  return (tap.passes_begun - watched->quiet_since_pass >= QUIET_PASSES) ? BUFFER_QUIET : BUFFER_UNSETTLED;
}

static WatchedBuffer * watched_buffer_of (gpointer buffer)
{
  guint index = ((guint64) buffer >> 4) % WATCHED_BUFFER_CAPACITY;
  guint probes;
  for (probes = 0; probes != WATCHED_BUFFER_CAPACITY; probes++)
  {
    if (tap.watched[index].buffer == buffer || tap.watched[index].buffer == NULL)
      return &tap.watched[index];
    index = (index + 1) % WATCHED_BUFFER_CAPACITY;
  }
  return NULL;
}

static guint64 sample_at (gpointer buffer, guint64 offset)
{
  const guint8 * contents = ((PointerGetter) objc_msgSend) (buffer, tap.contents_selector);
  guint64 length, sample = 0, words[2];
  guint window;

  if (contents == NULL)
    return 0;
  length = ((ValueGetter) objc_msgSend) (buffer, tap.length_selector);
  for (window = 0; window != SAMPLED_WINDOWS && offset + window * SAMPLE_SPACING + 16 <= length; window++)
  {
    memcpy (words, contents + offset + window * SAMPLE_SPACING, 16);
    sample = (sample ^ words[0]) * 0x100000001b3ull;
    sample = (sample ^ words[1]) * 0x100000001b3ull;
  }
  return sample;
}

static guint32 last_bound_of (const EncoderState * state, guint32 slots)
{
  guint64 latest = 0;
  guint32 last_bound = 0;
  guint i;

  for (i = 0; (slots >> i) != 0; i++)
  {
    if ((slots & (1u << i)) != 0 && state->slots[i].bound_after_draws > latest)
      latest = state->slots[i].bound_after_draws;
  }
  for (i = 0; (slots >> i) != 0; i++)
  {
    if ((slots & (1u << i)) != 0 && state->slots[i].bound_after_draws == latest)
      last_bound |= 1u << i;
  }
  return last_bound;
}

static guint64 binding_of (const Slot * slot)
{
  guint64 binding = (guint64) slot->buffer;
  MIX (binding, slot->offset);
  MIX (binding, slot->stride);
  if (slot->bytes_length != 0)
  {
    MIX (binding, slot->bytes_length);
    MIX (binding, slot->bytes_digest);
  }
  return binding;
}

static gboolean remember (guint64 key)
{
  Seen * bucket = &tap.seen[((key >> 40) % SEEN_BUCKETS) * SEEN_PER_BUCKET];
  Seen * longest_unseen = bucket;
  guint i;

  for (i = 0; i != SEEN_PER_BUCKET; i++)
  {
    if (bucket[i].key == key)
    {
      bucket[i].seen_at = tap.draws_seen;
      return FALSE;
    }
    if (bucket[i].seen_at < longest_unseen->seen_at)
      longest_unseen = &bucket[i];
  }
  longest_unseen->key = key;
  longest_unseen->seen_at = tap.draws_seen;
  return TRUE;
}

static void announce_scratch_buffers (void)
{
  gpointer buffers[UNANNOUNCED_CAPACITY];
  guint count, i;

  g_mutex_lock (&tap.lock);
  count = tap.unannounced_count;
  memcpy (buffers, tap.unannounced, count * sizeof (gpointer));
  tap.unannounced_count = 0;
  g_mutex_unlock (&tap.lock);

  enter_js ();
  for (i = 0; i != count; i++)
    deliver_scratch_buffer (buffers[i]);
  leave_js ();
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
    private readonly onScratchBuffer: NativeCallback<"void", ["pointer"]>;
    private readonly state: NativePointer;
    private readonly tap: CModule;
    private readonly listeners: InvocationListener[] = [];
    private readonly setSlots: NativeFunction<void, [NativePointerValue, number]>;
    private readonly noteGuessed: NativeFunction<void, [NativePointerValue, number]>;
    private readonly ignore: NativeFunction<void, [number | UInt64, number | UInt64]>;
    private readonly waitUntilIdle: NativeFunction<void, []>;

    constructor(deliver: (draw: EncodedDraw) => void, scratchFound: (buffer: NativePointer) => void) {
        this.onNewDraw = new NativeCallback(draw => deliver(parseDraw(draw)), "void", ["pointer"]);
        this.onScratchBuffer = new NativeCallback(scratchFound, "void", ["pointer"]);
        this.state = Memory.alloc(TAP_STATE_SIZE);
        this.tap = new CModule(source, {
            tap: this.state,
            deliver_new_draw: this.onNewDraw,
            deliver_scratch_buffer: this.onScratchBuffer,
            objc_msgSend: Module.getGlobalExportByName("objc_msgSend"),
            sel_registerName: Module.getGlobalExportByName("sel_registerName"),
        });
        this.setSlots = new NativeFunction(this.tap.set_pipeline_slots, "void", ["pointer", "uint32"]);
        this.noteGuessed = new NativeFunction(this.tap.note_guessed_slot, "void", ["pointer", "uint32"]);
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

    noteGuessedSlot(pipeline: NativePointer, slot: number): void {
        this.noteGuessed(pipeline, slot);
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
    const mayHoldVertices = field(13).readU32();
    const slots: EncodedSlot[] = [];
    for (let index = 0; index !== SLOT_COUNT; index++) {
        if ((bound & (1 << index)) === 0) {
            continue;
        }
        const slot = draw.add(DRAW_HEADER_SIZE + index * SLOT_SIZE);
        const stride = slot.add(16).readU64();
        slots.push({
            index,
            role: ((mayHoldVertices & (1 << index)) !== 0) ? "may-hold-vertices" : "bystander",
            buffer: slot.readPointer(),
            offset: slot.add(8).readU64().toNumber(),
            stride: (stride.toString() === STATIC_STRIDE) ? null : stride.toNumber(),
            bytes: slot.add(24).readPointer(),
            bytesLength: slot.add(32).readU64().toNumber(),
            bytesDigest: slot.add(40).readU64().toString(16),
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
