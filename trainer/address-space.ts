export interface Piece {
    base: NativePointer;
    start: number;
    size: number;
    bank: number;
    low: number;
}

export interface Run {
    piece: Piece;
    offset: number;
    size: number;
}

const bankSize = 2 ** 32;
const darwinResidentPage = 0x01 | 0x20;
const linuxResidentPage = 0x01;

export function scannablePieces(): Piece[] {
    const excluded = sharedCacheRange();
    const pieces: Piece[] = [];
    for (const range of Process.enumerateRanges({ protection: "rw-", coalesce: false })) {
        const start = addressNumber(range.base);
        if (excluded !== null && start >= excluded.start && start < excluded.end) {
            continue;
        }
        pieces.push(...piecesWithinBanks(range.base, start, range.size));
    }
    return pieces;
}

function sharedCacheRange(): { start: number; end: number } | null {
    const getRange = Module.findGlobalExportByName("_dyld_get_shared_cache_range");
    if (getRange === null) {
        return null;
    }
    const length = Memory.alloc(Process.pointerSize);
    const start = new NativeFunction(getRange, "pointer", ["pointer"])(length) as NativePointer;
    if (start.isNull()) {
        return null;
    }
    const startNumber = addressNumber(start);
    return { start: startNumber, end: startNumber + length.readU64().toNumber() };
}

function piecesWithinBanks(base: NativePointer, start: number, size: number): Piece[] {
    const pieces: Piece[] = [];
    let offset = 0;
    while (offset < size) {
        const pieceStart = start + offset;
        const bank = Math.floor(pieceStart / bankSize);
        const pieceSize = Math.min(size - offset, (bank + 1) * bankSize - pieceStart);
        pieces.push({ base: base.add(offset), start: pieceStart, size: pieceSize, bank, low: pieceStart - bank * bankSize });
        offset += pieceSize;
    }
    return pieces;
}

export class Residency {
    readonly #mincore: NativeFunction<number, [NativePointer, number, NativePointer]> | null;
    readonly #residentFlags = (Process.platform === "darwin") ? darwinResidentPage : linuxResidentPage;

    constructor() {
        const mincore = (Process.platform !== "windows") ? Module.findGlobalExportByName("mincore") : null;
        this.#mincore = (mincore !== null) ? new NativeFunction(mincore, "int", ["pointer", "size_t", "pointer"]) : null;
    }

    runsOf(piece: Piece): Run[] {
        if (this.#mincore === null) {
            return [{ piece, offset: 0, size: piece.size }];
        }
        const pageSize = Process.pageSize;
        const pageCount = Math.ceil(piece.size / pageSize);
        const vector = Memory.alloc(pageCount);
        if (this.#mincore(piece.base, piece.size, vector) !== 0) {
            return [];
        }
        const pages = new Uint8Array(vector.readByteArray(pageCount)!);
        const runs: Run[] = [];
        let runStart = -1;
        for (let page = 0; page <= pageCount; page++) {
            const resident = page < pageCount && (pages[page] & this.#residentFlags) !== 0;
            if (resident && runStart === -1) {
                runStart = page;
            } else if (!resident && runStart !== -1) {
                const offset = runStart * pageSize;
                runs.push({ piece, offset, size: Math.min(page * pageSize, piece.size) - offset });
                runStart = -1;
            }
        }
        return runs;
    }
}

interface Span {
    start: number;
    end: number;
}

interface Stack extends Span {
    thread: ThreadId;
}

interface ModuleStart {
    start: number;
    module: Module;
}

export class RegionNames {
    readonly #stacks: Stack[] = [];
    readonly #modules: ModuleStart[];
    readonly #writableSpans = new Map<Module, Span[]>();

    constructor() {
        for (const thread of Process.enumerateThreads()) {
            const stack = Process.findRangeByAddress(thread.context.sp);
            if (stack !== null) {
                const start = addressNumber(stack.base);
                this.#stacks.push({ start, end: start + stack.size, thread: thread.id });
            }
        }
        this.#modules = Process.enumerateModules()
            .map(module => ({ start: addressNumber(module.base), module }))
            .sort((a, b) => a.start - b.start);
    }

    nameOf(address: number): string {
        const stack = this.#stacks.find(({ start, end }) => address >= start && address < end);
        if (stack !== undefined) {
            return `stack of thread ${stack.thread}`;
        }
        const owner = this.#moduleBelow(address);
        if (owner !== null && this.#spansOf(owner.module).some(({ start, end }) => address >= start && address < end)) {
            return `${owner.module.name}+0x${(address - owner.start).toString(16)}`;
        }
        return "heap";
    }

    #moduleBelow(address: number): ModuleStart | null {
        let low = 0;
        let high = this.#modules.length - 1;
        let below: ModuleStart | null = null;
        while (low <= high) {
            const middle = (low + high) >> 1;
            if (this.#modules[middle].start <= address) {
                below = this.#modules[middle];
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        return below;
    }

    #spansOf(module: Module): Span[] {
        let spans = this.#writableSpans.get(module);
        if (spans === undefined) {
            spans = module.enumerateRanges("rw-").map(range => {
                const start = addressNumber(range.base);
                return { start, end: start + range.size };
            });
            this.#writableSpans.set(module, spans);
        }
        return spans;
    }
}

export function addressNumber(address: NativePointer): number {
    return Number(address.toString());
}

export function bytesAt(address: NativePointer, length: number): ArrayBuffer | null {
    try {
        return address.readByteArray(length);
    } catch (e) {
        return null;
    }
}
