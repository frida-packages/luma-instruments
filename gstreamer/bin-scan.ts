export interface ScanProgress {
    scanned: number;
    total: number;
}

export interface CompletedScan extends ScanProgress {
    milliseconds: number;
}

export interface BinScanObserver {
    onCandidate(address: NativePointer): void;
    onScanProgress(progress: ScanProgress): void;
    onScanFinished(scan: CompletedScan): void;
    onScanFailed(error: Error): void;
}

interface ScanRun {
    canceled: boolean;
}

const sliceSize = 64 * 1024 * 1024;

export class BinScanner {
    readonly #observer: BinScanObserver;
    #current: ScanRun | null = null;

    constructor(observer: BinScanObserver) {
        this.#observer = observer;
    }

    start(classes: NativePointer[]): void {
        const run = { canceled: false };
        this.#current = run;
        scan(run, classes, this.#observer).catch(error => this.#observer.onScanFailed(error));
    }

    stop(): void {
        if (this.#current !== null) {
            this.#current.canceled = true;
            this.#current = null;
        }
    }
}

async function scan(run: ScanRun, classes: NativePointer[], observer: BinScanObserver): Promise<void> {
    const started = Date.now();
    const nothingToFind = classes.length === 0;
    const slices = nothingToFind ? [] : slicesOf(Process.enumerateRanges("rw-"));
    const progress = { scanned: 0, total: slices.reduce((total, slice) => total + slice.size, 0) };
    for (const slice of slices) {
        await nextTurn();
        if (run.canceled) {
            return;
        }
        for (const match of Memory.findPointers(slice, classes)) {
            observer.onCandidate(match.address);
        }
        progress.scanned += slice.size;
        observer.onScanProgress(progress);
    }
    observer.onScanFinished({ ...progress, milliseconds: Date.now() - started });
}

function slicesOf(ranges: RangeDetails[]): MemoryRange[] {
    return ranges.flatMap(range => Array.from({ length: Math.ceil(range.size / sliceSize) }, (_, i) => ({
        base: range.base.add(i * sliceSize),
        size: Math.min(sliceSize, range.size - i * sliceSize),
    })));
}

function nextTurn(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}
