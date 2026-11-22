import { Residency, scannablePieces } from "../../trainer/address-space.js";

const value = 100;
const sliceBytes = 64 * 1024 * 1024;

const residency = new Residency();
const runs = scannablePieces()
    .flatMap(piece => residency.runsOf(piece))
    .map(run => ({ base: run.piece.base.add(run.offset), size: run.size }));
const totalBytes = runs.reduce((sum, run) => sum + run.size, 0);
console.log(`${runs.length} resident runs, ${(totalBytes / 1048576).toFixed(0)} MiB`);

for (let round = 1; round <= 2; round++) {
    measure(`round ${round}: findPointers, both halves of each word`, () => {
        let hits = 0;
        for (const slice of slices()) {
            hits += Memory.findPointers(slice, [ptr(value)], { mask: ptr("0xffffffff") }).length;
            hits += Memory.findPointers(slice, [ptr(value).shl(32)], { mask: ptr("0xffffffff00000000") }).length;
        }
        return hits;
    });
    measure(`round ${round}: scanSync, keeping aligned hits`, () => {
        let hits = 0;
        for (const run of runs) {
            for (const match of Memory.scanSync(run.base, run.size, "64 00 00 00")) {
                if ((match.address.toUInt32() & 3) === 0) {
                    hits++;
                }
            }
        }
        return hits;
    });
}

function measure(label: string, scan: () => number): void {
    const started = Date.now();
    const hits = scan();
    const elapsed = Date.now() - started;
    console.log(`${label}: ${elapsed} ms, ${hits} hits, ${(totalBytes / 1048576 / (elapsed / 1000)).toFixed(0)} MiB/s`);
}

function slices(): MemoryRange[][] {
    const result: MemoryRange[][] = [];
    let current: MemoryRange[] = [];
    let currentBytes = 0;
    for (const run of runs) {
        current.push(run);
        currentBytes += run.size;
        if (currentBytes >= sliceBytes) {
            result.push(current);
            current = [];
            currentBytes = 0;
        }
    }
    result.push(current);
    return result;
}
