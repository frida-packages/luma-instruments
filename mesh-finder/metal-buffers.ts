import type { BufferAccess, GpuBuffer } from "./graphics-backend.js";
import { BufferFacts, IsaBits } from "./metal-buffer-facts.pat";
import { isaBits } from "./objc.js";

const source = `
#include <glib.h>

#define OBJECT_ALIGNMENT_MASK 15
#define UTF8_ENCODING 0x08000100
#define LABEL_CAPACITY 256

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

guint8 describe_buffer (gpointer object, guint64 expected_class, const IsaBits * isa, BufferFacts * facts, gchar * label_text)
{
  gpointer pool, label;
  guint64 header;

  if (((guint64) object & OBJECT_ALIGNMENT_MASK) != 0)
    return FALSE;
  header = *(guint64 *) object;
  if ((header & isa->class_mask) != expected_class || (header & isa->magic_mask) != isa->magic_value)
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

export function findMetalBuffers(bufferClasses: NativePointer[], describer: MetalBufferDescriber): MetalBuffer[] {
    const { mask } = isaBits();
    const matches = Memory.findPointers(Process.enumerateRanges("rw-"), bufferClasses, { mask });
    const buffers: MetalBuffer[] = [];
    for (const { address, value } of matches) {
        const buffer = describer.describe(address, value.and(mask));
        if (buffer !== null) {
            buffers.push(buffer);
        }
    }
    return buffers;
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
    });
    readonly #describeBuffer = new NativeFunction(this.#describer.describe_buffer, "uint8",
        ["pointer", "uint64", "pointer", "pointer", "pointer"]);
    readonly #isa = IsaBits.at(Memory.alloc(IsaBits.size));

    constructor() {
        const { mask, magicMask, magicValue } = isaBits();
        this.#isa.classMask = mask;
        this.#isa.magicMask = magicMask;
        this.#isa.magicValue = magicValue;
    }

    describeLive(object: NativePointer): MetalBuffer | null {
        return this.describe(object, object.readPointer().and(isaBits().mask));
    }

    describe(object: NativePointer, cls: NativePointer): MetalBuffer | null {
        const facts = this.#facts;
        if (!isReadable(object)
            || this.#describeBuffer(object, uint64(cls.toString()), this.#isa.$address, facts.$address, this.#label) === 0) {
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

function isReadable(object: NativePointer): boolean {
    try {
        object.readU64();
        return true;
    } catch {
        return false;
    }
}
