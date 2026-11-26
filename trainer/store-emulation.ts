export interface StoreEmulation {
    pieces: StorePiece[];
    writeBack: RegisterUpdate | null;
}

export interface StorePiece {
    address: NativePointer;
    bytes: Uint8Array;
}

interface RegisterUpdate {
    register: string;
    value: NativePointer;
}

type MemoryOperand = Arm64MemOperand & { shift?: { type: string; value: number }; ext?: string };

const fixedSizes = new Map<string, number | null>([
    ["str", null], ["stur", null], ["stlr", null], ["stp", null], ["stnp", null],
    ["strb", 1], ["sturb", 1], ["stlrb", 1],
    ["strh", 2], ["sturh", 2], ["stlrh", 2],
]);

const vectorSize = 16;

const registerSizes = new Map([["w", 4], ["x", 8], ["b", 1], ["h", 2], ["s", 4], ["d", 8], ["q", 16]]);

export function emulationOf(code: NativePointer, context: Arm64CpuContext, vectors: NativePointer): StoreEmulation | null {
    const instruction = Instruction.parse(code) as Arm64Instruction;
    const fixedSize = fixedSizes.get(instruction.mnemonic);
    if (fixedSize === undefined) {
        return null;
    }
    const sources = instruction.operands.filter(operand => operand.type === "reg").map(operand => operand.value as string);
    const memory = instruction.operands.find(operand => operand.type === "mem") as MemoryOperand | undefined;
    const postIndex = instruction.operands.find(operand => operand.type === "imm");
    if (memory === undefined || memory.ext !== undefined || !sources.every(register => registerSizes.has(register[0]))) {
        return null;
    }
    const { base, index, disp } = memory.value;
    if (base === undefined || (index !== undefined && !index.startsWith("x"))) {
        return null;
    }
    const baseValue = registerValue(context, base);
    const offset = (index !== undefined) ? registerValue(context, index).shl(memory.shift?.value ?? 0) : ptr(0);
    const preIndex = instruction.toString().endsWith("!");
    const address = (postIndex !== undefined) ? baseValue : baseValue.add(offset).add(disp);
    let at = address;
    const pieces = sources.map(register => {
        const size = fixedSize ?? registerSizes.get(register[0])!;
        const piece = { address: at, bytes: registerBytes(context, vectors, register, size) };
        at = at.add(size);
        return piece;
    });
    const writeBack = preIndex
        ? { register: base, value: address }
        : (postIndex !== undefined) ? { register: base, value: baseValue.add(Number(postIndex.value)) } : null;
    return { pieces, writeBack };
}

export function applyRegisterUpdate(context: Arm64CpuContext, { register, value }: RegisterUpdate): void {
    (context as unknown as Record<string, NativePointer>)[contextName(register)] = value;
}

function registerValue(context: Arm64CpuContext, register: string): NativePointer {
    if (register === "xzr" || register === "wzr") {
        return ptr(0);
    }
    return (context as unknown as Record<string, NativePointer>)[contextName(register)];
}

function registerBytes(context: Arm64CpuContext, vectors: NativePointer, register: string, size: number): Uint8Array {
    const kind = register[0];
    if (kind === "w" || kind === "x") {
        const value = uint64(registerValue(context, register).toString());
        return Uint8Array.from({ length: size }, (_, i) => value.shr(8 * i).and(0xff).toNumber());
    }
    return new Uint8Array(vectors.add(vectorSize * Number(register.slice(1))).readByteArray(size)!);
}

function contextName(register: string): string {
    if (register === "sp" || register === "wsp") {
        return "sp";
    }
    const number = register.slice(1);
    if (number === "29") {
        return "fp";
    }
    if (number === "30") {
        return "lr";
    }
    return `x${number}`;
}
