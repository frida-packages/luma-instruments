import { Residency, scannablePieces, type Piece, type Run } from "./address-space.js";
import type { Job } from "./job.js";
import { maskedBitsOf, type MaskedBits, type TypeTarget } from "./value-query.js";
import type { ValueType } from "./value-types.js";

export type Alignment = "aligned" | "unaligned";

export interface OffsetBlock {
    piece: Piece;
    type: ValueType;
    offsets: Uint32Array;
}

export interface ScanSummary {
    blocks: OffsetBlock[];
    scannedBytes: number;
}

export class TooManyMatches extends Error {
}

export const matchLimit = 5_000_000;

const hitsPerSlice = 262_144;
const initialSliceBytes = 4 * 1024 * 1024;
const smallestSliceBytes = 1024 * 1024;
const largestSliceBytes = 128 * 1024 * 1024;

export async function scanMemory(targets: TypeTarget[], alignment: Alignment, job: Job): Promise<ScanSummary> {
    const residency = new Residency();
    const runs = scannablePieces().flatMap(piece => residency.runsOf(piece));
    const totalBytes = runs.reduce((sum, run) => sum + run.size, 0);
    const searches = targets.map(target => searchFor(target, alignment));
    const collector = new OffsetCollector();

    let scannedBytes = 0;
    let sliceBytes = initialSliceBytes;
    for (const slice of slicesOf(runs, () => sliceBytes)) {
        for (const search of searches) {
            search.scan(slice, collector);
        }
        if (collector.hitCount > matchLimit) {
            throw new TooManyMatches();
        }
        scannedBytes += slice.byteCount;
        sliceBytes = nextSliceBytes(scannedBytes, collector.hitCount);
        await job.checkpoint("scanning", scannedBytes / totalBytes);
    }
    return { blocks: collector.blocks(), scannedBytes };
}

interface Search {
    scan(slice: Slice, collector: OffsetCollector): void;
}

function searchFor(target: TypeTarget, alignment: Alignment): Search {
    const bits = maskedBitsOf(target);
    if (alignment === "aligned" && target.type.size <= Process.pointerSize) {
        return new WordSearch(target.type, bits);
    }
    return new BytePatternSearch(target.type, bits);
}

class WordSearch implements Search {
    readonly #type: ValueType;
    readonly #lanes: { byteOffset: number; values: NativePointer[]; mask: NativePointer }[] = [];

    constructor(type: ValueType, bits: MaskedBits[]) {
        this.#type = type;
        const laneCount = Process.pointerSize / type.size;
        for (let lane = 0; lane !== laneCount; lane++) {
            const shift = BigInt(lane * type.size * 8);
            for (const { values, mask } of bits) {
                this.#lanes.push({
                    byteOffset: lane * type.size,
                    values: values.map(value => pointerFrom(value << shift)),
                    mask: pointerFrom(mask << shift),
                });
            }
        }
    }

    scan(slice: Slice, collector: OffsetCollector): void {
        for (const { byteOffset, values, mask } of this.#lanes) {
            const matches = Memory.findPointers(slice.ranges, values, { mask });
            collector.collect(slice, this.#type, matches, byteOffset);
        }
    }
}

class BytePatternSearch implements Search {
    readonly #type: ValueType;
    readonly #patterns: string[];

    constructor(type: ValueType, bits: MaskedBits[]) {
        this.#type = type;
        this.#patterns = bits.flatMap(({ values, mask }) => values.map(value => bytePattern(value, mask, type.size)));
    }

    scan(slice: Slice, collector: OffsetCollector): void {
        for (const pattern of this.#patterns) {
            for (const range of slice.ranges) {
                collector.collect(slice, this.#type, Memory.scanSync(range.base, range.size, pattern), 0);
            }
        }
    }
}

function pointerFrom(value: bigint): NativePointer {
    return ptr("0x" + value.toString(16));
}

function bytePattern(value: bigint, mask: bigint, size: number): string {
    return `${littleEndianHex(value, size)} : ${littleEndianHex(mask, size)}`;
}

function littleEndianHex(value: bigint, size: number): string {
    const bytes: string[] = [];
    for (let index = 0; index !== size; index++) {
        bytes.push(Number((value >> BigInt(index * 8)) & 0xffn).toString(16).padStart(2, "0"));
    }
    return bytes.join(" ");
}

class OffsetCollector {
    readonly #builders = new Map<Piece, Map<ValueType, OffsetBuilder>>();
    hitCount = 0;

    collect(slice: Slice, type: ValueType, matches: { address: NativePointer }[], byteOffset: number): void {
        const runs = slice.runs;
        let runIndex = 0;
        let run = runs[0];
        let runEnd = run.piece.low + run.offset + run.size;
        let builder: OffsetBuilder | null = null;
        for (const match of matches) {
            const low = match.address.toUInt32();
            while (low >= runEnd) {
                run = runs[++runIndex];
                runEnd = run.piece.low + run.offset + run.size;
                builder = null;
            }
            builder ??= this.#builderFor(run.piece, type);
            builder.push(low - run.piece.low + byteOffset);
        }
        this.hitCount += matches.length;
    }

    blocks(): OffsetBlock[] {
        const blocks: OffsetBlock[] = [];
        for (const [piece, byType] of this.#builders) {
            for (const [type, builder] of byType) {
                blocks.push({ piece, type, offsets: builder.sorted() });
            }
        }
        return blocks;
    }

    #builderFor(piece: Piece, type: ValueType): OffsetBuilder {
        let byType = this.#builders.get(piece);
        if (byType === undefined) {
            byType = new Map();
            this.#builders.set(piece, byType);
        }
        let builder = byType.get(type);
        if (builder === undefined) {
            builder = new OffsetBuilder();
            byType.set(type, builder);
        }
        return builder;
    }
}

class OffsetBuilder {
    #storage = new Uint32Array(256);
    #count = 0;

    push(offset: number): void {
        if (this.#count === this.#storage.length) {
            const grown = new Uint32Array(this.#storage.length * 2);
            grown.set(this.#storage);
            this.#storage = grown;
        }
        this.#storage[this.#count++] = offset;
    }

    sorted(): Uint32Array {
        return this.#storage.slice(0, this.#count).sort();
    }
}

interface Slice {
    runs: Run[];
    ranges: MemoryRange[];
    byteCount: number;
}

function* slicesOf(runs: Run[], sliceBytes: () => number): Generator<Slice> {
    let slice: Slice = emptySlice();
    for (const run of runs) {
        let offset = run.offset;
        const end = run.offset + run.size;
        while (offset < end) {
            const sameBank = slice.runs.length === 0 || slice.runs[0].piece.bank === run.piece.bank;
            const room = sliceBytes() - slice.byteCount;
            if (!sameBank || room < Process.pageSize) {
                yield slice;
                slice = emptySlice();
                continue;
            }
            const size = Math.min(end - offset, room - (room % Process.pageSize));
            slice.runs.push({ piece: run.piece, offset, size });
            slice.ranges.push({ base: run.piece.base.add(offset), size });
            slice.byteCount += size;
            offset += size;
        }
    }
    if (slice.byteCount !== 0) {
        yield slice;
    }
}

function emptySlice(): Slice {
    return { runs: [], ranges: [], byteCount: 0 };
}

function nextSliceBytes(scannedBytes: number, hitCount: number): number {
    const bytesPerHit = scannedBytes / Math.max(hitCount, 1);
    return Math.min(largestSliceBytes, Math.max(smallestSliceBytes, Math.floor(hitsPerSlice * bytesPerHit)));
}
