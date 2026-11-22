export type ComFunction = NativeFunction<any, any[]>;

const IUNKNOWN_QUERY_INTERFACE = 0;
const IUNKNOWN_ADD_REF = 1;
const IUNKNOWN_RELEASE = 2;

export const comCalls: NativeFunctionOptions = {
    abi: (Process.arch === "ia32") ? "stdcall" : "default",
    exceptions: "propagate",
};

const functions = new Map<string, ComFunction>();

export function queryInterface(object: NativePointer, iid: NativePointer): NativePointer | null {
    const out = Memory.alloc(Process.pointerSize);
    const result = comMethod(object, IUNKNOWN_QUERY_INTERFACE, "int", ["pointer", "pointer"])(object, iid, out);
    return succeeded(result) ? out.readPointer() : null;
}

export function addRef(object: NativePointer): number {
    return comMethod(object, IUNKNOWN_ADD_REF, "uint32", [])(object);
}

export function release(object: NativePointer): number {
    return comMethod(object, IUNKNOWN_RELEASE, "uint32", [])(object);
}

export function comMethod(object: NativePointer, slot: number, returnType: NativeFunctionReturnType,
    argumentTypes: NativeFunctionArgumentType[]): ComFunction {
    const address = methodAddress(object, slot);
    const key = `${address}:${returnType}:${argumentTypes.join(",")}`;
    let method = functions.get(key);
    if (method === undefined) {
        method = new NativeFunction(address, returnType, ["pointer", ...argumentTypes], comCalls) as ComFunction;
        functions.set(key, method);
    }
    return method;
}

export function methodAddress(object: NativePointer, slot: number): NativePointer {
    return object.readPointer().add(slot * Process.pointerSize).readPointer();
}

export function succeeded(result: number): boolean {
    return result >= 0;
}

export function guid(text: string): NativePointer {
    const hex = text.replace(/-/g, "");
    const bytes = Memory.alloc(16);
    bytes.writeU32(parseInt(hex.slice(0, 8), 16));
    bytes.add(4).writeU16(parseInt(hex.slice(8, 12), 16));
    bytes.add(6).writeU16(parseInt(hex.slice(12, 16), 16));
    for (let i = 0; i !== 8; i++) {
        bytes.add(8 + i).writeU8(parseInt(hex.slice(16 + i * 2, 18 + i * 2), 16));
    }
    return bytes;
}
