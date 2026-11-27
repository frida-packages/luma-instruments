import { Draw } from "./gl-draw.pat";
import { TextureFacts, TextureUpload } from "./gl-textures.pat";

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
    | "deleteBuffers"
    | "texImage2D"
    | "texStorage2D"
    | "compressedTexImage2D"
    | "compressedTexSubImage2D"
    | "deleteTextures";

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

export type TextureUploadKind = "storage" | "compressed-image" | "compressed-sub-image";

export interface GLTextureUpload {
    kind: TextureUploadKind;
    shareGroup: NativePointer;
    texture: number;
    generation: number;
    internalFormat: number;
    x: number;
    y: number;
    width: number;
    height: number;
    size: number;
    data: NativePointer;
}

export interface GLTextureFacts {
    generation: number;
    internalFormat: number;
    format: number;
    type: number;
    width: number;
    height: number;
}

export interface GLTapEvents {
    newDraw(draw: GLDraw): void;
    frame(shareGroup: NativePointer): void;
    upload(upload: GLUpload): void;
    deleted(shareGroup: NativePointer, buffer: number): void;
    textureUpload(upload: GLTextureUpload): void;
    textureDeleted(shareGroup: NativePointer, texture: number): void;
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
    texImage2D: 16,
    texStorage2D: 17,
    compressedTexImage2D: 18,
    compressedTexSubImage2D: 19,
    deleteTextures: 20,
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
    texImage2D: ["glTexImage2D"],
    texStorage2D: ["glTexStorage2D", "glTexStorage2DEXT"],
    compressedTexImage2D: ["glCompressedTexImage2D", "glCompressedTexImage2DARB"],
    compressedTexSubImage2D: ["glCompressedTexSubImage2D", "glCompressedTexSubImage2DARB"],
    deleteTextures: ["glDeleteTextures"],
};

export const glTapEntryPointNames = Object.values(entryPointNames).flat();

const uploadKinds: UploadKind[] = ["data", "sub-data", "mapped"];
const textureUploadKinds: TextureUploadKind[] = ["storage", "compressed-image", "compressed-sub-image"];

const TAP_STATE_SIZE = 4 * 1048576;
const SAMPLER_SLOTS = 16;

const source = `
#include <gum/guminterceptor.h>
#include <string.h>

#define SEEN_CAPACITY 65536
#define LAYOUT_CAPACITY 4096
#define SHADOW_CAPACITY 16384
#define MAP_CAPACITY 64
#define TEXTURE_CAPACITY 16384
#define PROGRAM_CAPACITY 4096
#define ATTRIBUTE_SLOTS 16
#define SAMPLER_SLOTS ${SAMPLER_SLOTS}

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
#define GL_TEXTURE_2D 0x0DE1
#define GL_TEXTURE_BINDING_2D 0x8069
#define GL_TEXTURE0 0x84C0
#define GL_ACTIVE_TEXTURE 0x84E0

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
  DELETE_BUFFERS,
  TEX_IMAGE_2D,
  TEX_STORAGE_2D,
  COMPRESSED_TEX_IMAGE_2D,
  COMPRESSED_TEX_SUB_IMAGE_2D,
  DELETE_TEXTURES
};

enum { UPLOAD_DATA, UPLOAD_SUB_DATA, UPLOAD_MAPPED };

enum { TEXTURE_STORAGE, TEXTURE_COMPRESSED_IMAGE, TEXTURE_COMPRESSED_SUB_IMAGE };

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

typedef struct
{
  gpointer share_group;
  guint64 kind;
  guint64 name;
  guint64 generation;
  guint64 internal_format;
  guint64 x;
  guint64 y;
  guint64 width;
  guint64 height;
  guint64 size;
  gconstpointer data;
} TextureUpload;

typedef struct
{
  guint64 generation;
  guint64 internal_format;
  guint64 format;
  guint64 type;
  guint64 width;
  guint64 height;
  guint64 shadowed;
} TextureFacts;

typedef struct
{
  gpointer share_group;
  guint64 name;
  TextureFacts facts;
} Texture;

typedef struct
{
  gpointer share_group;
  guint64 program;
  guint32 count;
  guint32 units[SAMPLER_SLOTS];
} Samplers;

typedef enum { FIND_EXISTING, FIND_OR_CLAIM } Lookup;

typedef struct
{
  GMutex lock;
  GCond idle;
  guint callbacks_running;
  guint seen_count;
  gboolean frame_requested;
  gboolean observing;
  guint64 texture_generations;
  guint64 seen[SEEN_CAPACITY];
  Layout layouts[LAYOUT_CAPACITY];
  ShadowKey shadows[SHADOW_CAPACITY];
  PendingMap maps[MAP_CAPACITY];
  Texture textures[TEXTURE_CAPACITY];
  Samplers samplers[PROGRAM_CAPACITY];
} Tap;

extern Tap tap;
extern void glGetIntegerv (guint32 name, gint32 * value);
extern void glActiveTexture (guint32 unit);
extern void deliver_new_draw (Draw * draw);
extern void deliver_frame (gpointer share_group);
extern void deliver_upload (guint32 kind, gpointer share_group, guint64 buffer, guint64 offset, guint64 length, gconstpointer data);
extern void deliver_deleted (gpointer share_group, guint64 buffer);
extern void deliver_texture_upload (const TextureUpload * upload);
extern void deliver_texture_deleted (gpointer share_group, guint64 texture);

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
static void note_texture_image (GumInvocationContext * ic);
static void note_texture_storage (GumInvocationContext * ic);
static void note_compressed_texture_image (GumInvocationContext * ic);
static void note_compressed_texture_sub_image (GumInvocationContext * ic);
static void note_textures_deleted (GumInvocationContext * ic);
static void record_draw (Draw * draw);
static guint32 binding_of (guint64 target);
static void on_upload (guint32 kind, gpointer share_group, guint64 buffer, guint64 offset, guint64 length, gconstpointer data);
static gboolean is_shadowed (gpointer share_group, guint64 buffer);
static void on_deleted (gpointer share_group, guint64 buffer);
static ShadowKey * shadow_slot (gpointer share_group, guint64 buffer, Lookup lookup);
static guint32 integer (guint32 name);
static guint32 bound_texture (guint64 target, gpointer * share_group);
static guint64 respecify (gpointer share_group, guint32 name, guint64 internal_format, guint64 format, guint64 type, guint64 width,
    guint64 height);
static void on_texture_upload (const TextureUpload * upload);
static void on_texture_deleted (gpointer share_group, guint64 texture);
static Texture * texture_slot (gpointer share_group, guint64 name, Lookup lookup);
static Layout * layout_of (gpointer share_group, guint64 vertex_array, Lookup lookup);
static Samplers * samplers_of (gpointer share_group, guint64 program, Lookup lookup);
static void on_frame (gpointer share_group);
static void bound_textures (const guint32 * units, guint count, guint32 * textures);
static guint64 generation_of (gpointer share_group, guint64 name);
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
    case TEX_IMAGE_2D:
      note_texture_image (ic);
      return;
    case TEX_STORAGE_2D:
      note_texture_storage (ic);
      return;
    case COMPRESSED_TEX_IMAGE_2D:
      note_compressed_texture_image (ic);
      return;
    case COMPRESSED_TEX_SUB_IMAGE_2D:
      note_compressed_texture_sub_image (ic);
      return;
    case DELETE_TEXTURES:
      note_textures_deleted (ic);
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

void samplers_set (gpointer share_group, guint64 program, const guint32 * units, guint count)
{
  Samplers * samplers;
  g_mutex_lock (&tap.lock);
  samplers = samplers_of (share_group, program, FIND_OR_CLAIM);
  if (samplers != NULL)
  {
    samplers->count = MIN (count, SAMPLER_SLOTS);
    memcpy (samplers->units, units, samplers->count * sizeof (guint32));
  }
  g_mutex_unlock (&tap.lock);
}

gboolean texture_facts (gpointer share_group, guint64 name, TextureFacts * facts)
{
  Texture * texture;
  g_mutex_lock (&tap.lock);
  texture = texture_slot (share_group, name, FIND_EXISTING);
  if (texture != NULL)
    *facts = texture->facts;
  g_mutex_unlock (&tap.lock);
  return texture != NULL;
}

void texture_shadow (gpointer share_group, guint64 name)
{
  Texture * texture;
  g_mutex_lock (&tap.lock);
  texture = texture_slot (share_group, name, FIND_EXISTING);
  if (texture != NULL)
    texture->facts.shadowed = TRUE;
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

static void note_texture_image (GumInvocationContext * ic)
{
  gpointer share_group;
  guint32 name;

  if ((ARG (1) & 0xffffffff) != 0)
    return;
  name = bound_texture (ARG (0) & 0xffffffff, &share_group);
  if (name != 0)
    respecify (share_group, name, ARG (2) & 0xffffffff, ARG (6) & 0xffffffff, ARG (7) & 0xffffffff, ARG (3) & 0xffffffff,
        ARG (4) & 0xffffffff);
}

static void note_texture_storage (GumInvocationContext * ic)
{
  TextureUpload upload;
  guint32 name;

  memset (&upload, 0, sizeof (upload));
  name = bound_texture (ARG (0) & 0xffffffff, &upload.share_group);
  if (name == 0)
    return;
  upload.kind = TEXTURE_STORAGE;
  upload.name = name;
  upload.internal_format = ARG (2) & 0xffffffff;
  upload.width = ARG (3) & 0xffffffff;
  upload.height = ARG (4) & 0xffffffff;
  upload.generation = respecify (upload.share_group, name, upload.internal_format, 0, 0, upload.width, upload.height);
  on_texture_upload (&upload);
}

static void note_compressed_texture_image (GumInvocationContext * ic)
{
  TextureUpload upload;
  guint32 name;

  if ((ARG (1) & 0xffffffff) != 0)
    return;
  memset (&upload, 0, sizeof (upload));
  name = bound_texture (ARG (0) & 0xffffffff, &upload.share_group);
  if (name == 0)
    return;
  upload.kind = TEXTURE_COMPRESSED_IMAGE;
  upload.name = name;
  upload.internal_format = ARG (2) & 0xffffffff;
  upload.width = ARG (3) & 0xffffffff;
  upload.height = ARG (4) & 0xffffffff;
  upload.size = ARG (6) & 0xffffffff;
  upload.data = gum_invocation_context_get_nth_argument (ic, 7);
  upload.generation = respecify (upload.share_group, name, upload.internal_format, 0, 0, upload.width, upload.height);
  on_texture_upload (&upload);
}

static void note_compressed_texture_sub_image (GumInvocationContext * ic)
{
  TextureUpload upload;
  Texture * texture;
  guint32 name;

  if ((ARG (1) & 0xffffffff) != 0)
    return;
  memset (&upload, 0, sizeof (upload));
  name = bound_texture (ARG (0) & 0xffffffff, &upload.share_group);
  if (name == 0)
    return;
  g_mutex_lock (&tap.lock);
  texture = texture_slot (upload.share_group, name, FIND_EXISTING);
  if (texture != NULL && texture->facts.shadowed)
    upload.generation = texture->facts.generation;
  g_mutex_unlock (&tap.lock);
  if (upload.generation == 0)
    return;
  upload.kind = TEXTURE_COMPRESSED_SUB_IMAGE;
  upload.name = name;
  upload.x = ARG (2) & 0xffffffff;
  upload.y = ARG (3) & 0xffffffff;
  upload.width = ARG (4) & 0xffffffff;
  upload.height = ARG (5) & 0xffffffff;
  upload.internal_format = ARG (6) & 0xffffffff;
  upload.size = ARG (7) & 0xffffffff;
  upload.data = gum_invocation_context_get_nth_argument (ic, 8);
  on_texture_upload (&upload);
}

static void note_textures_deleted (GumInvocationContext * ic)
{
  guint64 count = ARG (0) & 0xffffffff;
  const guint32 * names = gum_invocation_context_get_nth_argument (ic, 1);
  gpointer share_group = current_share_group ();
  guint64 i;

  if (share_group == NULL)
    return;
  for (i = 0; i != count; i++)
  {
    Texture * texture;
    gboolean shadowed = FALSE;
    g_mutex_lock (&tap.lock);
    texture = texture_slot (share_group, names[i], FIND_EXISTING);
    if (texture != NULL)
    {
      shadowed = texture->facts.shadowed;
      texture->share_group = NULL;
    }
    g_mutex_unlock (&tap.lock);
    if (shadowed)
      on_texture_deleted (share_group, names[i]);
  }
}

static void record_draw (Draw * draw)
{
  Layout * layout;
  Samplers * samplers;
  guint32 units[SAMPLER_SLOTS];
  guint32 textures[SAMPLER_SLOTS];
  guint64 key = 0;
  guint i, unit_count = 0;
  gboolean observing, fresh, frame_requested;

  draw->share_group = current_share_group ();
  if (draw->share_group == NULL)
    return;
  observing = tap.observing;
  if (observing)
  {
    draw->program = integer (GL_CURRENT_PROGRAM);
    draw->vertex_array = integer (GL_VERTEX_ARRAY_BINDING);
    if (draw->type != 0)
      draw->element_buffer = integer (GL_ELEMENT_ARRAY_BUFFER_BINDING);
    key = mix (mix (mix (mix ((guint64) draw->share_group, draw->program), draw->vertex_array), draw->element_buffer), draw->mode);
    key = mix (mix (mix (mix (mix (key, draw->count), draw->type), draw->indices), draw->first), (guint64) draw->base_vertex);
  }

  g_mutex_lock (&tap.lock);
  frame_requested = tap.frame_requested;
  tap.frame_requested = FALSE;
  if (observing)
  {
    layout = layout_of (draw->share_group, draw->vertex_array, FIND_EXISTING);
    if (layout != NULL)
      for (i = 0; i != ATTRIBUTE_SLOTS; i++)
        key = mix (key, layout->attributes[i]);
    samplers = samplers_of (draw->share_group, draw->program, FIND_EXISTING);
    if (samplers != NULL)
    {
      unit_count = samplers->count;
      memcpy (units, samplers->units, unit_count * sizeof (guint32));
    }
  }
  g_mutex_unlock (&tap.lock);

  if (frame_requested)
    on_frame (draw->share_group);
  if (!observing)
    return;
  bound_textures (units, unit_count, textures);

  g_mutex_lock (&tap.lock);
  for (i = 0; i != unit_count; i++)
    key = mix (mix (key, textures[i]), generation_of (draw->share_group, textures[i]));
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

static guint32 bound_texture (guint64 target, gpointer * share_group)
{
  if (target != GL_TEXTURE_2D)
    return 0;
  *share_group = current_share_group ();
  return (*share_group != NULL) ? integer (GL_TEXTURE_BINDING_2D) : 0;
}

static guint64 respecify (gpointer share_group, guint32 name, guint64 internal_format, guint64 format, guint64 type, guint64 width,
    guint64 height)
{
  Texture * texture;
  guint64 generation = 0;

  g_mutex_lock (&tap.lock);
  texture = texture_slot (share_group, name, FIND_OR_CLAIM);
  if (texture != NULL)
  {
    generation = ++tap.texture_generations;
    texture->share_group = share_group;
    texture->name = name;
    texture->facts.generation = generation;
    texture->facts.internal_format = internal_format;
    texture->facts.format = format;
    texture->facts.type = type;
    texture->facts.width = width;
    texture->facts.height = height;
    texture->facts.shadowed = FALSE;
  }
  g_mutex_unlock (&tap.lock);
  return generation;
}

static void on_texture_upload (const TextureUpload * upload)
{
  enter_js ();
  deliver_texture_upload (upload);
  leave_js ();
}

static void on_texture_deleted (gpointer share_group, guint64 texture)
{
  enter_js ();
  deliver_texture_deleted (share_group, texture);
  leave_js ();
}

static Texture * texture_slot (gpointer share_group, guint64 name, Lookup lookup)
{
  guint index = mix ((guint64) share_group, name) % TEXTURE_CAPACITY;
  Texture * vacated = NULL;
  guint probes;
  for (probes = 0; probes != TEXTURE_CAPACITY; probes++)
  {
    Texture * texture = &tap.textures[index];
    if (texture->share_group == share_group && texture->name == name)
      return texture;
    if (texture->share_group == NULL && texture->name == 0)
      return (lookup == FIND_OR_CLAIM) ? ((vacated != NULL) ? vacated : texture) : NULL;
    if (texture->share_group == NULL && vacated == NULL)
      vacated = texture;
    index = (index + 1) % TEXTURE_CAPACITY;
  }
  return (lookup == FIND_OR_CLAIM) ? vacated : NULL;
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

static Samplers * samplers_of (gpointer share_group, guint64 program, Lookup lookup)
{
  guint index = mix ((guint64) share_group, program) % PROGRAM_CAPACITY;
  guint probes;
  for (probes = 0; probes != PROGRAM_CAPACITY; probes++)
  {
    Samplers * samplers = &tap.samplers[index];
    if (samplers->share_group == share_group && samplers->program == program)
      return samplers;
    if (samplers->share_group == NULL)
    {
      if (lookup == FIND_EXISTING)
        return NULL;
      samplers->share_group = share_group;
      samplers->program = program;
      return samplers;
    }
    index = (index + 1) % PROGRAM_CAPACITY;
  }
  return NULL;
}

static void on_frame (gpointer share_group)
{
  enter_js ();
  deliver_frame (share_group);
  leave_js ();
}

static void bound_textures (const guint32 * units, guint count, guint32 * textures)
{
  guint32 active;
  guint i;

  if (count == 0)
    return;
  active = integer (GL_ACTIVE_TEXTURE);
  for (i = 0; i != count; i++)
  {
    glActiveTexture (GL_TEXTURE0 + units[i]);
    textures[i] = integer (GL_TEXTURE_BINDING_2D);
  }
  glActiveTexture (active);
}

static guint64 generation_of (gpointer share_group, guint64 name)
{
  Texture * texture = texture_slot (share_group, name, FIND_EXISTING);
  return (texture != NULL) ? texture->facts.generation : 0;
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
    readonly #platform: GLTapPlatform;
    readonly #state = Memory.alloc(TAP_STATE_SIZE);
    readonly #callbacks: NativeCallback<any, any>[];
    readonly #tap: CModule;
    readonly #listeners: InvocationListener[] = [];
    readonly #hooked = new Set<string>();
    readonly #requestFrameNow: NativeFunction<void, []>;
    readonly #setObserving: NativeFunction<void, [number]>;
    readonly #addShadow: NativeFunction<void, [NativePointerValue, number | UInt64]>;
    readonly #setSamplers: NativeFunction<void, [NativePointerValue, number | UInt64, NativePointerValue, number]>;
    readonly #readTextureFacts: NativeFunction<number, [NativePointerValue, number | UInt64, NativePointerValue]>;
    readonly #shadowTexture: NativeFunction<void, [NativePointerValue, number | UInt64]>;
    readonly #waitUntilIdle: NativeFunction<void, []>;
    readonly #units = Memory.alloc(SAMPLER_SLOTS * 4);
    readonly #facts = TextureFacts.at(Memory.alloc(TextureFacts.size));

    constructor(platform: GLTapPlatform, events: GLTapEvents) {
        this.#platform = platform;
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
        const onTextureUpload = new NativeCallback(upload => events.textureUpload(glTextureUploadOf(TextureUpload.at(upload))), "void",
            ["pointer"]);
        const onTextureDeleted = new NativeCallback((shareGroup, texture) => events.textureDeleted(shareGroup, texture.toNumber()),
            "void", ["pointer", "uint64"]);
        this.#callbacks = [onNewDraw, onFrame, onUpload, onDeleted, onTextureUpload, onTextureDeleted];
        this.#tap = new CModule(source.replace("SHARE_GROUP_SOURCE", platform.shareGroupSource), {
            ...platform.shareGroupSymbols,
            tap: this.#state,
            glGetIntegerv: platform.entryPoint("glGetIntegerv")!,
            glActiveTexture: platform.entryPoint("glActiveTexture")!,
            deliver_new_draw: onNewDraw,
            deliver_frame: onFrame,
            deliver_upload: onUpload,
            deliver_deleted: onDeleted,
            deliver_texture_upload: onTextureUpload,
            deliver_texture_deleted: onTextureDeleted,
        });
        this.#requestFrameNow = new NativeFunction(this.#tap.request_frame, "void", []);
        this.#setObserving = new NativeFunction(this.#tap.set_observing, "void", ["int"]);
        this.#addShadow = new NativeFunction(this.#tap.shadow_add, "void", ["pointer", "uint64"]);
        this.#setSamplers = new NativeFunction(this.#tap.samplers_set, "void", ["pointer", "uint64", "pointer", "uint"]);
        this.#readTextureFacts = new NativeFunction(this.#tap.texture_facts, "int", ["pointer", "uint64", "pointer"]);
        this.#shadowTexture = new NativeFunction(this.#tap.texture_shadow, "void", ["pointer", "uint64"]);
        this.#waitUntilIdle = new NativeFunction(this.#tap.wait_until_idle, "void", []);
        this.hookEntryPoints();
    }

    hookEntryPoints(): void {
        for (const [call, names] of Object.entries(entryPointNames) as [GLCall, string[]][]) {
            for (const target of names.flatMap(name => this.#platform.hookTargets(name))) {
                if (this.#hooked.has(target.toString())) {
                    continue;
                }
                this.#hooked.add(target.toString());
                const leave = (call === "mapBufferRange" || call === "mapBuffer") ? { onLeave: this.#tap.on_leave } : {};
                this.#listeners.push(Interceptor.attach(target, { onEnter: this.#tap.on_enter, ...leave }, ptr(callIds[call])));
            }
        }
    }

    observeDraws(watch: DrawWatch): void {
        this.#setObserving((watch === "observed") ? 1 : 0);
    }

    requestFrame(): void {
        this.#requestFrameNow();
    }

    shadow(shareGroup: NativePointer, buffer: number): void {
        this.#addShadow(shareGroup, buffer);
    }

    noteSamplers(shareGroup: NativePointer, program: number, units: number[]): void {
        const tracked = units.slice(0, SAMPLER_SLOTS);
        tracked.forEach((unit, i) => this.#units.add(i * 4).writeU32(unit));
        this.#setSamplers(shareGroup, program, this.#units, tracked.length);
    }

    textureFacts(shareGroup: NativePointer, texture: number): GLTextureFacts | null {
        const facts = this.#facts;
        if (this.#readTextureFacts(shareGroup, texture, facts.$address) === 0) {
            return null;
        }
        return {
            generation: facts.generation.toNumber(),
            internalFormat: facts.internalFormat.toNumber(),
            format: facts.format.toNumber(),
            type: facts.type.toNumber(),
            width: facts.width.toNumber(),
            height: facts.height.toNumber(),
        };
    }

    shadowTexture(shareGroup: NativePointer, texture: number): void {
        this.#shadowTexture(shareGroup, texture);
    }

    dispose(): void {
        for (const listener of this.#listeners) {
            listener.detach();
        }
        Interceptor.flush();
        this.#waitUntilIdle();
        this.#tap.dispose();
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

function glTextureUploadOf(upload: TextureUpload): GLTextureUpload {
    return {
        kind: textureUploadKinds[upload.kind.toNumber()],
        shareGroup: upload.shareGroup,
        texture: upload.name.toNumber(),
        generation: upload.generation.toNumber(),
        internalFormat: upload.internalFormat.toNumber(),
        x: upload.x.toNumber(),
        y: upload.y.toNumber(),
        width: upload.width.toNumber(),
        height: upload.height.toNumber(),
        size: upload.size.toNumber(),
        data: upload.data,
    };
}
