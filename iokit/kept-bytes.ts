export interface TruncatedData {
    bytes: ArrayBuffer;
    length: number;
}

export type KeptBytes = ArrayBuffer | TruncatedData;

export function keepBytes(address: NativePointer, length: number, limit: number): KeptBytes {
    const kept = Math.min(length, limit);
    const bytes = (kept === 0) ? new ArrayBuffer(0) : address.readByteArray(kept)!;
    return (kept === length) ? bytes : { bytes, length };
}

export function lengthOf(bytes: KeptBytes): number {
    return (bytes instanceof ArrayBuffer) ? bytes.byteLength : bytes.length;
}

export function isTruncatedData(value: unknown): value is TruncatedData {
    return typeof value === "object" && value !== null && (value as Partial<TruncatedData>).bytes instanceof ArrayBuffer;
}
