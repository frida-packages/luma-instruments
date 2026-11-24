const pointerSize = Process.pointerSize;
const refCountOffset = pointerSize;
const objectHeaderSize = 3 * pointerSize;
const mutexSize = 8;
const nameOffset = objectHeaderSize + mutexSize;
const parentOffset = nameOffset + pointerSize;
const mostPlausibleReferences = 1_000_000;
const longestPlausibleName = 256;
const controlCharacter = /[\u0000-\u001f\u007f]/;

export function isLiveTopLevelBin(candidate: NativePointer, classes: Set<string>): boolean {
    try {
        return classes.has(candidate.readPointer().toString())
            && hasPlausibleReferenceCount(candidate)
            && candidate.add(parentOffset).readPointer().isNull()
            && isPlausibleName(candidate.add(nameOffset).readPointer());
    } catch (error) {
        if (isAccessViolation(error)) {
            return false;
        }
        throw error;
    }
}

function hasPlausibleReferenceCount(candidate: NativePointer): boolean {
    const references = candidate.add(refCountOffset).readU32();
    return references > 0 && references <= mostPlausibleReferences;
}

function isPlausibleName(name: NativePointer): boolean {
    if (name.isNull()) {
        return false;
    }
    const text = terminatedTextAt(name);
    return text !== null && text.length > 0 && !controlCharacter.test(text);
}

function terminatedTextAt(start: NativePointer): string | null {
    let text = "";
    let cursor = start;
    while (text.length < longestPlausibleName) {
        const toPageEnd = Process.pageSize - cursor.and(Process.pageSize - 1).toUInt32();
        const bytes = new Uint8Array(cursor.readByteArray(Math.min(toPageEnd, longestPlausibleName - text.length))!);
        const end = bytes.indexOf(0);
        text += String.fromCharCode(...((end === -1) ? bytes : bytes.subarray(0, end)));
        if (end !== -1) {
            return text;
        }
        cursor = cursor.add(bytes.length);
    }
    return null;
}

function isAccessViolation(error: unknown): boolean {
    return error instanceof Error && error.message.startsWith("access violation");
}
