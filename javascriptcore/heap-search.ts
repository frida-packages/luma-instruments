import { AppleMemory } from "./apple-memory.js";

export interface PointerMatch {
    address: NativePointer;
    value: NativePointer;
}

export const POINTER_MASK = ptr("0x00007fffffffffff");

const CHUNK_BYTES = 8 * 1048576;

const memory = new AppleMemory();
const staging = Memory.alloc(CHUNK_BYTES);
const smallCopy = Memory.alloc(Process.pointerSize);

export class HeapSearch {
    readonly startedAt = Date.now();
    bytesSearched = 0;
    bytesUnreadable = 0;
    readonly #timeLimitMs: number;

    constructor(timeLimitMs: number) {
        this.#timeLimitMs = timeLimitMs;
    }

    get timedOut(): boolean {
        return Date.now() - this.startedAt >= this.#timeLimitMs;
    }

    get timeLimitMs(): number {
        return this.#timeLimitMs;
    }

    async findPointers(values: NativePointer[]): Promise<PointerMatch[]> {
        const found: PointerMatch[] = [];
        for (const region of memory.heapRegions()) {
            for (let offset = 0; offset < region.size && !this.timedOut; offset += CHUNK_BYTES) {
                const size = Math.min(CHUNK_BYTES, region.size - offset);
                found.push(...this.#searchChunk(region.base.add(offset), size, values));
                await yieldToEventLoop();
            }
        }
        return found;
    }

    #searchChunk(base: NativePointer, size: number, values: NativePointer[]): PointerMatch[] {
        if (memory.copy(staging, base, size)) {
            this.bytesSearched += size;
            return matchesIn(base, staging, size, values);
        }
        const found: PointerMatch[] = [];
        for (let offset = 0; offset < size; offset += Process.pageSize) {
            const page = base.add(offset);
            const pageSize = Math.min(Process.pageSize, size - offset);
            if (memory.copy(staging, page, pageSize)) {
                this.bytesSearched += pageSize;
                found.push(...matchesIn(page, staging, pageSize, values));
            } else {
                this.bytesUnreadable += pageSize;
            }
        }
        return found;
    }
}

export function copyOf(address: NativePointer, size: number): NativePointer | null {
    const copy = Memory.alloc(size);
    return memory.copy(copy, address, size) ? copy : null;
}

export function readPointer(address: NativePointer): NativePointer | null {
    return memory.copy(smallCopy, address, Process.pointerSize) ? smallCopy.readPointer() : null;
}

export function readU32(address: NativePointer): number | null {
    return memory.copy(smallCopy, address, 4) ? smallCopy.readU32() : null;
}

function matchesIn(base: NativePointer, copy: NativePointer, size: number, values: NativePointer[]): PointerMatch[] {
    return Memory.findPointers({ base: copy, size }, values, { mask: POINTER_MASK })
        .map(match => ({ address: base.add(match.address.sub(copy)), value: match.value }));
}

function yieldToEventLoop(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}
