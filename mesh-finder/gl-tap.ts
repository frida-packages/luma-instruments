import { Draw } from "./gl-draw.pat";

export type GLCall =
    | "drawArrays"
    | "drawArraysInstanced"
    | "drawElements"
    | "drawElementsInstanced"
    | "drawElementsBaseVertex"
    | "drawElementsInstancedBaseVertex"
    | "drawRangeElements"
    | "drawRangeElementsBaseVertex"
    | "vertexAttribPointer"
    | "bufferData"
    | "bufferSubData"
    | "mapBufferRange"
    | "mapBuffer"
    | "unmapBuffer"
    | "deleteBuffers";

export interface GLDraw {
    shareGroup: NativePointer;
    program: number;
    vertexArray: number;
    elementBuffer: number;
    mode: number;
    count: number;
    type: number;
    indices: number;
    first: number;
    baseVertex: number;
}

export type UploadKind = "data" | "sub-data" | "mapped";

export type DrawWatch = "observed" | "ignored";

export interface GLUpload {
    kind: UploadKind;
    shareGroup: NativePointer;
    buffer: number;
    offset: number;
    length: number;
    data: NativePointer;
}

export interface GLTapEvents {
    newDraw(draw: GLDraw): void;
    frame(shareGroup: NativePointer): void;
    upload(upload: GLUpload): void;
    deleted(shareGroup: NativePointer, buffer: number): void;
}

export interface GLTapPlatform {
    shareGroupSource: string;
    shareGroupSymbols: Record<string, NativePointer>;
    entryPoint(name: string): NativePointer | null;
    hookTargets(name: string): NativePointer[];
}

const callIds: Record<GLCall, number> = {
    drawArrays: 1,
    drawArraysInstanced: 2,
    drawElements: 3,
    drawElementsInstanced: 4,
    drawElementsBaseVertex: 5,
    drawElementsInstancedBaseVertex: 6,
    drawRangeElements: 7,
    drawRangeElementsBaseVertex: 8,
    vertexAttribPointer: 9,
    bufferData: 10,
    bufferSubData: 11,
    mapBufferRange: 12,
    mapBuffer: 13,
    unmapBuffer: 14,
    deleteBuffers: 15,
};

const entryPointNames: Record<GLCall, string[]> = {
    drawArrays: ["glDrawArrays"],
    drawArraysInstanced: ["glDrawArraysInstanced", "glDrawArraysInstancedARB", "glDrawArraysInstancedEXT"],
    drawElements: ["glDrawElements"],
    drawElementsInstanced: ["glDrawElementsInstanced", "glDrawElementsInstancedARB", "glDrawElementsInstancedEXT"],
    drawElementsBaseVertex: ["glDrawElementsBaseVertex", "glDrawElementsBaseVertexOES", "glDrawElementsBaseVertexEXT"],
    drawElementsInstancedBaseVertex: ["glDrawElementsInstancedBaseVertex", "glDrawElementsInstancedBaseVertexOES",
        "glDrawElementsInstancedBaseVertexEXT"],
    drawRangeElements: ["glDrawRangeElements"],
    drawRangeElementsBaseVertex: ["glDrawRangeElementsBaseVertex", "glDrawRangeElementsBaseVertexOES", "glDrawRangeElementsBaseVertexEXT"],
    vertexAttribPointer: ["glVertexAttribPointer"],
    bufferData: ["glBufferData"],
    bufferSubData: ["glBufferSubData"],
    mapBufferRange: ["glMapBufferRange", "glMapBufferRangeEXT"],
    mapBuffer: ["glMapBuffer", "glMapBufferOES"],
    unmapBuffer: ["glUnmapBuffer", "glUnmapBufferOES"],
    deleteBuffers: ["glDeleteBuffers"],
};

export const glTapEntryPointNames = Object.values(entryPointNames).flat();

const uploadKinds: UploadKind[] = ["data", "sub-data", "mapped"];

const TAP_STATE_SIZE = 2 * 1048576;

const source = `
#include <gum/guminterceptor.h>
#include <string.h>

#define SEEN_CAPACITY 65536
#define LAYOUT_CAPACITY 4096
#define SHADOW_CAPACITY 16384
#define MAP_CAPACITY 64
#define ATTRIBUTE_SLOTS 16

#define GL_ARRAY_BUFFER 0x8892
#define GL_ELEMENT_ARRAY_BUFFER 0x8893
#define GL_ARRAY_BUFFER_BINDING 0x8894
#define GL_ELEMENT_ARRAY_BUFFER_BINDING 0x8895
#define GL_VERTEX_ARRAY_BINDING 0x85B5
#define GL_CURRENT_PROGRAM 0x8B8D
#define GL_STATIC_DRAW 0x88E4
#define GL_MAP_WRITE_BIT 0x0002
#define GL_WRITE_ONLY 0x88B9
#define GL_READ_WRITE 0x88BA

enum
{
  DRAW_ARRAYS = 1,
  DRAW_ARRAYS_INSTANCED,
  DRAW_ELEMENTS,
  DRAW_ELEMENTS_INSTANCED,
  DRAW_ELEMENTS_BASE_VERTEX,
  DRAW_ELEMENTS_INSTANCED_BASE_VERTEX,
  DRAW_RANGE_ELEMENTS,
  DRAW_RANGE_ELEMENTS_BASE_VERTEX,
  VERTEX_ATTRIB_POINTER,
  BUFFER_DATA,
  BUFFER_SUB_DATA,
  MAP_BUFFER_RANGE,
  MAP_BUFFER,
  UNMAP_BUFFER,
  DELETE_BUFFERS
};

enum { UPLOAD_DATA, UPLOAD_SUB_DATA, UPLOAD_MAPPED };

typedef struct
{
  gpointer share_group;
  guint64 program;
  guint64 vertex_array;
  guint64 element_buffer;
  guint64 mode;
  guint64 count;
  guint64 type;
  guint64 indices;
  guint64 first;
  gint64 base_vertex;
} Draw;

typedef struct
{
  gpointer share_group;
  guint64 vertex_array;
  guint64 attributes[ATTRIBUTE_SLOTS];
} Layout;

typedef struct
{
  gpointer share_group;
  guint64 buffer;
} ShadowKey;

typedef struct
{
  gpointer share_group;
  guint64 target;
  guint64 buffer;
  guint64 offset;
  guint64 length;
  gpointer data;
} PendingMap;

typedef enum { FIND_EXISTING, FIND_OR_CLAIM } Lookup;

typedef struct
{
  GMutex lock;
  GCond idle;
  guint callbacks_running;
  guint seen_count;
  gboolean frame_requested;
  gboolean observing;
  guint64 seen[SEEN_CAPACITY];
  Layout layouts[LAYOUT_CAPACITY];
  ShadowKey shadows[SHADOW_CAPACITY];
  PendingMap maps[MAP_CAPACITY];
} Tap;

extern Tap tap;
extern void glGetIntegerv (guint32 name, gint32 * value);
extern void deliver_new_draw (Draw * draw);
extern void deliver_frame (gpointer share_group);
extern void deliver_upload (guint32 kind, gpointer share_group, guint64 buffer, guint64 offset, guint64 length, gconstpointer data);
extern void deliver_deleted (gpointer share_group, guint64 buffer);

#define ARG(n) ((guint64) gum_invocation_context_get_nth_argument (ic, n))

SHARE_GROUP_SOURCE

static void note_draw (GumInvocationContext * ic, guint call);
static void note_attribute_pointer (GumInvocationContext * ic);
static void note_buffer_data (GumInvocationContext * ic);
static void note_buffer_sub_data (GumInvocationContext * ic);
static void note_mapping (GumInvocationContext * ic, guint call);
static void note_unmap (GumInvocationContext * ic);
static void note_deleted (GumInvocationContext * ic);
static void note_mapped (GumInvocationContext * ic);
static void record_draw (Draw * draw);
static guint32 binding_of (guint64 target);
static void on_upload (guint32 kind, gpointer share_group, guint64 buffer, guint64 offset, guint64 length, gconstpointer data);
static gboolean is_shadowed (gpointer share_group, guint64 buffer);
static void on_deleted (gpointer share_group, guint64 buffer);
static ShadowKey * shadow_slot (gpointer share_group, guint64 buffer, Lookup lookup);
static guint32 integer (guint32 name);
static Layout * layout_of (gpointer share_group, guint64 vertex_array, Lookup lookup);
static void on_frame (gpointer share_group);
static gboolean remember (guint64 key);
static void on_new_draw (Draw * draw);
static guint64 mix (guint64 hash, guint64 value);
static void enter_js (void);
static void leave_js (void);

void init (void)
{
  g_mutex_init (&tap.lock);
  g_cond_init (&tap.idle);
}

void finalize (void)
{
  g_cond_clear (&tap.idle);
  g_mutex_clear (&tap.lock);
}

void on_enter (GumInvocationContext * ic)
{
  guint call = GUM_IC_GET_FUNC_DATA (ic, guintptr);

  switch (call)
  {
    case DRAW_ARRAYS:
    case DRAW_ARRAYS_INSTANCED:
    case DRAW_ELEMENTS:
    case DRAW_ELEMENTS_INSTANCED:
    case DRAW_ELEMENTS_BASE_VERTEX:
    case DRAW_ELEMENTS_INSTANCED_BASE_VERTEX:
    case DRAW_RANGE_ELEMENTS:
    case DRAW_RANGE_ELEMENTS_BASE_VERTEX:
      note_draw (ic, call);
      return;
    case VERTEX_ATTRIB_POINTER:
      note_attribute_pointer (ic);
      return;
    case BUFFER_DATA:
      note_buffer_data (ic);
      return;
    case BUFFER_SUB_DATA:
      note_buffer_sub_data (ic);
      return;
    case MAP_BUFFER_RANGE:
    case MAP_BUFFER:
      note_mapping (ic, call);
      return;
    case UNMAP_BUFFER:
      note_unmap (ic);
      return;
    case DELETE_BUFFERS:
      note_deleted (ic);
      return;
  }
}

void on_leave (GumInvocationContext * ic)
{
  note_mapped (ic);
}

void request_frame (void)
{
  g_mutex_lock (&tap.lock);
  tap.frame_requested = TRUE;
  g_mutex_unlock (&tap.lock);
}

void set_observing (gboolean observing)
{
  tap.observing = observing;
}

void shadow_add (gpointer share_group, guint64 buffer)
{
  ShadowKey * key;
  g_mutex_lock (&tap.lock);
  key = shadow_slot (share_group, buffer, FIND_OR_CLAIM);
  if (key != NULL)
  {
    key->share_group = share_group;
    key->buffer = buffer;
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

static void note_draw (GumInvocationContext * ic, guint call)
{
  Draw draw;

  memset (&draw, 0, sizeof (draw));
  draw.mode = ARG (0) & 0xffffffff;
  switch (call)
  {
    case DRAW_ARRAYS:
    case DRAW_ARRAYS_INSTANCED:
      draw.first = ARG (1) & 0xffffffff;
      draw.count = ARG (2) & 0xffffffff;
      break;
    case DRAW_ELEMENTS:
    case DRAW_ELEMENTS_INSTANCED:
    case DRAW_ELEMENTS_BASE_VERTEX:
    case DRAW_ELEMENTS_INSTANCED_BASE_VERTEX:
      draw.count = ARG (1) & 0xffffffff;
      draw.type = ARG (2) & 0xffffffff;
      draw.indices = ARG (3);
      if (call == DRAW_ELEMENTS_BASE_VERTEX)
        draw.base_vertex = (gint32) ARG (4);
      else if (call == DRAW_ELEMENTS_INSTANCED_BASE_VERTEX)
        draw.base_vertex = (gint32) ARG (5);
      break;
    case DRAW_RANGE_ELEMENTS:
    case DRAW_RANGE_ELEMENTS_BASE_VERTEX:
      draw.count = ARG (3) & 0xffffffff;
      draw.type = ARG (4) & 0xffffffff;
      draw.indices = ARG (5);
      if (call == DRAW_RANGE_ELEMENTS_BASE_VERTEX)
        draw.base_vertex = (gint32) ARG (6);
      break;
  }
  record_draw (&draw);
}

static void note_attribute_pointer (GumInvocationContext * ic)
{
  guint64 index = (guint64) gum_invocation_context_get_nth_argument (ic, 0);
  gpointer share_group = current_share_group ();
  guint64 vertex_array, buffer, description;
  Layout * layout;

  if (share_group == NULL || index >= ATTRIBUTE_SLOTS)
    return;
  vertex_array = integer (GL_VERTEX_ARRAY_BINDING);
  buffer = integer (GL_ARRAY_BUFFER_BINDING);
  description = mix (mix (mix (mix (mix (buffer,
      (guint64) gum_invocation_context_get_nth_argument (ic, 1)),
      (guint64) gum_invocation_context_get_nth_argument (ic, 2)),
      (guint64) gum_invocation_context_get_nth_argument (ic, 3) & 0xff),
      (guint64) gum_invocation_context_get_nth_argument (ic, 4) & 0xffffffff),
      (guint64) gum_invocation_context_get_nth_argument (ic, 5));

  g_mutex_lock (&tap.lock);
  layout = layout_of (share_group, vertex_array, FIND_OR_CLAIM);
  if (layout != NULL)
    layout->attributes[index] = description;
  g_mutex_unlock (&tap.lock);
}

static void note_buffer_data (GumInvocationContext * ic)
{
  guint64 target = (guint64) gum_invocation_context_get_nth_argument (ic, 0);
  guint64 size = (guint64) gum_invocation_context_get_nth_argument (ic, 1);
  gconstpointer data = gum_invocation_context_get_nth_argument (ic, 2);
  guint64 usage = (guint64) gum_invocation_context_get_nth_argument (ic, 3) & 0xffffffff;
  gpointer share_group;
  guint32 buffer;

  if (usage != GL_STATIC_DRAW || (target != GL_ARRAY_BUFFER && target != GL_ELEMENT_ARRAY_BUFFER) || size < 36)
    return;
  share_group = current_share_group ();
  buffer = binding_of (target);
  if (share_group != NULL && buffer != 0)
    on_upload (UPLOAD_DATA, share_group, buffer, 0, size, data);
}

static void note_buffer_sub_data (GumInvocationContext * ic)
{
  guint64 target = (guint64) gum_invocation_context_get_nth_argument (ic, 0);
  gpointer share_group = current_share_group ();
  guint32 buffer = binding_of (target);

  if (share_group == NULL || buffer == 0 || !is_shadowed (share_group, buffer))
    return;
  on_upload (UPLOAD_SUB_DATA, share_group, buffer, (guint64) gum_invocation_context_get_nth_argument (ic, 1),
      (guint64) gum_invocation_context_get_nth_argument (ic, 2), gum_invocation_context_get_nth_argument (ic, 3));
}

static void note_mapping (GumInvocationContext * ic, guint call)
{
  guint64 target = (guint64) gum_invocation_context_get_nth_argument (ic, 0);
  gpointer share_group = current_share_group ();
  guint32 buffer = binding_of (target);
  guint64 offset = 0, length = 0, access;
  guint i;

  if (call == MAP_BUFFER_RANGE)
  {
    offset = (guint64) gum_invocation_context_get_nth_argument (ic, 1);
    length = (guint64) gum_invocation_context_get_nth_argument (ic, 2);
    access = (guint64) gum_invocation_context_get_nth_argument (ic, 3) & 0xffffffff;
    if ((access & GL_MAP_WRITE_BIT) == 0)
      return;
  }
  else
  {
    access = (guint64) gum_invocation_context_get_nth_argument (ic, 1) & 0xffffffff;
    if (access != GL_WRITE_ONLY && access != GL_READ_WRITE)
      return;
  }
  if (share_group == NULL || buffer == 0 || !is_shadowed (share_group, buffer))
    return;

  g_mutex_lock (&tap.lock);
  for (i = 0; i != MAP_CAPACITY; i++)
  {
    PendingMap * map = &tap.maps[i];
    if (map->share_group == NULL)
    {
      map->share_group = share_group;
      map->target = target;
      map->buffer = buffer;
      map->offset = offset;
      map->length = length;
      map->data = NULL;
      break;
    }
  }
  g_mutex_unlock (&tap.lock);
}

static void note_unmap (GumInvocationContext * ic)
{
  guint64 target = (guint64) gum_invocation_context_get_nth_argument (ic, 0);
  gpointer share_group = current_share_group ();
  PendingMap found;
  gboolean pending = FALSE;
  guint i;

  g_mutex_lock (&tap.lock);
  for (i = 0; i != MAP_CAPACITY; i++)
  {
    PendingMap * map = &tap.maps[i];
    if (map->share_group == share_group && map->target == target && map->data != NULL)
    {
      found = *map;
      map->share_group = NULL;
      pending = TRUE;
      break;
    }
  }
  g_mutex_unlock (&tap.lock);

  if (pending)
    on_upload (UPLOAD_MAPPED, found.share_group, found.buffer, found.offset, found.length, found.data);
}

static void note_deleted (GumInvocationContext * ic)
{
  guint64 count = (guint64) gum_invocation_context_get_nth_argument (ic, 0) & 0xffffffff;
  const guint32 * buffers = gum_invocation_context_get_nth_argument (ic, 1);
  gpointer share_group = current_share_group ();
  guint64 i;

  if (share_group == NULL)
    return;
  for (i = 0; i != count; i++)
  {
    ShadowKey * key;
    gboolean shadowed;
    g_mutex_lock (&tap.lock);
    key = shadow_slot (share_group, buffers[i], FIND_EXISTING);
    shadowed = key != NULL;
    if (shadowed)
      key->share_group = NULL;
    g_mutex_unlock (&tap.lock);
    if (shadowed)
      on_deleted (share_group, buffers[i]);
  }
}

static void note_mapped (GumInvocationContext * ic)
{
  gpointer share_group = current_share_group ();
  gpointer data = gum_invocation_context_get_return_value (ic);
  guint i;

  g_mutex_lock (&tap.lock);
  for (i = 0; i != MAP_CAPACITY; i++)
  {
    PendingMap * map = &tap.maps[i];
    if (map->share_group == share_group && map->data == NULL)
    {
      if (data == NULL)
        map->share_group = NULL;
      else
        map->data = data;
    }
  }
  g_mutex_unlock (&tap.lock);
}

static void record_draw (Draw * draw)
{
  Layout * layout;
  guint64 key;
  guint i;
  gboolean fresh, frame_requested;

  draw->share_group = current_share_group ();
  if (draw->share_group == NULL)
    return;
  g_mutex_lock (&tap.lock);
  frame_requested = tap.frame_requested;
  tap.frame_requested = FALSE;
  g_mutex_unlock (&tap.lock);
  if (frame_requested)
    on_frame (draw->share_group);
  if (!tap.observing)
    return;
  draw->program = integer (GL_CURRENT_PROGRAM);
  draw->vertex_array = integer (GL_VERTEX_ARRAY_BINDING);
  if (draw->type != 0)
    draw->element_buffer = integer (GL_ELEMENT_ARRAY_BUFFER_BINDING);

  key = mix (mix (mix (mix ((guint64) draw->share_group, draw->program), draw->vertex_array), draw->element_buffer), draw->mode);
  key = mix (mix (mix (mix (mix (key, draw->count), draw->type), draw->indices), draw->first), (guint64) draw->base_vertex);

  g_mutex_lock (&tap.lock);
  layout = layout_of (draw->share_group, draw->vertex_array, FIND_EXISTING);
  if (layout != NULL)
    for (i = 0; i != ATTRIBUTE_SLOTS; i++)
      key = mix (key, layout->attributes[i]);
  fresh = remember (key);
  g_mutex_unlock (&tap.lock);

  if (fresh)
    on_new_draw (draw);
}

static guint32 binding_of (guint64 target)
{
  if (target == GL_ELEMENT_ARRAY_BUFFER)
    return integer (GL_ELEMENT_ARRAY_BUFFER_BINDING);
  if (target == GL_ARRAY_BUFFER)
    return integer (GL_ARRAY_BUFFER_BINDING);
  return 0;
}

static void on_upload (guint32 kind, gpointer share_group, guint64 buffer, guint64 offset, guint64 length, gconstpointer data)
{
  enter_js ();
  deliver_upload (kind, share_group, buffer, offset, length, data);
  leave_js ();
}

static gboolean is_shadowed (gpointer share_group, guint64 buffer)
{
  gboolean shadowed;
  g_mutex_lock (&tap.lock);
  shadowed = shadow_slot (share_group, buffer, FIND_EXISTING) != NULL;
  g_mutex_unlock (&tap.lock);
  return shadowed;
}

static void on_deleted (gpointer share_group, guint64 buffer)
{
  enter_js ();
  deliver_deleted (share_group, buffer);
  leave_js ();
}

static ShadowKey * shadow_slot (gpointer share_group, guint64 buffer, Lookup lookup)
{
  guint index = mix ((guint64) share_group, buffer) % SHADOW_CAPACITY;
  guint probes;
  for (probes = 0; probes != SHADOW_CAPACITY; probes++)
  {
    ShadowKey * key = &tap.shadows[index];
    if (key->share_group == share_group && key->buffer == buffer)
      return key;
    if (key->share_group == NULL && key->buffer == 0)
      return (lookup == FIND_OR_CLAIM) ? key : NULL;
    index = (index + 1) % SHADOW_CAPACITY;
  }
  return NULL;
}

static guint32 integer (guint32 name)
{
  gint32 value = 0;
  glGetIntegerv (name, &value);
  return value;
}

static Layout * layout_of (gpointer share_group, guint64 vertex_array, Lookup lookup)
{
  guint index = mix ((guint64) share_group, vertex_array) % LAYOUT_CAPACITY;
  guint probes;
  for (probes = 0; probes != LAYOUT_CAPACITY; probes++)
  {
    Layout * layout = &tap.layouts[index];
    if (layout->share_group == share_group && layout->vertex_array == vertex_array)
      return layout;
    if (layout->share_group == NULL)
    {
      if (lookup == FIND_EXISTING)
        return NULL;
      layout->share_group = share_group;
      layout->vertex_array = vertex_array;
      return layout;
    }
    index = (index + 1) % LAYOUT_CAPACITY;
  }
  return NULL;
}

static void on_frame (gpointer share_group)
{
  enter_js ();
  deliver_frame (share_group);
  leave_js ();
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

static void on_new_draw (Draw * draw)
{
  enter_js ();
  deliver_new_draw (draw);
  leave_js ();
}

static guint64 mix (guint64 hash, guint64 value)
{
  hash ^= value + 0x9e3779b97f4a7c15ull + (hash << 6) + (hash >> 2);
  return hash * 0x100000001b3ull;
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

export class GLTap {
    private readonly state = Memory.alloc(TAP_STATE_SIZE);
    private readonly callbacks: NativeCallback<any, any>[];
    private readonly tap: CModule;
    private readonly listeners: InvocationListener[] = [];
    private readonly hooked = new Set<string>();
    private readonly requestFrameNow: NativeFunction<void, []>;
    private readonly setObserving: NativeFunction<void, [number]>;
    private readonly addShadow: NativeFunction<void, [NativePointerValue, number | UInt64]>;
    private readonly waitUntilIdle: NativeFunction<void, []>;

    constructor(private readonly platform: GLTapPlatform, events: GLTapEvents) {
        const onNewDraw = new NativeCallback(draw => events.newDraw(glDrawOf(Draw.at(draw))), "void", ["pointer"]);
        const onFrame = new NativeCallback(shareGroup => events.frame(shareGroup), "void", ["pointer"]);
        const onUpload = new NativeCallback((kind, shareGroup, buffer, offset, length, data) => events.upload({
            kind: uploadKinds[kind],
            shareGroup,
            buffer: buffer.toNumber(),
            offset: offset.toNumber(),
            length: length.toNumber(),
            data,
        }), "void", ["uint32", "pointer", "uint64", "uint64", "uint64", "pointer"]);
        const onDeleted = new NativeCallback((shareGroup, buffer) => events.deleted(shareGroup, buffer.toNumber()), "void",
            ["pointer", "uint64"]);
        this.callbacks = [onNewDraw, onFrame, onUpload, onDeleted];
        this.tap = new CModule(source.replace("SHARE_GROUP_SOURCE", platform.shareGroupSource), {
            ...platform.shareGroupSymbols,
            tap: this.state,
            glGetIntegerv: platform.entryPoint("glGetIntegerv")!,
            deliver_new_draw: onNewDraw,
            deliver_frame: onFrame,
            deliver_upload: onUpload,
            deliver_deleted: onDeleted,
        });
        this.requestFrameNow = new NativeFunction(this.tap.request_frame, "void", []);
        this.setObserving = new NativeFunction(this.tap.set_observing, "void", ["int"]);
        this.addShadow = new NativeFunction(this.tap.shadow_add, "void", ["pointer", "uint64"]);
        this.waitUntilIdle = new NativeFunction(this.tap.wait_until_idle, "void", []);
        this.hookEntryPoints();
    }

    hookEntryPoints(): void {
        for (const [call, names] of Object.entries(entryPointNames) as [GLCall, string[]][]) {
            for (const target of names.flatMap(name => this.platform.hookTargets(name))) {
                if (this.hooked.has(target.toString())) {
                    continue;
                }
                this.hooked.add(target.toString());
                const leave = (call === "mapBufferRange" || call === "mapBuffer") ? { onLeave: this.tap.on_leave } : {};
                this.listeners.push(Interceptor.attach(target, { onEnter: this.tap.on_enter, ...leave }, ptr(callIds[call])));
            }
        }
    }

    observeDraws(watch: DrawWatch): void {
        this.setObserving((watch === "observed") ? 1 : 0);
    }

    requestFrame(): void {
        this.requestFrameNow();
    }

    shadow(shareGroup: NativePointer, buffer: number): void {
        this.addShadow(shareGroup, buffer);
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

function glDrawOf(draw: Draw): GLDraw {
    return {
        shareGroup: draw.shareGroup,
        program: draw.program.toNumber(),
        vertexArray: draw.vertexArray.toNumber(),
        elementBuffer: draw.elementBuffer.toNumber(),
        mode: draw.mode.toNumber(),
        count: draw.count.toNumber(),
        type: draw.type.toNumber(),
        indices: draw.indices.toNumber(),
        first: draw.first.toNumber(),
        baseVertex: draw.baseVertex.toNumber(),
    };
}
