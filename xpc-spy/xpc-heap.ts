import { HeapKinds, HeapSnapshotRequest, Location, ObjectBatch, ObjectFacts } from "./xpc-heap-facts.pat";
import { xpcClasses } from "./xpc.js";
import type { XpcLayout } from "./xpc-layout.js";

const source = `
#include <glib.h>
#include <gum/gummemory.h>

#define OBJECT_ALIGNMENT_MASK 15
#define NOT_HELD -1
#define ARM_THREAD_STATE64 6
#define ARM_THREAD_STATE64_COUNT 68
#define SAFE_POINT_SEARCH_LIMIT_NS (10 * 1000 * 1000)
#define SAFE_POINT_RETRY_DELAY_US 25
#define CLOCK_UPTIME_RAW 8

typedef guint8 (* RetainFunc) (gpointer self, gpointer op);

typedef struct
{
  guint64 isa_class_mask;
  gpointer malloc_block_class;
  gpointer global_block_class;
  gpointer retain_weak_reference;
  gpointer allocator_start;
  gpointer allocator_end;
} HeapKinds;

typedef struct
{
  gpointer object;
  gpointer handler;
  gpointer invoke;
} ObjectFacts;

typedef struct
{
  gpointer cls;
  RetainFunc retain;
  guint64 handler_offset;
  gpointer * candidates;
  guint32 count;
  guint32 retained;
  ObjectFacts * facts;
} ObjectBatch;

typedef struct
{
  guint32 * spared_threads;
  guint32 spared_count;
  guint32 stopped_capacity;
  guint32 * stopped_threads;
  ObjectBatch connections;
  ObjectBatch serializers;
  guint64 paused_for;
} HeapSnapshotRequest;

typedef struct
{
  gint64 offset;
  guint64 size;
  guint64 matches;
} Location;

typedef struct
{
  guint32 count;
  guint32 capacity;
  guint32 * threads;
} StoppedThreads;

typedef struct
{
  guint64 x[29];
  gpointer fp;
  gpointer lr;
  gpointer sp;
  gpointer pc;
  guint32 cpsr;
  guint32 flags;
} ThreadState;

typedef struct
{
  gpointer isa;
  gint32 flags;
  gint32 reserved;
  gpointer invoke;
} BlockLayout;

typedef enum
{
  THREAD_STOPPED,
  THREAD_GONE,
  THREAD_BUSY
} StopOutcome;

extern HeapKinds kinds;
extern guint32 mach_task_self_;

extern gsize malloc_size (gconstpointer ptr);
extern gint task_threads (guint32 task, guint32 ** threads, guint32 * count);
extern gint thread_suspend (guint32 thread);
extern gint thread_resume (guint32 thread);
extern gint thread_get_state (guint32 thread, gint flavor, gpointer state, guint32 * count);
extern gint mach_port_deallocate (guint32 task, guint32 name);
extern gint vm_deallocate (guint32 task, gpointer address, gsize size);
extern gint mach_vm_read_overwrite (guint32 task, guint64 address, guint64 size, guint64 data, guint64 * out_size);
extern gint usleep (guint32 microseconds);
extern guint64 clock_gettime_nsec_np (gint clock);

static gboolean stop_threads (const HeapSnapshotRequest * request, StoppedThreads * stopped, guint64 deadline);
static gboolean stop_new_threads (const HeapSnapshotRequest * request, StoppedThreads * stopped, guint64 deadline,
    gboolean * found_new);
static gboolean contains_thread (const guint32 * threads, guint count, guint32 thread);
static StopOutcome stop_at_safe_point (guint32 thread, guint64 deadline);
static gboolean is_inside_allocator (guint32 thread);
static gboolean is_allocator_code (gpointer address);
static void retain_objects (ObjectBatch * batch);
static void resume_threads (StoppedThreads * stopped);
static gsize instance_size (gpointer candidate, gpointer cls);
static gboolean has_class (gpointer candidate, gpointer cls);
static gpointer invoke_of_block_at (gpointer object, gsize offset, gpointer * block);
static gboolean read_pointer (gpointer object, gsize offset, gpointer * value);
static gboolean read_safely (gconstpointer address, gpointer data, gsize size);

guint list_threads (guint32 * threads, guint capacity)
{
  guint32 * listed, n, i;

  if (task_threads (mach_task_self_, &listed, &n) != 0)
    return 0;
  for (i = 0; i != n; i++)
  {
    if (i < capacity)
      threads[i] = listed[i];
    mach_port_deallocate (mach_task_self_, listed[i]);
  }
  vm_deallocate (mach_task_self_, listed, n * sizeof (guint32));
  return n;
}

guint select_objects (gpointer * candidates, guint n, gpointer cls, gsize size)
{
  guint selected, i;

  selected = 0;
  for (i = 0; i != n; i++)
  {
    if (instance_size (candidates[i], cls) == size)
      candidates[selected++] = candidates[i];
  }
  return selected;
}

gboolean snapshot_heap (HeapSnapshotRequest * request)
{
  StoppedThreads stopped = { 0, request->stopped_capacity, request->stopped_threads };
  guint64 stopped_at;
  gboolean stopped_all;

  stopped_at = clock_gettime_nsec_np (CLOCK_UPTIME_RAW);
  stopped_all = stop_threads (request, &stopped, stopped_at + SAFE_POINT_SEARCH_LIMIT_NS);
  if (stopped_all)
  {
    retain_objects (&request->connections);
    retain_objects (&request->serializers);
  }
  resume_threads (&stopped);
  request->paused_for = clock_gettime_nsec_np (CLOCK_UPTIME_RAW) - stopped_at;
  return stopped_all;
}

void locate_value (gpointer candidate, gpointer cls, gpointer value, Location * location)
{
  gsize offset;

  location->offset = NOT_HELD;
  location->matches = 0;
  location->size = instance_size (candidate, cls);
  for (offset = 0; offset != location->size; offset += sizeof (gpointer))
  {
    gpointer held;

    if (!read_pointer (candidate, offset, &held) || held != value)
      continue;
    if (location->matches++ == 0)
      location->offset = offset;
  }
}

static gboolean stop_threads (const HeapSnapshotRequest * request, StoppedThreads * stopped, guint64 deadline)
{
  gboolean found_new;

  do
  {
    if (!stop_new_threads (request, stopped, deadline, &found_new))
      return FALSE;
  }
  while (found_new);
  return TRUE;
}

static gboolean stop_new_threads (const HeapSnapshotRequest * request, StoppedThreads * stopped, guint64 deadline,
    gboolean * found_new)
{
  guint32 * threads, n, i;
  gboolean stopped_all;

  *found_new = FALSE;
  if (task_threads (mach_task_self_, &threads, &n) != 0)
    return FALSE;

  stopped_all = TRUE;
  for (i = 0; i != n; i++)
  {
    guint32 thread = threads[i];
    StopOutcome outcome;

    if (!stopped_all || contains_thread (stopped->threads, stopped->count, thread)
        || contains_thread (request->spared_threads, request->spared_count, thread))
    {
      mach_port_deallocate (mach_task_self_, thread);
      continue;
    }

    outcome = (stopped->count != stopped->capacity) ? stop_at_safe_point (thread, deadline) : THREAD_BUSY;
    if (outcome == THREAD_STOPPED)
    {
      stopped->threads[stopped->count++] = thread;
      *found_new = TRUE;
    }
    else
    {
      mach_port_deallocate (mach_task_self_, thread);
      stopped_all = outcome == THREAD_GONE;
    }
  }

  vm_deallocate (mach_task_self_, threads, n * sizeof (guint32));
  return stopped_all;
}

static gboolean contains_thread (const guint32 * threads, guint count, guint32 thread)
{
  guint i;

  for (i = 0; i != count; i++)
  {
    if (threads[i] == thread)
      return TRUE;
  }
  return FALSE;
}

static StopOutcome stop_at_safe_point (guint32 thread, guint64 deadline)
{
  while (TRUE)
  {
    if (thread_suspend (thread) != 0)
      return THREAD_GONE;
    if (!is_inside_allocator (thread))
      return THREAD_STOPPED;
    thread_resume (thread);
    if (clock_gettime_nsec_np (CLOCK_UPTIME_RAW) >= deadline)
      return THREAD_BUSY;
    usleep (SAFE_POINT_RETRY_DELAY_US);
  }
}

static gboolean is_inside_allocator (guint32 thread)
{
  ThreadState state;
  guint32 count = ARM_THREAD_STATE64_COUNT;

  if (thread_get_state (thread, ARM_THREAD_STATE64, &state, &count) != 0)
    return TRUE;
  return is_allocator_code (state.pc) || is_allocator_code (state.lr);
}

static gboolean is_allocator_code (gpointer address)
{
  gpointer code = gum_strip_code_pointer (address);

  return code >= kinds.allocator_start && code < kinds.allocator_end;
}

static void retain_objects (ObjectBatch * batch)
{
  guint i;

  batch->retained = 0;
  for (i = 0; i != batch->count; i++)
  {
    gpointer candidate = batch->candidates[i];
    ObjectFacts * facts = &batch->facts[batch->retained];

    if (!has_class (candidate, batch->cls) || (batch->retain != NULL && !batch->retain (candidate, kinds.retain_weak_reference)))
      continue;

    facts->object = candidate;
    facts->invoke = invoke_of_block_at (candidate, batch->handler_offset, &facts->handler);
    batch->retained++;
  }
}

static void resume_threads (StoppedThreads * stopped)
{
  while (stopped->count != 0)
  {
    guint32 thread = stopped->threads[--stopped->count];

    thread_resume (thread);
    mach_port_deallocate (mach_task_self_, thread);
  }
}

static gsize instance_size (gpointer candidate, gpointer cls)
{
  gsize size;

  if (((gsize) candidate & OBJECT_ALIGNMENT_MASK) != 0)
    return 0;
  size = malloc_size (candidate);
  if (size == 0 || !has_class (candidate, cls))
    return 0;
  return size;
}

static gboolean has_class (gpointer candidate, gpointer cls)
{
  guint64 isa;

  return read_safely (candidate, &isa, sizeof (isa)) && (isa & kinds.isa_class_mask) == (guint64) cls;
}

static gpointer invoke_of_block_at (gpointer object, gsize offset, gpointer * block)
{
  BlockLayout candidate;
  gpointer isa;

  *block = NULL;
  if (!read_pointer (object, offset, block) || *block == NULL || !read_safely (*block, &candidate, sizeof (candidate)))
    return NULL;
  isa = gum_strip_code_pointer (candidate.isa);
  if (isa != kinds.malloc_block_class && isa != kinds.global_block_class)
    return NULL;
  return gum_strip_code_pointer (candidate.invoke);
}

static gboolean read_pointer (gpointer object, gsize offset, gpointer * value)
{
  if (!read_safely ((guint8 *) object + offset, value, sizeof (gpointer)))
    return FALSE;
  *value = gum_strip_code_pointer (*value);
  return TRUE;
}

static gboolean read_safely (gconstpointer address, gpointer data, gsize size)
{
  guint64 copied;

  return mach_vm_read_overwrite (mach_task_self_, (guint64) address, size, (guint64) data, &copied) == 0 && copied == size;
}
`;

export interface HeapCandidate {
    address: NativePointer;
    cls: NativePointer;
}

export interface HeapSnapshot {
    connections: RetainedConnection[];
    pendingReplies: BlockHandler[];
    pauseMs: number;
}

export interface RetainedConnection {
    connection: NativePointer;
    eventHandler: BlockHandler | null;
}

export interface BlockHandler {
    block: NativePointer;
    invoke: NativePointer;
}

export interface HeapLocation {
    offset: number;
    size: number;
    matches: number;
}

interface ObjectKind {
    cls: NativePointer;
    size: number;
    handlerOffset: number;
    retained: boolean;
}

interface InspectedObject {
    object: NativePointer;
    handler: BlockHandler | null;
}

const SPARE_THREAD_CAPACITY = 64;
const OBJECTS_READ_WHILE_STOPPED = 4096;
const THREAD_PORT_SIZE = 4;

const objcRuntime = Process.getModuleByName("libobjc.A.dylib");
const isaClassMask = objcRuntime.getExportByName("objc_debug_isa_class_mask").readPointer();
const releaseObject = new NativeFunction(Module.getGlobalExportByName("os_release"), "void", ["pointer"]);

let inspector: HeapInspector | null = null;

export function snapshotHeap(layout: XpcLayout): HeapSnapshot {
    const candidates = findCandidates([xpcClasses.connection, xpcClasses.serializer]);
    return heapInspector().snapshot(candidates, [
        { cls: xpcClasses.connection, size: layout.connectionSize, handlerOffset: layout.eventHandlerOffset, retained: true },
        { cls: xpcClasses.serializer, size: layout.serializerSize, handlerOffset: layout.replyHandlerOffset, retained: false },
    ]);
}

export function releaseSnapshot({ connections }: HeapSnapshot): void {
    for (const { connection } of connections) {
        releaseObject(connection);
    }
}

export function findCandidates(classes: NativePointer[]): HeapCandidate[] {
    return Memory.findPointers(Process.enumerateRanges("rw-"), classes, { mask: isaClassMask })
        .map(({ address, value }) => ({ address, cls: value.and(isaClassMask) }));
}

export function locateValue(candidate: NativePointer, cls: NativePointer, value: NativePointer): HeapLocation | null {
    const location = heapInspector().locate(candidate, cls, value);
    return (location.matches === 0) ? null : location;
}

function heapInspector(): HeapInspector {
    inspector ??= new HeapInspector();
    return inspector;
}

class HeapInspector {
    readonly #kinds = HeapKinds.at(Memory.alloc(HeapKinds.size));
    readonly #location = Location.at(Memory.alloc(Location.size));
    readonly #retainConnection: NativePointer;
    readonly #module: CModule;
    readonly #listThreads: NativeFunction<number, [NativePointerValue, number]>;
    readonly #selectObjects: NativeFunction<number, [NativePointer, number, NativePointer, number]>;
    readonly #snapshotHeap: NativeFunction<number, [NativePointer]>;
    readonly #locateValue: NativeFunction<void, [NativePointer, NativePointer, NativePointer, NativePointer]>;

    constructor() {
        if (Process.arch !== "arm64") {
            throw new Error("existing connections are looked for only in arm64 processes");
        }
        if (xpcClasses.serializer.isNull()) {
            throw new Error("libxpc has no OS_xpc_serializer class to find requests awaiting a reply by");
        }
        const registerSelector = new NativeFunction(objcRuntime.getExportByName("sel_registerName"), "pointer", ["pointer"]);
        const implementationOf = new NativeFunction(objcRuntime.getExportByName("class_getMethodImplementation"), "pointer",
            ["pointer", "pointer"]);
        const retainWeakReference = registerSelector(Memory.allocUtf8String("retainWeakReference"));
        this.#retainConnection = implementationOf(xpcClasses.connection, retainWeakReference);

        const allocator = Process.getModuleByName("libsystem_malloc.dylib");
        const kinds = this.#kinds;
        kinds.isaClassMask = isaClassMask;
        kinds.mallocBlockClass = Module.getGlobalExportByName("_NSConcreteMallocBlock");
        kinds.globalBlockClass = Module.getGlobalExportByName("_NSConcreteGlobalBlock");
        kinds.retainWeakReference = retainWeakReference;
        kinds.allocatorStart = allocator.base;
        kinds.allocatorEnd = allocator.base.add(allocator.size);

        const module = new CModule(source, {
            kinds: kinds.$address,
            mach_task_self_: Module.getGlobalExportByName("mach_task_self_"),
            malloc_size: Module.getGlobalExportByName("malloc_size"),
            task_threads: Module.getGlobalExportByName("task_threads"),
            thread_suspend: Module.getGlobalExportByName("thread_suspend"),
            thread_resume: Module.getGlobalExportByName("thread_resume"),
            thread_get_state: Module.getGlobalExportByName("thread_get_state"),
            mach_port_deallocate: Module.getGlobalExportByName("mach_port_deallocate"),
            vm_deallocate: Module.getGlobalExportByName("vm_deallocate"),
            mach_vm_read_overwrite: Module.getGlobalExportByName("mach_vm_read_overwrite"),
            usleep: Module.getGlobalExportByName("usleep"),
            clock_gettime_nsec_np: Module.getGlobalExportByName("clock_gettime_nsec_np"),
        });
        this.#module = module;
        this.#listThreads = new NativeFunction(module.list_threads, "uint", ["pointer", "uint"]);
        this.#selectObjects = new NativeFunction(module.select_objects, "uint", ["pointer", "uint", "pointer", "size_t"]);
        this.#snapshotHeap = new NativeFunction(module.snapshot_heap, "int", ["pointer"], { scheduling: "exclusive" });
        this.#locateValue = new NativeFunction(module.locate_value, "void", ["pointer", "pointer", "pointer", "pointer"]);
    }

    snapshot(candidates: HeapCandidate[], [connections, serializers]: ObjectKind[]): HeapSnapshot {
        const request = new SnapshotRequest();
        this.#prepareBatch(request, request.fields.connections, candidates, connections);
        this.#prepareBatch(request, request.fields.serializers, candidates, serializers);
        if (request.fields.connections.count + request.fields.serializers.count > OBJECTS_READ_WHILE_STOPPED) {
            throw new Error(`the process has more than ${OBJECTS_READ_WHILE_STOPPED} connections and requests awaiting a reply, `
                + "too many to read while it is stopped");
        }
        this.#spareFridaThreads(request);
        if (this.#snapshotHeap(request.fields.$address) === 0) {
            throw new Error("the process's threads could not all be stopped outside the memory allocator");
        }
        return {
            connections: inspectedIn(request.fields.connections).map(({ object, handler }) => ({ connection: object, eventHandler: handler })),
            pendingReplies: inspectedIn(request.fields.serializers).flatMap(({ handler }) => (handler !== null) ? [handler] : []),
            pauseMs: request.fields.pausedFor.toNumber() / 1e6,
        };
    }

    locate(candidate: NativePointer, cls: NativePointer, value: NativePointer): HeapLocation {
        const location = this.#location;
        this.#locateValue(candidate, cls, value, location.$address);
        return { offset: location.offset.toNumber(), size: location.size.toNumber(), matches: location.matches.toNumber() };
    }

    #prepareBatch(request: SnapshotRequest, batch: ObjectBatch, candidates: HeapCandidate[], kind: ObjectKind): void {
        const addresses = candidates.filter(({ cls }) => cls.equals(kind.cls)).map(({ address }) => address);
        const array = request.allocate(addresses.length * Process.pointerSize);
        addresses.forEach((address, index) => array.add(index * Process.pointerSize).writePointer(address));
        const count = this.#selectObjects(array, addresses.length, kind.cls, kind.size);
        batch.cls = kind.cls;
        batch.retain = (kind.retained) ? this.#retainConnection : NULL;
        batch.handlerOffset = uint64(kind.handlerOffset);
        batch.candidates = array;
        batch.count = count;
        batch.facts = request.allocate(count * ObjectFacts.size);
    }

    #spareFridaThreads(request: SnapshotRequest): void {
        const capacity = this.#listThreads(NULL, 0) + SPARE_THREAD_CAPACITY;
        const listed = request.allocate(capacity * THREAD_PORT_SIZE);
        const count = Math.min(this.#listThreads(listed, capacity), capacity);
        const spared = Array.from({ length: count }, (_, index) => listed.add(index * THREAD_PORT_SIZE).readU32())
            .filter(thread => Cloak.hasThread(thread) || thread === Process.getCurrentThreadId());
        spared.forEach((thread, index) => listed.add(index * THREAD_PORT_SIZE).writeU32(thread));
        const { fields } = request;
        fields.sparedThreads = listed;
        fields.sparedCount = spared.length;
        fields.stoppedCapacity = capacity * 2;
        fields.stoppedThreads = request.allocate(fields.stoppedCapacity * THREAD_PORT_SIZE);
    }
}

class SnapshotRequest {
    readonly #memory: NativePointer[] = [];
    readonly fields = HeapSnapshotRequest.at(this.allocate(HeapSnapshotRequest.size));

    allocate(size: number): NativePointer {
        const memory = Memory.alloc(Math.max(size, 1));
        this.#memory.push(memory);
        return memory;
    }
}

function inspectedIn(batch: ObjectBatch): InspectedObject[] {
    return Array.from({ length: batch.retained }, (_, index) => {
        const { object, handler, invoke } = ObjectFacts.at(batch.facts.add(index * ObjectFacts.size));
        return { object, handler: (invoke.isNull()) ? null : { block: handler, invoke } };
    });
}
