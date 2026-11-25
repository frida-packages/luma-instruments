export interface EngineFacts {
    revision: string | null;
    dartVersion: string | null;
    snapshotHash: string | null;
}

const DART_VERSION_TAIL = "29 20 6f 6e 20 22";
const DART_VERSION = /^\d+\.\d+\.\d+\S* \(\w+\) \(.+\) on "\w+"$/;
const LONGEST_DART_VERSION = 160;
const SNAPSHOT_HASH = /^[0-9a-f]{32}$/;
const SNAPSHOT_HASH_LENGTH = 32;
const REVISION_LENGTH = 40;
const REVISION = /^[0-9a-f]{40}$/;
const NUL = 0;

export function readEngineFacts(engine: Module): EngineFacts {
    const ranges = engine.enumerateRanges("r--");
    const version = dartVersionIn(ranges);
    return {
        revision: revisionIn(ranges),
        dartVersion: version?.text ?? null,
        snapshotHash: (version !== null) ? snapshotHashBefore(version.start) : null,
    };
}

interface FoundString {
    text: string;
    start: NativePointer;
}

function dartVersionIn(ranges: RangeDetails[]): FoundString | null {
    for (const range of ranges) {
        for (const match of Memory.scanSync(range.base, range.size, DART_VERSION_TAIL)) {
            const found = enclosingString(match.address, range);
            if (found !== null && DART_VERSION.test(found.text)) {
                return found;
            }
        }
    }
    return null;
}

function enclosingString(inside: NativePointer, range: RangeDetails): FoundString | null {
    const reach = Math.min(LONGEST_DART_VERSION, inside.sub(range.base).toUInt32());
    const before = new Uint8Array(inside.sub(reach).readByteArray(reach)!);
    const nul = before.lastIndexOf(NUL);
    if (nul === -1) {
        return null;
    }
    const start = inside.sub(reach - nul - 1);
    return { text: start.readCString()!, start };
}

function revisionIn(ranges: RangeDetails[]): string | null {
    const pattern = ["00", ...Array(REVISION_LENGTH).fill("??"), "00"].join(" ");
    for (const range of ranges) {
        for (const match of Memory.scanSync(range.base, range.size, pattern)) {
            const text = match.address.add(1).readCString(REVISION_LENGTH)!;
            if (REVISION.test(text)) {
                return text;
            }
        }
    }
    return null;
}

function snapshotHashBefore(versionStart: NativePointer): string | null {
    const candidate = versionStart.sub(SNAPSHOT_HASH_LENGTH + 1);
    const bytes = new Uint8Array(candidate.sub(1).readByteArray(SNAPSHOT_HASH_LENGTH + 2)!);
    const delimited = bytes[0] === NUL && bytes[SNAPSHOT_HASH_LENGTH + 1] === NUL;
    const text = String.fromCharCode(...bytes.subarray(1, SNAPSHOT_HASH_LENGTH + 1));
    return (delimited && SNAPSHOT_HASH.test(text)) ? text : null;
}
