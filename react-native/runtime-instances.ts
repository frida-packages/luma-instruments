import { appleMemory, type MemorySearch, type PointerMatch } from "./memory-search.js";

export interface Instance {
    address: NativePointer;
    vtable: NativePointer;
}

const SLICE_BYTES = 32 * 1048576;
const POINTER_MASK = (Process.arch === "arm64") ? ptr("0x00007fffffffffff") : ptr("-1");

export async function findInstances(vtables: NativePointer[], search: MemorySearch): Promise<Instance[]> {
    if (vtables.length === 0) {
        return [];
    }
    const instances: Instance[] = [];
    for (const match of await searchHeap(search, vtables, POINTER_MASK)) {
        instances.push({ address: match.address, vtable: vtableMatching(vtables, match.value) });
    }
    return instances;
}

export async function searchHeap(search: MemorySearch, values: NativePointer[], mask: NativePointer): Promise<PointerMatch[]> {
    const matches: PointerMatch[] = [];
    for (const slice of slicesOf(heapRanges())) {
        for (const range of slice) {
            matches.push(...search.findPointers(range, values, mask));
        }
        await yieldToEventLoop();
    }
    return matches;
}

export function pointerKey(address: NativePointer): string {
    return address.and(POINTER_MASK).toString();
}

function heapRanges(): MemoryRange[] {
    if (appleMemory !== null) {
        return appleMemory.mallocRegions();
    }
    return Process.enumerateRanges("rw-").filter(range => range.file === undefined).map(({ base, size }) => ({ base, size }));
}

function* slicesOf(ranges: MemoryRange[]): Generator<MemoryRange[]> {
    let slice: MemoryRange[] = [];
    let sliceSize = 0;
    for (const range of ranges) {
        for (let offset = 0; offset < range.size; offset += SLICE_BYTES) {
            const size = Math.min(SLICE_BYTES, range.size - offset);
            slice.push({ base: range.base.add(offset), size });
            sliceSize += size;
            if (sliceSize >= SLICE_BYTES) {
                yield slice;
                slice = [];
                sliceSize = 0;
            }
        }
    }
    if (slice.length !== 0) {
        yield slice;
    }
}

function vtableMatching(vtables: NativePointer[], value: NativePointer): NativePointer {
    const masked = value.and(POINTER_MASK);
    return vtables.find(vtable => vtable.and(POINTER_MASK).equals(masked))!;
}

function yieldToEventLoop(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}
