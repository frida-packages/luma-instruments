export interface InstanceSearch {
    instances: { address: NativePointer; vtable: NativePointer }[];
    bytesSearched: number;
    durationMs: number;
}

const SLICE_BYTES = 32 * 1048576;
const ADJACENT_GAP_BYTES = 4096;
const POINTER_MASK = (Process.arch === "arm64") ? ptr("0x00007fffffffffff") : ptr("-1");
const findOptions = (Process.arch === "arm64") ? { mask: POINTER_MASK } : {};

export async function findInstances(vtables: NativePointer[]): Promise<InstanceSearch> {
    const startedAt = Date.now();
    const instances: InstanceSearch["instances"] = [];
    let bytesSearched = 0;
    if (vtables.length !== 0) {
        for (const slice of slicesOf(heapRanges())) {
            for (const match of findPointersIn(slice.ranges, vtables)) {
                instances.push({ address: match.address, vtable: vtableMatching(vtables, match.address) });
            }
            bytesSearched += slice.size;
            await yieldToEventLoop();
        }
    }
    return { instances, bytesSearched, durationMs: Date.now() - startedAt };
}

export function pointerKey(address: NativePointer): string {
    return address.and(POINTER_MASK).toString();
}

export function heapRanges(): MemoryRange[] {
    if (Process.platform === "darwin") {
        return coalesced(Process.enumerateMallocRanges());
    }
    return Process.enumerateRanges("rw-").filter(range => range.file === undefined).map(({ base, size }) => ({ base, size }));
}

function coalesced(ranges: MemoryRange[]): MemoryRange[] {
    const sorted = [...ranges].sort((a, b) => a.base.compare(b.base));
    const merged: MemoryRange[] = [];
    for (const range of sorted) {
        const last = merged[merged.length - 1];
        if (last !== undefined && last.base.add(last.size + ADJACENT_GAP_BYTES).compare(range.base) >= 0) {
            const end = range.base.add(range.size);
            if (end.compare(last.base.add(last.size)) > 0) {
                last.size = Number(end.sub(last.base).toString());
            }
        } else {
            merged.push({ base: range.base, size: range.size });
        }
    }
    return merged;
}

interface Slice {
    ranges: MemoryRange[];
    size: number;
}

function* slicesOf(ranges: MemoryRange[]): Generator<Slice> {
    let slice: Slice = { ranges: [], size: 0 };
    for (const range of ranges) {
        for (let offset = 0; offset < range.size; offset += SLICE_BYTES) {
            const size = Math.min(SLICE_BYTES, range.size - offset);
            slice.ranges.push({ base: range.base.add(offset), size });
            slice.size += size;
            if (slice.size >= SLICE_BYTES) {
                yield slice;
                slice = { ranges: [], size: 0 };
            }
        }
    }
    if (slice.ranges.length !== 0) {
        yield slice;
    }
}

function findPointersIn(ranges: MemoryRange[], vtables: NativePointer[]): MemoryPointerMatch[] {
    try {
        return Memory.findPointers(ranges, vtables, findOptions);
    } catch (e) {
        return ranges.flatMap(range => findPointersInRange(range, vtables));
    }
}

function findPointersInRange(range: MemoryRange, vtables: NativePointer[]): MemoryPointerMatch[] {
    try {
        return Memory.findPointers(range, vtables, findOptions);
    } catch (e) {
        return [];
    }
}

function vtableMatching(vtables: NativePointer[], address: NativePointer): NativePointer {
    const value = address.readPointer().and(POINTER_MASK);
    return vtables.find(vtable => vtable.and(POINTER_MASK).equals(value))!;
}

function yieldToEventLoop(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}
