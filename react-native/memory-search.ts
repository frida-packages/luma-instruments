import { AppleMemory } from "./apple-memory.js";

export interface PointerMatch {
    address: NativePointer;
    value: NativePointer;
}

interface Piece {
    base: NativePointer;
    copy: MemoryRange;
}

type Copier = (destination: NativePointer, source: NativePointer, size: number) => boolean;

const CHUNK_BYTES = 8 * 1048576;
const LONGEST_OVERLAP = Process.pageSize;
const SMALL_READ_BYTES = 4096;

export const appleMemory = (Process.platform === "darwin") ? new AppleMemory() : null;
const copyMemory: Copier = (appleMemory !== null) ? (...args) => appleMemory.copy(...args) : guardedCopy;
const staging = Memory.alloc(CHUNK_BYTES + LONGEST_OVERLAP);
const smallCopy = Memory.alloc(SMALL_READ_BYTES);

export class MemorySearch {
    readonly startedAt = Date.now();
    bytesSearched = 0;
    bytesUnreadable = 0;

    findPointers(range: MemoryRange, values: NativePointer[], mask: NativePointer): PointerMatch[] {
        return this.#search(range, 0, copy => Memory.findPointers(copy, values, { mask }));
    }

    scan(range: MemoryRange, pattern: string): NativePointer[] {
        const overlap = pattern.split(" ").length - 1;
        return this.#search(range, overlap, copy => Memory.scanSync(copy.base, copy.size, pattern)).map(match => match.address);
    }

    #search<T extends { address: NativePointer }>(range: MemoryRange, overlap: number, find: (copy: MemoryRange) => T[]): T[] {
        const found: T[] = [];
        for (let offset = 0; offset < range.size; offset += CHUNK_BYTES) {
            const base = range.base.add(offset);
            const ownedEnd = base.add(CHUNK_BYTES);
            for (const piece of this.#copied(base, Math.min(CHUNK_BYTES + overlap, range.size - offset))) {
                for (const match of find(piece.copy)) {
                    const address = piece.base.add(match.address.sub(piece.copy.base));
                    if (address.compare(ownedEnd) < 0) {
                        found.push({ ...match, address });
                    }
                }
            }
        }
        return found;
    }

    #copied(base: NativePointer, size: number): Piece[] {
        if (copyMemory(staging, base, size)) {
            this.bytesSearched += size;
            return [{ base, copy: { base: staging, size } }];
        }
        const pieces: Piece[] = [];
        let current: Piece | null = null;
        for (const page of pagesOf(base, size)) {
            const destination = staging.add(page.base.sub(base));
            if (!copyMemory(destination, page.base, page.size)) {
                this.bytesUnreadable += page.size;
                current = null;
                continue;
            }
            this.bytesSearched += page.size;
            if (current === null) {
                current = { base: page.base, copy: { base: destination, size: page.size } };
                pieces.push(current);
            } else {
                current.copy.size += page.size;
            }
        }
        return pieces;
    }
}

export function readMemory(address: NativePointer, size: number): ArrayBuffer | null {
    const copy = (size <= SMALL_READ_BYTES) ? smallCopy : Memory.alloc(size);
    return copyMemory(copy, address, size) ? copy.readByteArray(size) : null;
}

export function readPointer(address: NativePointer): NativePointer | null {
    return copyMemory(smallCopy, address, Process.pointerSize) ? smallCopy.readPointer() : null;
}

function* pagesOf(base: NativePointer, size: number): Generator<MemoryRange> {
    const end = base.add(size);
    for (let page = base; page.compare(end) < 0;) {
        const next = page.add(Process.pageSize).and(ptr(Process.pageSize - 1).not());
        const pageEnd = (next.compare(end) < 0) ? next : end;
        yield { base: page, size: Number(pageEnd.sub(page).toString()) };
        page = pageEnd;
    }
}

function guardedCopy(destination: NativePointer, source: NativePointer, size: number): boolean {
    try {
        Memory.copy(destination, source, size);
        return true;
    } catch (e) {
        return false;
    }
}
