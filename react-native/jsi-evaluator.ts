import { STD_STRING_SIZE, takeStdString } from "./cxx-strings.js";
import { indirectFunction } from "./indirect-calls.js";
import { JsiBuffer, JsiBufferVtable, JsiPointer, JsiPointerValue, JsiPointerValueVtable, JsiValue, SharedPointer } from "./jsi.pat";
import { type JsiSlots, slotFunction } from "./jsi-vtables.js";

export type Evaluation = { kind: "text"; text: string } | { kind: "refused"; reason: string };

const STRING_KINDS_WITH_AND_WITHOUT_BIGINT = new Set([5, 6]);
const FIRST_POINTER_KIND = 4;

export class JsiEvaluator {
    readonly #sources = new Map<string, NativePointer>();
    readonly #lengths = new Map<string, number>();
    readonly #size = new NativeCallback(buffer => this.#lengths.get(buffer.toString())!, "size_t", ["pointer"]);
    readonly #data = new NativeCallback(buffer => this.#sources.get(buffer.toString())!, "pointer", ["pointer"]);
    readonly #ignore = new NativeCallback(() => {}, "void", ["pointer"]);
    readonly #bufferVtable = JsiBufferVtable.at(Memory.alloc(JsiBufferVtable.size));
    readonly #emptyString = Memory.alloc(STD_STRING_SIZE);

    constructor() {
        this.#bufferVtable.destructor = this.#ignore;
        this.#bufferVtable.deletingDestructor = this.#ignore;
        this.#bufferVtable.size = this.#size;
        this.#bufferVtable.data = this.#data;
    }

    evaluate(runtime: NativePointer, slots: JsiSlots, source: string): Evaluation {
        const vtable = runtime.readPointer();
        const evaluateJavaScript = indirectFunction(slotFunction(vtable, slots.evaluateJavaScript), 3);
        const utf8 = indirectFunction(slotFunction(vtable, slots.utf8), 2);
        const value = JsiValue.at(Memory.alloc(JsiValue.size));
        const buffer = this.#bufferHolding(source);
        const shared = SharedPointer.at(Memory.alloc(SharedPointer.size));
        shared.pointer = buffer.$address;
        try {
            evaluateJavaScript(value.$address, runtime, shared.$address, this.#emptyString);
        } finally {
            this.#forget(buffer);
        }
        if (!STRING_KINDS_WITH_AND_WITHOUT_BIGINT.has(value.kind)) {
            release(value);
            return { kind: "refused", reason: `the runtime answered a value of kind ${value.kind} instead of a string` };
        }
        const string = JsiPointer.at(Memory.alloc(JsiPointer.size));
        string.value = value.pointer;
        const text = Memory.alloc(STD_STRING_SIZE);
        utf8(text, runtime, string.$address);
        release(value);
        return { kind: "text", text: takeStdString(text) };
    }

    #bufferHolding(source: string): JsiBuffer {
        const buffer = JsiBuffer.at(Memory.alloc(JsiBuffer.size));
        buffer.vtable = this.#bufferVtable.$address;
        const bytes = Memory.allocUtf8String(source);
        const key = buffer.$address.toString();
        this.#sources.set(key, bytes);
        this.#lengths.set(key, utf8Length(source));
        return buffer;
    }

    #forget(buffer: JsiBuffer): void {
        const key = buffer.$address.toString();
        this.#sources.delete(key);
        this.#lengths.delete(key);
    }
}

function release(value: JsiValue): void {
    if (value.kind < FIRST_POINTER_KIND) {
        return;
    }
    const pointerValue = JsiPointerValue.at(value.pointer);
    const invalidate = new NativeFunction(JsiPointerValueVtable.at(pointerValue.vtable).invalidate, "void", ["pointer"]);
    invalidate(pointerValue.$address);
}

function utf8Length(text: string): number {
    let length = 0;
    for (const character of text) {
        const code = character.codePointAt(0)!;
        length += (code < 0x80) ? 1 : (code < 0x800) ? 2 : (code < 0x10000) ? 3 : 4;
    }
    return length;
}
