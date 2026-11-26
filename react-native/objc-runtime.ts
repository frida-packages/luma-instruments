export interface ObjCRuntime {
    classes(): NativePointer[];
    getClass(name: string): NativePointer;
    getProtocol(name: string): NativePointer;
    conformsToProtocol(cls: NativePointer, protocol: NativePointer): boolean;
    superclassOf(cls: NativePointer): NativePointer;
    nameOf(cls: NativePointer): string;
    classMethodNames(cls: NativePointer): string[];
    respondsToClassMethod(cls: NativePointer, selector: string): boolean;
    instanceVariable(object: NativePointer, cls: NativePointer, name: string): NativePointer | null;
    sendForObject(receiver: NativePointer, selector: string): NativePointer;
    sendForObjectAt(receiver: NativePointer, selector: string, index: number): NativePointer;
    sendForCount(receiver: NativePointer, selector: string): number;
    sendForBoolean(receiver: NativePointer, selector: string, argument: NativePointer): boolean;
    stringOf(object: NativePointer): string | null;
    readonly isaClassMask: NativePointer;
    readonly isaMagicMask: NativePointer;
    readonly isaMagicValue: NativePointer;
}

let loaded: ObjCRuntime | null | undefined;

export function objCRuntime(): ObjCRuntime | null {
    if (loaded === undefined) {
        loaded = (Module.findGlobalExportByName("objc_getClassList") !== null) ? loadRuntime() : null;
    }
    return loaded;
}

function loadRuntime(): ObjCRuntime {
    const fn = <R extends NativeFunctionReturnType, A extends NativeFunctionArgumentType[]>(name: string, ret: R, args: [...A]) =>
        new NativeFunction(Module.getGlobalExportByName(name), ret, args);
    const getClassList = fn("objc_getClassList", "int", ["pointer", "int"]);
    const getClass = fn("objc_getClass", "pointer", ["pointer"]);
    const getProtocol = fn("objc_getProtocol", "pointer", ["pointer"]);
    const conformsToProtocol = fn("class_conformsToProtocol", "bool", ["pointer", "pointer"]);
    const superclassOf = fn("class_getSuperclass", "pointer", ["pointer"]);
    const nameOf = fn("class_getName", "pointer", ["pointer"]);
    const classOf = fn("object_getClass", "pointer", ["pointer"]);
    const copyMethodList = fn("class_copyMethodList", "pointer", ["pointer", "pointer"]);
    const methodName = fn("method_getName", "pointer", ["pointer"]);
    const selectorName = fn("sel_getName", "pointer", ["pointer"]);
    const registerSelector = fn("sel_registerName", "pointer", ["pointer"]);
    const respondsToSelector = fn("class_respondsToSelector", "bool", ["pointer", "pointer"]);
    const getInstanceVariable = fn("class_getInstanceVariable", "pointer", ["pointer", "pointer"]);
    const ivarOffset = fn("ivar_getOffset", "long", ["pointer"]);
    const free = fn("free", "void", ["pointer"]);
    const msgSend = Module.getGlobalExportByName("objc_msgSend");
    const sendObject = new NativeFunction(msgSend, "pointer", ["pointer", "pointer"]);
    const sendObjectAt = new NativeFunction(msgSend, "pointer", ["pointer", "pointer", "ulong"]);
    const sendCount = new NativeFunction(msgSend, "ulong", ["pointer", "pointer"]);
    const sendBoolean = new NativeFunction(msgSend, "bool", ["pointer", "pointer", "pointer"]);
    const selectors = new Map<string, NativePointer>();
    const selector = (name: string) => {
        let registered = selectors.get(name);
        if (registered === undefined) {
            registered = registerSelector(Memory.allocUtf8String(name));
            selectors.set(name, registered);
        }
        return registered;
    };
    const isaBit = (name: string) => Module.getGlobalExportByName(name).readPointer();
    return {
        classes() {
            const count = getClassList(NULL, 0);
            const buffer = Memory.alloc(count * Process.pointerSize);
            const filled = Math.min(count, getClassList(buffer, count));
            return Array.from({ length: filled }, (_, i) => buffer.add(i * Process.pointerSize).readPointer());
        },
        getClass: name => getClass(Memory.allocUtf8String(name)),
        getProtocol: name => getProtocol(Memory.allocUtf8String(name)),
        conformsToProtocol: (cls, protocol) => conformsToProtocol(cls, protocol) !== 0,
        superclassOf: cls => superclassOf(cls),
        nameOf: cls => nameOf(cls).readUtf8String()!,
        classMethodNames(cls) {
            const count = Memory.alloc(4);
            const methods = copyMethodList(classOf(cls), count);
            if (methods.isNull()) {
                return [];
            }
            const names = Array.from({ length: count.readU32() }, (_, i) =>
                selectorName(methodName(methods.add(i * Process.pointerSize).readPointer())).readUtf8String()!);
            free(methods);
            return names;
        },
        respondsToClassMethod: (cls, name) => respondsToSelector(classOf(cls), selector(name)) !== 0,
        instanceVariable(object, cls, name) {
            const ivar = getInstanceVariable(cls, Memory.allocUtf8String(name));
            return ivar.isNull() ? null : object.add(ivarOffset(ivar)).readPointer();
        },
        sendForObject: (receiver, name) => sendObject(receiver, selector(name)),
        sendForObjectAt: (receiver, name, index) => sendObjectAt(receiver, selector(name), index),
        sendForCount: (receiver, name) => Number(sendCount(receiver, selector(name))),
        sendForBoolean: (receiver, name, argument) => sendBoolean(receiver, selector(name), argument) !== 0,
        stringOf(object) {
            if (object.isNull()) {
                return null;
            }
            const text = sendObject(object, selector("UTF8String"));
            return text.isNull() ? null : text.readUtf8String();
        },
        isaClassMask: isaBit("objc_debug_isa_class_mask"),
        isaMagicMask: isaBit("objc_debug_isa_magic_mask"),
        isaMagicValue: isaBit("objc_debug_isa_magic_value"),
    };
}
