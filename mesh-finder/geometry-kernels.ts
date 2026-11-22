import type { IndexFormat, Topology } from "./graphics-backend.js";
import { componentTypes, type PositionFormat } from "./vertex-format.js";

export interface IndexRange {
    min: number;
    max: number;
    used: number;
}

export interface IndexProfile {
    max: number;
    distinct: number;
    degenerateTriangles: number;
    meanStep: number;
}

export interface GatheredPositions {
    positions: Float32Array;
    min: [number, number, number];
    max: [number, number, number];
    nonFinite: number;
}

const source = `
#include <glib.h>
#include <string.h>

typedef enum { RESTARTS_COUNTED, RESTARTS_SKIPPED } Restarts;
typedef enum { STRIP_ORDER, FAN_ORDER } RunOrder;

typedef struct { guint32 min; guint32 max; guint64 used; } IndexRange;
typedef struct { guint32 max; guint32 distinct; guint64 degenerate; double mean_step; } IndexProfile;

#define LARGEST_VERTEX_COUNT (1u << 24)
#define LARGEST_NARROW_MEAN_STEP 1024.0
#define LARGEST_WIDE_MEAN_STEP 65536.0
#define PLAUSIBLE_FLOAT_SHARE 0.6
#define SMALLEST_COORDINATE 1e-30f
#define LARGEST_COORDINATE 1e6f

static const guint32 component_sizes[] = { 4, 2, 2, 2, 2, 2, 1, 1 };

static guint32 restart_value (guint32 width);
static guint32 index_at (const guint8 * data, guint64 i, guint32 width);
static gboolean steps_are_small (const guint8 * data, guint32 count, guint32 width, double largest_mean, guint32 below);
static gboolean holds_plausible_floats (const guint8 * data, guint32 count);
static float component_at (const guint8 * p, guint32 type);
static float half_to_float (guint16 h);

void index_range (const guint8 * data, guint64 count, guint32 width, Restarts restarts, IndexRange * range)
{
  guint32 restart = restart_value (width);
  guint32 lo = 0xffffffffu, hi = 0;
  guint64 used = 0, i;
  for (i = 0; i != count; i++)
  {
    guint32 v = index_at (data, i, width);
    if (restarts == RESTARTS_SKIPPED && v == restart)
      continue;
    if (v < lo)
      lo = v;
    if (v > hi)
      hi = v;
    used++;
  }
  range->min = lo;
  range->max = hi;
  range->used = used;
}

void widen_indices (const guint8 * data, guint64 count, guint32 width, guint32 rebase, guint32 * out)
{
  guint64 i;
  for (i = 0; i != count; i++)
    out[i] = index_at (data, i, width) - rebase;
}

guint64 triangulate (const guint8 * data, guint64 count, guint32 width, RunOrder order, guint32 rebase, guint32 * out)
{
  guint32 restart = restart_value (width);
  guint64 written = 0, run = 0, i;
  guint32 first = 0, previous = 0, current = 0;
  for (i = 0; i != count; i++)
  {
    guint32 v = index_at (data, i, width);
    if (v == restart)
    {
      run = 0;
      continue;
    }
    v -= rebase;
    if (run == 0)
      first = v;
    if (run >= 2)
    {
      guint32 a, b, c;
      if (order == FAN_ORDER)
      {
        a = first; b = current; c = v;
      }
      else if ((run & 1) == 0)
      {
        a = previous; b = current; c = v;
      }
      else
      {
        a = current; b = previous; c = v;
      }
      if (a != b && b != c && a != c)
      {
        out[written++] = a;
        out[written++] = b;
        out[written++] = c;
      }
    }
    previous = current;
    current = v;
    run++;
  }
  return written;
}

void profile_indices (const guint8 * data, guint64 count, guint32 width, guint32 max, IndexProfile * profile)
{
  guint8 * seen = g_malloc0 ((max >> 3) + 1);
  guint32 distinct = 0, previous = 0, corner = 0;
  guint64 degenerate = 0, i;
  double steps = 0;
  for (i = 0; i != count; i++)
  {
    guint32 v = index_at (data, i, width);
    if ((seen[v >> 3] & (1 << (v & 7))) == 0)
    {
      seen[v >> 3] |= 1 << (v & 7);
      distinct++;
    }
    steps += (v > previous) ? v - previous : previous - v;
    previous = v;
    if (++corner == 3)
    {
      corner = 0;
      guint32 a = index_at (data, i - 2, width), b = index_at (data, i - 1, width);
      if (a == b || b == v || a == v)
        degenerate++;
    }
  }
  g_free (seen);
  profile->max = max;
  profile->distinct = distinct;
  profile->degenerate = degenerate;
  profile->mean_step = (count > 1) ? steps / (gint64) (count - 1) : 0;
}

guint32 looks_like_mesh_data (const guint8 * data, guint32 length)
{
  return steps_are_small (data, length / 2, 2, LARGEST_NARROW_MEAN_STEP, 0xffffffffu) ||
      steps_are_small (data, length / 4, 4, LARGEST_WIDE_MEAN_STEP, LARGEST_VERTEX_COUNT) ||
      holds_plausible_floats (data, length / 4);
}

guint64 gather_positions (const guint8 * data, guint64 count, guint64 stride, guint32 type, guint32 components, float * out, float * bounds)
{
  guint32 size = component_sizes[type];
  guint64 non_finite = 0, i;
  guint32 k;
  for (k = 0; k != 3; k++)
  {
    bounds[k] = 3.4e38f;
    bounds[3 + k] = -3.4e38f;
  }
  for (i = 0; i != count; i++)
  {
    const guint8 * vertex = data + i * stride;
    gboolean finite = TRUE;
    for (k = 0; k != 3; k++)
    {
      float value = (k < components) ? component_at (vertex + k * size, type) : 0.0f;
      if (value != value || value - value != 0.0f)
        finite = FALSE;
      out[i * 3 + k] = value;
    }
    if (!finite)
    {
      non_finite++;
      continue;
    }
    for (k = 0; k != 3; k++)
    {
      float value = out[i * 3 + k];
      if (value < bounds[k])
        bounds[k] = value;
      if (value > bounds[3 + k])
        bounds[3 + k] = value;
    }
  }
  return non_finite;
}

static guint32 restart_value (guint32 width)
{
  return (width == 4) ? 0xffffffffu : ((1u << (width * 8)) - 1);
}

static guint32 index_at (const guint8 * data, guint64 i, guint32 width)
{
  if (width == 1)
    return data[i];
  if (width == 2)
    return ((const guint16 *) data)[i];
  return ((const guint32 *) data)[i];
}

static gboolean steps_are_small (const guint8 * data, guint32 count, guint32 width, double largest_mean, guint32 below)
{
  double steps = 0;
  guint32 i, previous = 0;
  if (count < 2)
    return FALSE;
  for (i = 0; i != count; i++)
  {
    guint32 v = index_at (data, i, width);
    if (v >= below)
      return FALSE;
    if (i != 0)
      steps += (v > previous) ? v - previous : previous - v;
    previous = v;
  }
  return steps / (count - 1) < largest_mean;
}

static gboolean holds_plausible_floats (const guint8 * data, guint32 count)
{
  guint32 i, plausible = 0;
  for (i = 0; i != count; i++)
  {
    float value;
    memcpy (&value, data + i * 4, 4);
    float magnitude = (value < 0) ? -value : value;
    if (value == 0 || (magnitude >= SMALLEST_COORDINATE && magnitude <= LARGEST_COORDINATE))
      plausible++;
  }
  return plausible >= count * PLAUSIBLE_FLOAT_SHARE;
}

static float component_at (const guint8 * p, guint32 type)
{
  switch (type)
  {
    case 0: { float f; memcpy (&f, p, 4); return f; }
    case 1: { guint16 h; memcpy (&h, p, 2); return half_to_float (h); }
    case 2: { gint16 s; memcpy (&s, p, 2); float f = s / 32767.0f; return (f < -1) ? -1 : f; }
    case 3: { guint16 u; memcpy (&u, p, 2); return u / 65535.0f; }
    case 4: { gint16 s; memcpy (&s, p, 2); return s; }
    case 5: { guint16 u; memcpy (&u, p, 2); return u; }
    case 6: { gint8 s = *(const gint8 *) p; float f = s / 127.0f; return (f < -1) ? -1 : f; }
    default: return *p / 255.0f;
  }
}

static float half_to_float (guint16 h)
{
  guint32 sign = (h >> 15) & 1, exponent = (h >> 10) & 0x1f, mantissa = h & 0x3ff;
  union { guint32 u; float f; } bits;
  if (exponent == 0)
  {
    float value = mantissa / 16777216.0f;
    return sign ? -value : value;
  }
  if (exponent == 31)
    bits.u = (sign << 31) | 0x7f800000u | (mantissa << 13);
  else
    bits.u = (sign << 31) | ((exponent + 112) << 23) | (mantissa << 13);
  return bits.f;
}
`;

const kernels = new CModule(source);

const indexRangeOf = new NativeFunction(kernels.index_range, "void", ["pointer", "uint64", "uint32", "uint32", "pointer"]);
const widen = new NativeFunction(kernels.widen_indices, "void", ["pointer", "uint64", "uint32", "uint32", "pointer"]);
const triangulateRun = new NativeFunction(kernels.triangulate, "uint64", ["pointer", "uint64", "uint32", "uint32", "uint32", "pointer"]);
const profile = new NativeFunction(kernels.profile_indices, "void", ["pointer", "uint64", "uint32", "uint32", "pointer"]);
const looksLikeMesh = new NativeFunction(kernels.looks_like_mesh_data, "uint32", ["pointer", "uint32"]);
const gather = new NativeFunction(kernels.gather_positions, "uint64",
    ["pointer", "uint64", "uint64", "uint32", "uint32", "pointer", "pointer"]);

const RESTARTS_COUNTED = 0;
const RESTARTS_SKIPPED = 1;
const STRIP_ORDER = 0;
const FAN_ORDER = 1;

const runOrders: Record<Topology, number> = { "triangle-list": STRIP_ORDER, "triangle-strip": STRIP_ORDER, "triangle-fan": FAN_ORDER,
    "point-list": STRIP_ORDER };

export const indexWidths: Record<IndexFormat, number> = { uint8: 1, uint16: 2, uint32: 4 };

export function indexRange(indices: ArrayBuffer, format: IndexFormat, topology: Topology): IndexRange | null {
    const width = indexWidths[format];
    const range = Memory.alloc(16);
    indexRangeOf(indices.unwrap(), indices.byteLength / width, width, restartsOf(topology), range);
    const used = range.add(8).readU64().toNumber();
    return (used === 0) ? null : { min: range.readU32(), max: range.add(4).readU32(), used };
}

export function triangleList(indices: ArrayBuffer, format: IndexFormat, topology: Topology, rebase: number): Uint32Array {
    const width = indexWidths[format];
    const count = indices.byteLength / width;
    if (topology === "triangle-list" || topology === "point-list") {
        const usable = (topology === "triangle-list") ? count - count % 3 : count;
        const widened = new Uint32Array(usable);
        widen(indices.unwrap(), usable, width, rebase, widened.buffer.unwrap());
        return widened;
    }
    const expanded = new Uint32Array(Math.max(count - 2, 0) * 3);
    const written = triangulateRun(indices.unwrap(), count, width, runOrders[topology], rebase, expanded.buffer.unwrap());
    return expanded.subarray(0, written.toNumber());
}

export function looksLikeMeshData(prefix: ArrayBuffer): boolean {
    return looksLikeMesh(prefix.unwrap(), prefix.byteLength) !== 0;
}

export function sequentialIndices(count: number): ArrayBuffer {
    const sequence = new Uint32Array(count);
    for (let i = 0; i !== count; i++) {
        sequence[i] = i;
    }
    return sequence.buffer;
}

export function indexProfile(indices: ArrayBuffer, format: IndexFormat, max: number): IndexProfile {
    const width = indexWidths[format];
    const result = Memory.alloc(24);
    profile(indices.unwrap(), indices.byteLength / width, width, max, result);
    return {
        max,
        distinct: result.add(4).readU32(),
        degenerateTriangles: result.add(8).readU64().toNumber(),
        meanStep: result.add(16).readDouble(),
    };
}

export function gatherPositions(vertices: ArrayBuffer, count: number, stride: number, format: PositionFormat): GatheredPositions {
    const positions = new Float32Array(count * 3);
    const bounds = Memory.alloc(24);
    const nonFinite = gather(vertices.unwrap(), count, stride, componentTypes.indexOf(format.component), format.count,
        positions.buffer.unwrap(), bounds);
    return {
        positions,
        min: [bounds.readFloat(), bounds.add(4).readFloat(), bounds.add(8).readFloat()],
        max: [bounds.add(12).readFloat(), bounds.add(16).readFloat(), bounds.add(20).readFloat()],
        nonFinite: nonFinite.toNumber(),
    };
}

function restartsOf(topology: Topology): number {
    return (topology === "triangle-strip" || topology === "triangle-fan") ? RESTARTS_SKIPPED : RESTARTS_COUNTED;
}
