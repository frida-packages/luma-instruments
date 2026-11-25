export type IndirectFunction = (result: NativePointer, ...args: NativePointer[]) => void;

type Trampoline = NativeFunction<void, NativePointer[]>;

const TRAMPOLINE_BYTES = 64;
const trampolines = new Map<number, Trampoline>();
const trampolinePages: NativePointer[] = [];

export function indirectFunction(target: NativePointer, argumentCount: number): IndirectFunction {
    if (Process.arch === "arm64") {
        const trampoline = arm64Trampoline(argumentCount);
        return (result, ...args) => {
            trampoline(target, result, ...args);
        };
    }
    const call = new NativeFunction(target, "void", pointerTypes(argumentCount + 1)) as Trampoline;
    return (result, ...args) => {
        call(result, ...args);
    };
}

function arm64Trampoline(argumentCount: number): Trampoline {
    let trampoline = trampolines.get(argumentCount);
    if (trampoline === undefined) {
        trampoline = new NativeFunction(writeArm64Trampoline(argumentCount), "void", pointerTypes(argumentCount + 2)) as Trampoline;
        trampolines.set(argumentCount, trampoline);
    }
    return trampoline;
}

function writeArm64Trampoline(argumentCount: number): NativePointer {
    const code = Memory.alloc(Process.pageSize);
    trampolinePages.push(code);
    Memory.patchCode(code, TRAMPOLINE_BYTES, writable => {
        const writer = new Arm64Writer(writable, { pc: code });
        writer.putMovRegReg("x16", "x0");
        writer.putMovRegReg("x8", "x1");
        for (let i = 0; i !== argumentCount; i++) {
            writer.putMovRegReg(`x${i}` as Arm64Register, `x${i + 2}` as Arm64Register);
        }
        writer.putBrReg("x16");
        writer.flush();
    });
    return code;
}

function pointerTypes(count: number): "pointer"[] {
    return Array.from({ length: count }, () => "pointer" as const);
}
