interface BridgeInternals {
    read(pointer: NativePointer, type: Il2Cpp.Type): Il2Cpp.Field.Type;
}

interface MethodInternals {
    nativeSignatureHasInstanceSlot: boolean;
}

export function readValue(pointer: NativePointer, type: Il2Cpp.Type): Il2Cpp.Field.Type {
    return (Il2Cpp as unknown as BridgeInternals).read(pointer, type);
}

export function hasInstanceSlot(method: Il2Cpp.Method): boolean {
    return (method as unknown as MethodInternals).nativeSignatureHasInstanceSlot;
}
