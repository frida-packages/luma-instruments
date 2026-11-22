import { bytesAt, type Piece } from "./address-space.js";
import type { OffsetBlock } from "./first-scan.js";
import type { Job } from "./job.js";
import type { ValueArray, ValueType, ValueTypeName } from "./value-types.js";

export interface CandidateBlock extends OffsetBlock {
    values: ValueArray;
}

export interface Candidate {
    address: NativePointer;
    type: ValueType;
    value: number;
    block: CandidateBlock;
    index: number;
}

export type CandidateTest = (type: ValueType, current: number, previous: number) => boolean;

const windowBytes = 1024 * 1024;

export async function readCandidates(
    blocks: readonly (OffsetBlock | CandidateBlock)[],
    test: CandidateTest,
    job: Job,
): Promise<CandidateSet> {
    const total = blocks.reduce((sum, block) => sum + block.offsets.length, 0);
    const kept: CandidateBlock[] = [];
    let done = 0;
    for (const block of blocks) {
        const reader = new BlockReader(block, test);
        while (reader.readNextWindow()) {
            await job.checkpoint("reading", (done + reader.position) / total);
        }
        done += block.offsets.length;
        const result = reader.result();
        if (result.offsets.length !== 0) {
            kept.push(result);
        }
    }
    return new CandidateSet(kept);
}

class BlockReader {
    position = 0;
    private readonly previous: ValueArray | null;
    private readonly keptOffsets: Uint32Array;
    private readonly keptValues: ValueArray;
    private keptCount = 0;

    constructor(private readonly block: OffsetBlock | CandidateBlock, private readonly test: CandidateTest) {
        this.previous = ("values" in block) ? block.values : null;
        this.keptOffsets = new Uint32Array(block.offsets.length);
        this.keptValues = block.type.createArray(block.offsets.length);
    }

    readNextWindow(): boolean {
        const { offsets, piece, type } = this.block;
        if (this.position === offsets.length) {
            return false;
        }
        const first = this.position;
        const windowStart = offsets[first] - (offsets[first] % Process.pageSize);
        let end = first + 1;
        while (end < offsets.length && offsets[end] + type.size - windowStart <= windowBytes) {
            end++;
        }
        const windowEnd = offsets[end - 1] + type.size;
        const bytes = bytesAt(piece.base.add(windowStart), windowEnd - windowStart);
        if (bytes !== null) {
            const view = new DataView(bytes);
            for (let index = first; index !== end; index++) {
                this.consider(index, type.read(view, offsets[index] - windowStart));
            }
        } else {
            for (let index = first; index !== end; index++) {
                const value = readableValue(piece.base.add(offsets[index]), type);
                if (value !== null) {
                    this.consider(index, value);
                }
            }
        }
        this.position = end;
        return true;
    }

    result(): CandidateBlock {
        const { piece, type } = this.block;
        return { piece, type, offsets: this.keptOffsets.slice(0, this.keptCount), values: this.keptValues.slice(0, this.keptCount) };
    }

    private consider(index: number, current: number): void {
        const previous = (this.previous !== null) ? this.previous[index] : NaN;
        if (this.test(this.block.type, current, previous)) {
            this.keptOffsets[this.keptCount] = this.block.offsets[index];
            this.keptValues[this.keptCount] = current;
            this.keptCount++;
        }
    }
}

function readableValue(address: NativePointer, type: ValueType): number | null {
    try {
        return type.readAt(address);
    } catch (e) {
        return null;
    }
}

export class CandidateSet {
    readonly count: number;

    constructor(readonly blocks: CandidateBlock[]) {
        this.count = blocks.reduce((sum, block) => sum + block.offsets.length, 0);
    }

    countsByType(): Map<ValueTypeName, number> {
        const counts = new Map<ValueTypeName, number>();
        for (const block of this.blocks) {
            counts.set(block.type.name, (counts.get(block.type.name) ?? 0) + block.offsets.length);
        }
        return counts;
    }

    without(discarded: Candidate[]): CandidateSet {
        const isSame = (a: Candidate, b: Candidate) => a.block === b.block && a.index === b.index;
        return this.only(this.list().filter(candidate => !discarded.some(other => isSame(other, candidate))));
    }

    only(kept: Candidate[]): CandidateSet {
        return new CandidateSet(this.blocks.flatMap(block => {
            const indexes = kept.filter(candidate => candidate.block === block).map(candidate => candidate.index).sort((a, b) => a - b);
            return (indexes.length !== 0) ? [subsetOf(block, indexes)] : [];
        }));
    }

    list(): Candidate[] {
        const candidates: Candidate[] = [];
        for (const block of this.blocks) {
            for (let index = 0; index !== block.offsets.length; index++) {
                candidates.push({
                    address: block.piece.base.add(block.offsets[index]),
                    type: block.type,
                    value: block.values[index],
                    block,
                    index,
                });
            }
        }
        return candidates.sort((a, b) => a.address.compare(b.address));
    }

    valueAt(piece: Piece, type: ValueType, offset: number): number | undefined {
        const block = this.blocks.find(candidate => candidate.piece === piece && candidate.type === type);
        if (block === undefined) {
            return undefined;
        }
        const index = indexOf(block.offsets, offset);
        return (index !== -1) ? block.values[index] : undefined;
    }
}

function subsetOf(block: CandidateBlock, indexes: number[]): CandidateBlock {
    const offsets = new Uint32Array(indexes.length);
    const values = block.type.createArray(indexes.length);
    indexes.forEach((index, position) => {
        offsets[position] = block.offsets[index];
        values[position] = block.values[index];
    });
    return { piece: block.piece, type: block.type, offsets, values };
}

function indexOf(offsets: Uint32Array, offset: number): number {
    let low = 0;
    let high = offsets.length - 1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (offsets[middle] < offset) {
            low = middle + 1;
        } else if (offsets[middle] > offset) {
            high = middle - 1;
        } else {
            return middle;
        }
    }
    return -1;
}
