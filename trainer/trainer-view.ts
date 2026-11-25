import { addressNumber, bytesAt, type RegionNames } from "./address-space.js";
import type { Candidate, CandidateSet } from "./candidates.js";
import type { Phase } from "./job.js";
import type { Lock, Writer } from "./locks.js";
import type { ValueType } from "./value-types.js";

export const listLimit = 100;

const memoryBefore = 128;
const memoryLength = 512;
const phaseUnits: Record<Phase, string> = { scanning: "% scanned", reading: "% read" };

export interface ListedCandidate extends Candidate {
    id: string;
    row: number;
    where: string;
}

export class TrainerView {
    listed: ListedCandidate[] = [];
    readonly #console: CustomInstrumentWidgetMap["console"];
    readonly #counter: CustomInstrumentWidgetMap["candidates"];
    readonly #list: CustomInstrumentWidgetMap["list"];
    readonly #locks: CustomInstrumentWidgetMap["locks"];
    readonly #writers: CustomInstrumentWidgetMap["writers"];
    readonly #memory: CustomInstrumentWidgetMap["memory"];
    #shownCount = 0;

    constructor(ctx: CustomInstrumentContext) {
        this.#console = ctx.widget("console");
        this.#counter = ctx.widget("candidates");
        this.#list = ctx.widget("list");
        this.#locks = ctx.widget("locks");
        this.#writers = ctx.widget("writers");
        this.#memory = ctx.widget("memory");
    }

    say(text: string): void {
        this.#console.appendOutput(text);
    }

    clearConsole(): void {
        this.#console.clear();
    }

    complain(text: string): void {
        this.#console.appendError(text);
    }

    showMemory(address: NativePointer): void {
        const pageStart = address.and(ptr(Process.pageSize - 1).not());
        const wanted = address.sub(memoryBefore).and(ptr(0xf).not());
        const start = (wanted.compare(pageStart) < 0) ? pageStart : wanted;
        const bytesToPageEnd = pageStart.add(Process.pageSize).sub(start).toUInt32();
        const bytes = bytesAt(start, memoryLength) ?? bytesAt(start, Math.min(memoryLength, bytesToPageEnd));
        if (bytes === null) {
            this.complain(`${address} can no longer be read.`);
            return;
        }
        this.#memory.setHex({ bytes, baseAddress: start });
    }

    clearCandidates(): void {
        this.#shownCount = 0;
        this.listed = [];
        this.#counter.clear();
        this.#list.clear();
        this.#memory.clear();
    }

    clearWriters(): void {
        this.#writers.clear();
    }

    showProgress(phase: Phase, fraction: number): void {
        this.#counter.setCounter({ value: Math.floor(fraction * 100), unit: phaseUnits[phase] });
    }

    showCandidates(set: CandidateSet, previous: CandidateSet | null, names: () => RegionNames): void {
        this.#counter.setCounter({ value: set.count, unit: "candidates", delta: set.count - this.#shownCount });
        this.#shownCount = set.count;
        this.#list.clear();
        this.listed = [];
        if (set.count === 0 || set.count > listLimit) {
            return;
        }
        const regionNames = names();
        this.listed = set.list().map((candidate, index) => ({
            ...candidate,
            id: `${candidate.address}:${candidate.type.name}`,
            row: index + 1,
            where: regionNames.nameOf(addressNumber(candidate.address)),
        }));
        for (const candidate of this.listed) {
            const { piece, type, offsets } = candidate.block;
            const before = previous?.valueAt(piece, type, offsets[candidate.index]);
            this.#list.upsertRow({
                id: candidate.id,
                cells: {
                    row: String(candidate.row),
                    address: candidate.address.toString(),
                    type: type.name,
                    value: formatValue(type, candidate.value),
                    previous: (before !== undefined) ? formatValue(type, before) : "",
                    where: candidate.where,
                },
            });
        }
    }

    showLocks(locks: Lock[], writers: Writer[]): void {
        this.#locks.clear();
        for (const lock of locks) {
            this.#locks.upsertRow({
                id: String(lock.slot),
                cells: {
                    lock: String(lock.slot + 1),
                    address: lock.address.toString(),
                    type: lock.type.name,
                    value: (lock.state === "holding") ? formatValue(lock.type, lock.value) : "gone",
                    blocked: grouped(lock.undone),
                    where: lock.where,
                },
            });
        }
        for (const writer of writers) {
            this.#writers.upsertRow({
                id: `${writer.code}:${writer.target}`,
                cells: {
                    code: writer.code.toString(),
                    function: functionName(writer.code),
                    writes: grouped(writer.writes),
                    target: writer.target.toString(),
                },
            });
        }
    }
}

export function formatValue(type: ValueType, value: number): string {
    if (type.numeric === "integer") {
        return String(value);
    }
    return String(Number(value.toPrecision(type.size === 4 ? 7 : 15)));
}

export function grouped(count: number): string {
    return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function functionName(code: NativePointer): string {
    const symbol = DebugSymbol.fromAddress(code);
    if (symbol.name !== null) {
        return (symbol.moduleName !== null) ? `${symbol.moduleName}!${symbol.name}` : symbol.name;
    }
    const module = Process.findModuleByAddress(code);
    return (module !== null) ? `${module.name}+0x${code.sub(module.base).toString(16)}` : "";
}
