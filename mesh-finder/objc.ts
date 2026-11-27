const UTF8_ENCODING = 0x08000100;
const LONGEST_STRING = 1024;

export interface IsaBits {
    mask: NativePointer;
    magicMask: NativePointer;
    magicValue: NativePointer;
}

export interface DriverClasses {
    [protocol: string]: NativePointer[];
}

let loaded: ObjCRuntime | null = null;

export const objcSend = {
    pointer: (self: NativePointer, op: NativePointer) => runtime().send.pointer(self, op),
    uint64: (self: NativePointer, op: NativePointer) => runtime().send.uint64(self, op),
    pointerAtIndex: (self: NativePointer, op: NativePointer, index: number) => runtime().send.pointerAtIndex(self, op, index),
    pointerWithOptions: (self: NativePointer, op: NativePointer, options: number) => runtime().send.pointerAtIndex(self, op, options),
    flag: (self: NativePointer, op: NativePointer) => runtime().send.uint8(self, op) !== 0,
};

export function isaBits(): IsaBits {
    return runtime().isa;
}

export function selector(name: string): NativePointer {
    return runtime().registerSelector(Memory.allocUtf8String(name));
}

export function classesConformingTo(protocols: string[], imagePrefix: string): DriverClasses {
    const objc = runtime();
    const wanted = protocols.map(name => objc.getProtocol(Memory.allocUtf8String(name)));
    const countStore = Memory.alloc(4);
    const list = objc.copyClassList(countStore);
    const classes = Array.from({ length: countStore.readU32() }, (_, i) => list.add(i * Process.pointerSize).readPointer());
    objc.freeMemory(list);

    const conforming = new Map<string, number>();
    const found: DriverClasses = Object.fromEntries(protocols.map(name => [name, []]));
    for (const cls of classes) {
        const index = protocolIndexOf(cls, wanted, conforming);
        if (index !== -1 && imageOf(cls).startsWith(imagePrefix)) {
            found[protocols[index]].push(cls);
        }
    }
    return found;
}

export function implementationOf(cls: NativePointer, selectorName: string): NativePointer | null {
    const objc = runtime();
    const method = objc.instanceMethod(cls, selector(selectorName));
    return method.isNull() ? null : objc.implementationOfMethod(method);
}

export function respondsTo(object: NativePointer, selectorName: string): boolean {
    const objc = runtime();
    return objc.classRespondsToSelector(objc.classOf(object), selector(selectorName)) !== 0;
}

export function stringFrom(object: NativePointer): string | null {
    if (object.isNull()) {
        return null;
    }
    const text = Memory.alloc(LONGEST_STRING);
    return runtime().stringIntoBuffer(object, text, LONGEST_STRING, UTF8_ENCODING) ? text.readUtf8String() : null;
}

function protocolIndexOf(cls: NativePointer, protocols: NativePointer[], known: Map<string, number>): number {
    const key = cls.toString();
    const cached = known.get(key);
    if (cached !== undefined) {
        return cached;
    }
    const objc = runtime();
    let index = protocols.findIndex(protocol => !protocol.isNull() && objc.conformsToProtocol(cls, protocol) !== 0);
    if (index === -1) {
        const parent = objc.superclassOf(cls);
        index = parent.isNull() ? -1 : protocolIndexOf(parent, protocols, known);
    }
    known.set(key, index);
    return index;
}

function imageOf(cls: NativePointer): string {
    const image = runtime().imageOfClass(cls);
    return image.isNull() ? "" : image.readUtf8String()!;
}

function runtime(): ObjCRuntime {
    loaded ??= new ObjCRuntime();
    return loaded;
}

class ObjCRuntime {
    readonly #export = (name: string) => Module.getGlobalExportByName(name);

    readonly copyClassList = new NativeFunction(this.#export("objc_copyClassList"), "pointer", ["pointer"]);
    readonly getProtocol = new NativeFunction(this.#export("objc_getProtocol"), "pointer", ["pointer"]);
    readonly conformsToProtocol = new NativeFunction(this.#export("class_conformsToProtocol"), "bool", ["pointer", "pointer"]);
    readonly superclassOf = new NativeFunction(this.#export("class_getSuperclass"), "pointer", ["pointer"]);
    readonly imageOfClass = new NativeFunction(this.#export("class_getImageName"), "pointer", ["pointer"]);
    readonly instanceMethod = new NativeFunction(this.#export("class_getInstanceMethod"), "pointer", ["pointer", "pointer"]);
    readonly implementationOfMethod = new NativeFunction(this.#export("method_getImplementation"), "pointer", ["pointer"]);
    readonly classOf = new NativeFunction(this.#export("object_getClass"), "pointer", ["pointer"]);
    readonly classRespondsToSelector = new NativeFunction(this.#export("class_respondsToSelector"), "bool", ["pointer", "pointer"]);
    readonly registerSelector = new NativeFunction(this.#export("sel_registerName"), "pointer", ["pointer"]);
    readonly freeMemory = new NativeFunction(this.#export("free"), "void", ["pointer"]);
    readonly stringIntoBuffer = new NativeFunction(this.#export("CFStringGetCString"), "bool", ["pointer", "pointer", "long", "uint32"]);
    readonly isa: IsaBits = {
        mask: this.#export("objc_debug_isa_class_mask").readPointer(),
        magicMask: this.#export("objc_debug_isa_magic_mask").readPointer(),
        magicValue: this.#export("objc_debug_isa_magic_value").readPointer(),
    };
    readonly send = {
        pointer: new NativeFunction(this.#export("objc_msgSend"), "pointer", ["pointer", "pointer"]),
        uint64: new NativeFunction(this.#export("objc_msgSend"), "uint64", ["pointer", "pointer"]),
        uint8: new NativeFunction(this.#export("objc_msgSend"), "uint8", ["pointer", "pointer"]),
        pointerAtIndex: new NativeFunction(this.#export("objc_msgSend"), "pointer", ["pointer", "pointer", "uint64"]),
    };
}
