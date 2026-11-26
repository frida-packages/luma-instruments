import type { BufferAccess, GpuBuffer } from "./graphics-backend.js";
import { BufferFacts, IsaBits } from "./metal-buffer-facts.pat";
import { isaBits } from "./objc.js";

const MAX_CLASSES = 64;
const MOST_CANDIDATES = 1_000_000;

const source = `
#include <glib.h>

#define OBJECT_ALIGNMENT_MASK 15
#define UTF8_ENCODING 0x08000100
#define LABEL_CAPACITY 256
#define MAX_CLASSES ${MAX_CLASSES}

typedef struct
{
  guint64 class_mask;
  guint64 magic_mask;
  guint64 magic_value;
} IsaBits;

typedef struct
{
  gpointer contents;
  guint64 length;
  guint64 storage_mode;
  guint64 gpu_address;
} BufferFacts;

extern gpointer objc_msgSend (gpointer self, gpointer op, ...);
extern gpointer sel_registerName (const gchar * name);
extern gpointer objc_autoreleasePoolPush (void);
extern void objc_autoreleasePoolPop (gpointer pool);
extern guint8 CFStringGetCString (gpointer string, gchar * buffer, glong size, guint32 encoding);
extern gsize malloc_size (gconstpointer pointer);

typedef gpointer (* PointerGetter) (gpointer self, gpointer op);
typedef guint64 (* ValueGetter) (gpointer self, gpointer op);

typedef struct
{
  gpointer contents;
  gpointer length;
  gpointer storage_mode;
  gpointer gpu_address;
  gpointer label;
} Selectors;

extern Selectors selectors;

void init (void)
{
  selectors.contents = sel_registerName ("contents");
  selectors.length = sel_registerName ("length");
  selectors.storage_mode = sel_registerName ("storageMode");
  selectors.gpu_address = sel_registerName ("gpuAddress");
  selectors.label = sel_registerName ("label");
}

typedef struct
{
  guint64 count;
  guint64 classes[MAX_CLASSES];
  guint64 instance_sizes[MAX_CLASSES];
} KnownClasses;

guint8 describe_buffer (gpointer object, const KnownClasses * known, const IsaBits * isa, BufferFacts * facts, gchar * label_text)
{
  gpointer pool, label;
  gsize block_size;
  guint64 header, i;

  if (((guint64) object & OBJECT_ALIGNMENT_MASK) != 0)
    return FALSE;
  block_size = malloc_size (object);
  if (block_size == 0)
    return FALSE;
  header = *(guint64 *) object;
  if ((header & isa->magic_mask) != isa->magic_value)
    return FALSE;
  for (i = 0; i != known->count; i++)
  {
    if (known->classes[i] == (header & isa->class_mask))
      break;
  }
  if (i == known->count || block_size < known->instance_sizes[i])
    return FALSE;

  pool = objc_autoreleasePoolPush ();
  facts->contents = ((PointerGetter) objc_msgSend) (object, selectors.contents);
  facts->length = ((ValueGetter) objc_msgSend) (object, selectors.length);
  facts->storage_mode = ((ValueGetter) objc_msgSend) (object, selectors.storage_mode);
  facts->gpu_address = ((ValueGetter) objc_msgSend) (object, selectors.gpu_address);
  label_text[0] = 0;
  label = ((PointerGetter) objc_msgSend) (object, selectors.label);
  if (label != NULL)
    CFStringGetCString (label, label_text, LABEL_CAPACITY, UTF8_ENCODING);
  objc_autoreleasePoolPop (pool);
  return TRUE;
}
`;

const LABEL_CAPACITY = 256;
const GPU_ONLY_STORAGE_MODES = new Set([2, 3]);

export interface MetalBufferScan {
    buffers: MetalBuffer[];
    candidates: number;
    unchecked: number;
}

export function findMetalBuffers(bufferClasses: NativePointer[], describer: MetalBufferDescriber): MetalBufferScan {
    const { mask } = isaBits();
    const matches = Memory.findPointers(Process.enumerateRanges("rw-"), bufferClasses, { mask });
    const buffers: MetalBuffer[] = [];
    for (const { address } of matches.slice(0, MOST_CANDIDATES)) {
        const buffer = describer.describe(address);
        if (buffer !== null) {
            buffers.push(buffer);
        }
    }
    return { buffers, candidates: matches.length, unchecked: Math.max(matches.length - MOST_CANDIDATES, 0) };
}

export class MetalBufferDescriber {
    readonly #facts = BufferFacts.at(Memory.alloc(BufferFacts.size));
    readonly #label = Memory.alloc(LABEL_CAPACITY);
    readonly #selectors = Memory.alloc(5 * Process.pointerSize);
    readonly #describer = new CModule(source, {
        selectors: this.#selectors,
        objc_msgSend: Module.getGlobalExportByName("objc_msgSend"),
        sel_registerName: Module.getGlobalExportByName("sel_registerName"),
        objc_autoreleasePoolPush: Module.getGlobalExportByName("objc_autoreleasePoolPush"),
        objc_autoreleasePoolPop: Module.getGlobalExportByName("objc_autoreleasePoolPop"),
        CFStringGetCString: Module.getGlobalExportByName("CFStringGetCString"),
        malloc_size: Module.getGlobalExportByName("malloc_size"),
    });
    readonly #describeBuffer = new NativeFunction(this.#describer.describe_buffer, "uint8",
        ["pointer", "pointer", "pointer", "pointer", "pointer"]);
    readonly #isa = IsaBits.at(Memory.alloc(IsaBits.size));
    readonly #known: NativePointer;

    constructor(bufferClasses: NativePointer[]) {
        const { mask, magicMask, magicValue } = isaBits();
        this.#isa.classMask = mask;
        this.#isa.magicMask = magicMask;
        this.#isa.magicValue = magicValue;
        this.#known = knownClasses(bufferClasses.slice(0, MAX_CLASSES));
    }

    describe(object: NativePointer): MetalBuffer | null {
        const facts = this.#facts;
        if (this.#describeBuffer(object, this.#known, this.#isa.$address, facts.$address, this.#label) === 0) {
            return null;
        }
        return new MetalBuffer(
            object,
            facts.contents,
            facts.length.toNumber(),
            facts.storageMode.toNumber(),
            facts.gpuAddress.toNumber(),
            this.#label.readUtf8String() || null,
        );
    }
}

export class MetalBuffer implements GpuBuffer {
    readonly api = "Metal";
    readonly id: string;
    readonly address: string;
    readonly label: string | null;
    readonly byteLength: number;
    readonly access: BufferAccess;
    readonly creationOrder: number;
    readonly #contents: NativePointer;

    constructor(
        object: NativePointer,
        contents: NativePointer,
        byteLength: number,
        storageMode: number,
        creationOrder: number,
        label: string | null,
    ) {
        this.#contents = contents;
        this.id = metalBufferId(object);
        this.address = object.toString();
        this.label = label;
        this.byteLength = byteLength;
        this.access = (GPU_ONLY_STORAGE_MODES.has(storageMode) || contents.isNull()) ? "gpu-only" : "cpu-readable";
        this.creationOrder = creationOrder;
    }

    read(offset: number, length: number): ArrayBuffer {
        if (this.access === "gpu-only") {
            throw new Error(`${this.address} is in GPU-only storage`);
        }
        if (offset < 0 || length < 0 || offset + length > this.byteLength) {
            throw new Error(`read of ${length} bytes at ${offset} is outside ${this.address}, which holds ${this.byteLength}`);
        }
        return this.#contents.add(offset).readByteArray(length)!;
    }
}

export function metalBufferId(object: NativePointer): string {
    return `Metal:${object}`;
}

export class BytesBuffer implements GpuBuffer {
    readonly api = "Metal";
    readonly id: string;
    readonly address = "setVertexBytes";
    readonly label = null;
    readonly byteLength: number;
    readonly access: BufferAccess = "cpu-readable";
    readonly creationOrder = 0;
    readonly #bytes: ArrayBuffer;

    constructor(source: NativePointer, byteLength: number, digest: string) {
        this.byteLength = byteLength;
        this.#bytes = source.readByteArray(byteLength)!;
        this.id = `Metal:bytes:${digest}x${byteLength}`;
    }

    read(offset: number, length: number): ArrayBuffer {
        if (offset < 0 || length < 0 || offset + length > this.byteLength) {
            throw new Error(`read of ${length} bytes at ${offset} is outside ${this.byteLength} bytes set with setVertexBytes`);
        }
        return this.#bytes.slice(offset, offset + length);
    }
}

function knownClasses(classes: NativePointer[]): NativePointer {
    const instanceSize = new NativeFunction(Module.getGlobalExportByName("class_getInstanceSize"), "size_t", ["pointer"]);
    const known = Memory.alloc((1 + 2 * MAX_CLASSES) * 8);
    known.writeU64(classes.length);
    classes.forEach((cls, i) => {
        known.add(8 * (1 + i)).writePointer(cls);
        known.add(8 * (1 + MAX_CLASSES + i)).writeU64(instanceSize(cls) as number | UInt64);
    });
    return known;
}
