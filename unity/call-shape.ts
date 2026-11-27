import { hasInstanceSlot, readValue } from "./bridge-internals.js";
import type { ValueText } from "./value-text.js";

type Slot =
    | { kind: "integer"; register: number }
    | { kind: "vector"; register: number; count: number; size: number }
    | { kind: "pair"; register: number; count: number }
    | { kind: "indirect"; register: number }
    | { kind: "stack"; offset: number; indirect: boolean }
    | { kind: "unknown" };

type ResultSlot = Slot | { kind: "void" } | { kind: "indirect-result" };

type ArgumentClass =
    | { kind: "integer" }
    | { kind: "vector"; count: number; size: number }
    | { kind: "pair"; count: number }
    | { kind: "indirect" }
    | { kind: "reference" };

interface Layout {
    argumentClass: ArgumentClass;
    size: number;
    alignment: number;
    isFloat?: boolean;
}

interface Parameter {
    name: string;
    type: Il2Cpp.Type;
    slot: Slot;
}

const REGISTERS = 8;
const LARGEST_PAIR = 16;
const LARGEST_HFA = 4;
const INDIRECT_LAYOUT: Layout = { argumentClass: { kind: "indirect" }, size: 8, alignment: 8 };
const REFERENCE_LAYOUT: Layout = { argumentClass: { kind: "reference" }, size: 8, alignment: 8 };

export class CallShape {
    readonly #parameters: Parameter[];
    readonly #result: ResultSlot;
    readonly #returnType: Il2Cpp.Type;

    constructor(method: Il2Cpp.Method) {
        const receiver = method.class;
        const declared = method.parameters.map(each => ({ name: each.name, type: each.type, layout: layoutOf(each.type) }));
        const all = hasInstanceSlot(method)
            ? [{ name: "this", type: receiver.type, layout: receiver.isValueType ? REFERENCE_LAYOUT : layoutOf(receiver.type) }, ...declared]
            : declared;
        const layouts = all.map(each => each.layout);
        const slots = (Process.arch === "arm64") ? arm64Slots(layouts) : integerSlots(layouts);
        this.#parameters = all.map(({ name, type }, i) => ({ name, type, slot: slots[i] }));
        this.#returnType = method.returnType;
        this.#result = resultSlotOf(method.returnType);
    }

    resultPointerAt(context: CpuContext): NativePointer {
        return (this.#result.kind === "indirect-result") ? (context as Arm64CpuContext).x8 : NULL;
    }

    describeArguments(context: CpuContext, args: InvocationArguments, values: ValueText): string {
        return this.#parameters.map(({ name, type, slot }) => {
            const value = valueAt(slot, type, context, register => args[register]);
            return `${name} = ${(value === null) ? "?" : values.of(value, type)}`;
        }).join(", ");
    }

    describeResult(context: CpuContext, retval: InvocationReturnValue, resultPointer: NativePointer, values: ValueText): string {
        const result = this.#result;
        if (result.kind === "void") {
            return "";
        }
        if (result.kind === "indirect-result") {
            return values.of(readValue(resultPointer, this.#returnType), this.#returnType);
        }
        const arm64 = context as Arm64CpuContext;
        const value = valueAt(result, this.#returnType, context, register => (register === 0) ? retval : arm64.x1);
        return (value === null) ? "?" : values.of(value, this.#returnType);
    }
}

function layoutOf(type: Il2Cpp.Type): Layout {
    const klass = type.class;
    if (type.isByReference || !klass.isValueType) {
        return { argumentClass: { kind: "integer" }, size: 8, alignment: 8 };
    }
    const floatSize = floatSizeOf(type);
    if (floatSize !== 0) {
        return { argumentClass: { kind: "vector", count: 1, size: floatSize }, size: floatSize, alignment: floatSize, isFloat: true };
    }
    const size = klass.valueTypeSize;
    if (klass.isEnum || type.isPrimitive) {
        return { argumentClass: { kind: "integer" }, size, alignment: size };
    }
    const leaves = floatLeavesOf(klass);
    if (leaves.length !== 0 && leaves.length <= LARGEST_HFA && leaves.every(each => each !== 0 && each === leaves[0])) {
        return { argumentClass: { kind: "vector", count: leaves.length, size: leaves[0] }, size, alignment: leaves[0] };
    }
    if (size > LARGEST_PAIR) {
        return INDIRECT_LAYOUT;
    }
    return { argumentClass: { kind: "pair", count: Math.max(1, Math.ceil(size / 8)) }, size, alignment: alignmentOf(klass) };
}

function floatSizeOf(type: Il2Cpp.Type): number {
    switch (type.name) {
        case "System.Single":
            return 4;
        case "System.Double":
            return 8;
        default:
            return 0;
    }
}

function floatLeavesOf(klass: Il2Cpp.Class): number[] {
    return instanceFieldsOf(klass).flatMap(field => {
        const size = floatSizeOf(field.type);
        if (size !== 0) {
            return [size];
        }
        return isStruct(field.type) ? floatLeavesOf(field.type.class) : [0];
    });
}

function instanceFieldsOf(klass: Il2Cpp.Class): Il2Cpp.Field[] {
    return klass.fields.filter(field => !field.isStatic);
}

function isStruct(type: Il2Cpp.Type): boolean {
    const klass = type.class;
    return !type.isByReference && klass.isValueType && !klass.isEnum && !type.isPrimitive;
}

function alignmentOf(klass: Il2Cpp.Class): number {
    return instanceFieldsOf(klass).reduce((largest, field) => {
        const type = field.type;
        if (type.isByReference || !type.class.isValueType) {
            return 8;
        }
        return Math.max(largest, isStruct(type) ? alignmentOf(type.class) : type.class.valueTypeSize);
    }, 1);
}

function arm64Slots(layouts: Layout[]): Slot[] {
    const packed = Process.platform === "darwin";
    let general = 0;
    let vector = 0;
    let stack = 0;
    const onStack = (layout: Layout): Slot => {
        const indirect = layout.argumentClass.kind === "indirect" || layout.argumentClass.kind === "reference";
        const size = indirect ? 8 : layout.size;
        stack = roundUp(stack, packed ? layout.alignment : Math.max(8, layout.alignment));
        const slot: Slot = { kind: "stack", offset: stack, indirect };
        stack += packed ? size : roundUp(size, 8);
        return slot;
    };
    return layouts.map((layout): Slot => {
        const argumentClass = layout.argumentClass;
        switch (argumentClass.kind) {
            case "integer":
                return (general < REGISTERS) ? { kind: "integer", register: general++ } : onStack(layout);
            case "indirect":
            case "reference":
                return (general < REGISTERS) ? { kind: "indirect", register: general++ } : onStack(layout);
            case "vector":
                if (vector + argumentClass.count > REGISTERS) {
                    vector = REGISTERS;
                    return onStack(layout);
                }
                vector += argumentClass.count;
                return { kind: "vector", register: vector - argumentClass.count, count: argumentClass.count, size: argumentClass.size };
            case "pair":
                if (general + argumentClass.count > REGISTERS) {
                    general = REGISTERS;
                    return onStack(layout);
                }
                general += argumentClass.count;
                return { kind: "pair", register: general - argumentClass.count, count: argumentClass.count };
        }
    });
}

function roundUp(value: number, alignment: number): number {
    return Math.ceil(value / alignment) * alignment;
}

function integerSlots(layouts: Layout[]): Slot[] {
    return (Process.platform === "windows") ? windowsSlots(layouts) : systemVSlots(layouts);
}

function windowsSlots(layouts: Layout[]): Slot[] {
    return layouts.map(({ argumentClass, size, isFloat }, register): Slot => {
        if (isFloat === true) {
            return { kind: "unknown" };
        }
        switch (argumentClass.kind) {
            case "integer":
                return { kind: "integer", register };
            case "reference":
                return { kind: "indirect", register };
            default:
                return [1, 2, 4, 8].includes(size) ? { kind: "pair", register, count: 1 } : { kind: "indirect", register };
        }
    });
}

function systemVSlots(layouts: Layout[]): Slot[] {
    let integers = 0;
    let lost = false;
    return layouts.map(({ argumentClass }): Slot => {
        switch (argumentClass.kind) {
            case "integer":
                return lost ? { kind: "unknown" } : { kind: "integer", register: integers++ };
            case "reference":
                return lost ? { kind: "unknown" } : { kind: "indirect", register: integers++ };
            case "vector":
                return { kind: "unknown" };
            default:
                lost = true;
                return { kind: "unknown" };
        }
    });
}

function resultSlotOf(type: Il2Cpp.Type): ResultSlot {
    if (type.name === "System.Void") {
        return { kind: "void" };
    }
    const { argumentClass } = layoutOf(type);
    if (Process.arch !== "arm64") {
        return (argumentClass.kind === "integer") ? { kind: "integer", register: 0 } : { kind: "unknown" };
    }
    switch (argumentClass.kind) {
        case "integer":
            return { kind: "integer", register: 0 };
        case "vector":
            return { kind: "vector", register: 0, count: argumentClass.count, size: argumentClass.size };
        case "pair":
            return { kind: "pair", register: 0, count: argumentClass.count };
        case "indirect":
        case "reference":
            return { kind: "indirect-result" };
    }
}

function valueAt(slot: Slot, type: Il2Cpp.Type, context: CpuContext, general: (register: number) => NativePointer): Il2Cpp.Field.Type | null {
    switch (slot.kind) {
        case "integer":
            return type.isByReference ? general(slot.register) : readValue(Memory.alloc(Process.pointerSize).writePointer(general(slot.register)), type);
        case "vector": {
            const bytes = Memory.alloc(slot.count * slot.size);
            for (let i = 0; i !== slot.count; i++) {
                bytes.add(i * slot.size).writeByteArray(vectorRegisterOf(context, slot.register + i).slice(0, slot.size));
            }
            return readValue(bytes, type);
        }
        case "pair": {
            const bytes = Memory.alloc(slot.count * 8);
            for (let i = 0; i !== slot.count; i++) {
                bytes.add(i * 8).writePointer(general(slot.register + i));
            }
            return readValue(bytes, type);
        }
        case "indirect":
            return readValue(general(slot.register), type);
        case "stack": {
            const at = context.sp.add(slot.offset);
            if (type.isByReference) {
                return at.readPointer();
            }
            return readValue(slot.indirect ? at.readPointer() : at, type);
        }
        case "unknown":
            return null;
    }
}

function vectorRegisterOf(context: CpuContext, register: number): ArrayBuffer {
    const { q0, q1, q2, q3, q4, q5, q6, q7 } = context as Arm64CpuContext;
    return [q0, q1, q2, q3, q4, q5, q6, q7][register];
}
