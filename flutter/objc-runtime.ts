export interface ObjCClass {
    implementationOf(selector: string): NativePointer;
    ivarOffset(name: string): number;
}

let loaded: ObjCRuntime | null = null;

export function objcClass(name: string): ObjCClass {
    const objc = runtime();
    const cls = objc.getClass(Memory.allocUtf8String(name));
    return {
        implementationOf(selector) {
            const method = objc.instanceMethod(cls, objc.registerSelector(Memory.allocUtf8String(selector)));
            return objc.implementationOfMethod(method);
        },
        ivarOffset(ivar) {
            return objc.ivarOffset(objc.instanceVariable(cls, Memory.allocUtf8String(ivar))).toNumber();
        },
    };
}

function runtime(): ObjCRuntime {
    loaded ??= new ObjCRuntime();
    return loaded;
}

class ObjCRuntime {
    readonly #export = (name: string) => Module.getGlobalExportByName(name);

    readonly getClass = new NativeFunction(this.#export("objc_getClass"), "pointer", ["pointer"]);
    readonly registerSelector = new NativeFunction(this.#export("sel_registerName"), "pointer", ["pointer"]);
    readonly instanceMethod = new NativeFunction(this.#export("class_getInstanceMethod"), "pointer", ["pointer", "pointer"]);
    readonly implementationOfMethod = new NativeFunction(this.#export("method_getImplementation"), "pointer", ["pointer"]);
    readonly instanceVariable = new NativeFunction(this.#export("class_getInstanceVariable"), "pointer", ["pointer", "pointer"]);
    readonly ivarOffset = new NativeFunction(this.#export("ivar_getOffset"), "int64", ["pointer"]);
}
