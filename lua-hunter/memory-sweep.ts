export interface SweepResult {
    slots: NativePointer[];
    bytesScanned: number;
    durationMs: number;
}

const SLICE_BYTES = 32 * 1024 * 1024;
const POINTER_MASK = (Process.arch === "arm64") ? ptr("0x00007fffffffffff") : ptr("-1");
const findOptions = (Process.arch === "arm64") ? { mask: POINTER_MASK } : {};

export async function sweepWritableMemory(values: NativePointer[]): Promise<SweepResult> {
    const startedAt = Date.now();
    const slots: NativePointer[] = [];
    let bytesScanned = 0;
    for (const slice of slicesOf(Process.enumerateRanges("rw-"))) {
        slots.push(...findPointersIn(slice.ranges, values));
        bytesScanned += slice.size;
        await yieldToEventLoop();
    }
    return { slots, bytesScanned, durationMs: Date.now() - startedAt };
}

export function pointerKey(address: NativePointer): string {
    return address.and(POINTER_MASK).toString();
}

interface Slice {
    ranges: MemoryRange[];
    size: number;
}

function* slicesOf(ranges: RangeDetails[]): Generator<Slice> {
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

function findPointersIn(ranges: MemoryRange[], values: NativePointer[]): NativePointer[] {
    try {
        return Memory.findPointers(ranges, values, findOptions).map(match => match.address);
    } catch (e) {
        return ranges.flatMap(range => findPointersInRange(range, values));
    }
}

function findPointersInRange(range: MemoryRange, values: NativePointer[]): NativePointer[] {
    try {
        return Memory.findPointers(range, values, findOptions).map(match => match.address);
    } catch (e) {
        return [];
    }
}

export function yieldToEventLoop(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}
