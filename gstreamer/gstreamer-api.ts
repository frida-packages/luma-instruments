export type ElementState = "void-pending" | "null" | "ready" | "paused" | "playing";

export interface BinFacts {
    name: string;
    type: string;
    isPipeline: boolean;
    state: ElementState;
    pending: ElementState;
    elements: number;
}

const elementStates: ElementState[] = ["void-pending", "null", "ready", "paused", "playing"];
const withoutWaiting = 0;
const exclusive: NativeFunctionOptions = { scheduling: "exclusive" };

export class GStreamerApi {
    readonly setStateAddress: NativePointer;
    readonly version: string;

    readonly #binGetType: NativeFunction<NativePointer, []>;
    readonly #pipelineGetType: NativeFunction<NativePointer, []>;
    readonly #getState: NativeFunction<number, [NativePointer, NativePointer, NativePointer, number]>;
    readonly #getParent: NativeFunction<NativePointer, [NativePointer]>;
    readonly #getName: NativeFunction<NativePointer, [NativePointer]>;
    readonly #binToDotData: NativeFunction<NativePointer, [NativePointer, number]>;
    readonly #childrenCount: NativeFunction<number, [NativePointer]>;
    readonly #childByIndex: NativeFunction<NativePointer, [NativePointer, number]>;
    readonly #typeChildren: NativeFunction<NativePointer, [NativePointer, NativePointer]>;
    readonly #typeClassPeek: NativeFunction<NativePointer, [NativePointer]>;
    readonly #typeNameFromInstance: NativeFunction<NativePointer, [NativePointer]>;
    readonly #instanceIsA: NativeFunction<number, [NativePointer, NativePointer]>;
    readonly #free: NativeFunction<void, [NativePointer]>;
    readonly #objectUnref: NativeFunction<void, [NativePointer]>;
    readonly #weakRefInit: NativeFunction<void, [NativePointer, NativePointer]>;
    readonly #weakRefGet: NativeFunction<NativePointer, [NativePointer]>;
    readonly #weakRefClear: NativeFunction<void, [NativePointer]>;
    readonly #strlen: NativeFunction<UInt64, [NativePointer]>;
    #types: { bin: NativePointer; pipeline: NativePointer } | null = null;

    constructor(readonly library: Module) {
        const gst = (name: string) => library.getExportByName(name);
        const glib = (name: string) => library.findExportByName(name) ?? Module.getGlobalExportByName(name);
        this.setStateAddress = gst("gst_element_set_state");
        this.version = versionOf(new NativeFunction(gst("gst_version"), "void", ["pointer", "pointer", "pointer", "pointer"]));
        this.#binGetType = new NativeFunction(gst("gst_bin_get_type"), "pointer", []);
        this.#pipelineGetType = new NativeFunction(gst("gst_pipeline_get_type"), "pointer", []);
        this.#getState = new NativeFunction(gst("gst_element_get_state"), "int", ["pointer", "pointer", "pointer", "uint64"]);
        this.#getParent = new NativeFunction(gst("gst_object_get_parent"), "pointer", ["pointer"], exclusive);
        this.#getName = new NativeFunction(gst("gst_object_get_name"), "pointer", ["pointer"]);
        this.#binToDotData = new NativeFunction(gst("gst_debug_bin_to_dot_data"), "pointer", ["pointer", "uint"]);
        this.#childrenCount = new NativeFunction(gst("gst_child_proxy_get_children_count"), "uint", ["pointer"]);
        this.#childByIndex = new NativeFunction(gst("gst_child_proxy_get_child_by_index"), "pointer", ["pointer", "uint"]);
        this.#typeChildren = new NativeFunction(glib("g_type_children"), "pointer", ["pointer", "pointer"]);
        this.#typeClassPeek = new NativeFunction(glib("g_type_class_peek"), "pointer", ["pointer"]);
        this.#typeNameFromInstance = new NativeFunction(glib("g_type_name_from_instance"), "pointer", ["pointer"]);
        this.#instanceIsA = new NativeFunction(glib("g_type_check_instance_is_a"), "int", ["pointer", "pointer"], exclusive);
        this.#free = new NativeFunction(glib("g_free"), "void", ["pointer"]);
        this.#objectUnref = new NativeFunction(glib("g_object_unref"), "void", ["pointer"]);
        this.#weakRefInit = new NativeFunction(glib("g_weak_ref_init"), "void", ["pointer", "pointer"], exclusive);
        this.#weakRefGet = new NativeFunction(glib("g_weak_ref_get"), "pointer", ["pointer"], exclusive);
        this.#weakRefClear = new NativeFunction(glib("g_weak_ref_clear"), "void", ["pointer"], exclusive);
        this.#strlen = new NativeFunction(Module.getGlobalExportByName("strlen"), "size_t", ["pointer"]);
    }

    binClasses(): NativePointer[] {
        const classes: NativePointer[] = [];
        const visit = (type: NativePointer) => {
            const cls = this.#typeClassPeek(type);
            if (!cls.isNull()) {
                classes.push(cls);
            }
            this.#childTypesOf(type).forEach(visit);
        };
        visit(this.#binType);
        return classes;
    }

    withRootOf(element: NativePointer, use: (root: NativePointer) => void): void {
        let current = element;
        let held = false;
        for (let parent = this.#getParent(current); !parent.isNull(); parent = this.#getParent(current)) {
            if (held) {
                this.unref(current);
            }
            current = parent;
            held = true;
        }
        use(current);
        if (held) {
            this.unref(current);
        }
    }

    hasParent(object: NativePointer): boolean {
        const parent = this.#getParent(object);
        if (parent.isNull()) {
            return false;
        }
        this.unref(parent);
        return true;
    }

    isBin(object: NativePointer): boolean {
        return this.#instanceIsA(object, this.#binType) !== 0;
    }

    initWeakRef(weakRef: NativePointer, object: NativePointer): void {
        this.#weakRefInit(weakRef, object);
    }

    strongRefFrom(weakRef: NativePointer): NativePointer {
        return this.#weakRefGet(weakRef);
    }

    clearWeakRef(weakRef: NativePointer): void {
        this.#weakRefClear(weakRef);
    }

    unref(object: NativePointer): void {
        this.#objectUnref(object);
    }

    factsOf(bin: NativePointer): BinFacts {
        const [state, pending] = this.#statesOf(bin);
        return {
            name: this.#takeString(this.#getName(bin)),
            type: this.#typeNameFromInstance(bin).readUtf8String()!,
            isPipeline: this.#instanceIsA(bin, this.#pipelineType) !== 0,
            state,
            pending,
            elements: this.#elementCountOf(bin),
        };
    }

    dotOf(bin: NativePointer, detailFlags: number): ArrayBuffer {
        const text = this.#binToDotData(bin, detailFlags);
        const bytes = text.readByteArray(this.#strlen(text).toNumber())!;
        this.#free(text);
        return bytes;
    }

    get #binType(): NativePointer {
        return this.#knownTypes().bin;
    }

    get #pipelineType(): NativePointer {
        return this.#knownTypes().pipeline;
    }

    #knownTypes(): { bin: NativePointer; pipeline: NativePointer } {
        this.#types ??= { bin: this.#binGetType(), pipeline: this.#pipelineGetType() };
        return this.#types;
    }

    #childTypesOf(type: NativePointer): NativePointer[] {
        const count = Memory.alloc(4);
        const children = this.#typeChildren(type, count);
        const types = Array.from({ length: count.readU32() }, (_, i) => children.add(i * Process.pointerSize).readPointer());
        this.#free(children);
        return types;
    }

    #statesOf(element: NativePointer): [ElementState, ElementState] {
        const states = Memory.alloc(8);
        this.#getState(element, states, states.add(4), withoutWaiting);
        return [elementStates[states.readS32()], elementStates[states.add(4).readS32()]];
    }

    #elementCountOf(bin: NativePointer): number {
        let count = 0;
        const children = this.#childrenCount(bin);
        for (let i = 0; i !== children; i++) {
            const child = this.#childByIndex(bin, i);
            if (child.isNull()) {
                break;
            }
            count += 1 + (this.isBin(child) ? this.#elementCountOf(child) : 0);
            this.unref(child);
        }
        return count;
    }

    #takeString(text: NativePointer): string {
        const value = text.readUtf8String()!;
        this.#free(text);
        return value;
    }
}

function versionOf(gstVersion: NativeFunction<void, [NativePointer, NativePointer, NativePointer, NativePointer]>): string {
    const parts = Memory.alloc(16);
    gstVersion(parts, parts.add(4), parts.add(8), parts.add(12));
    const [major, minor, micro, nano] = [0, 4, 8, 12].map(offset => parts.add(offset).readU32());
    return (nano === 0) ? `${major}.${minor}.${micro}` : `${major}.${minor}.${micro}.${nano}`;
}
