import type { Discovery, Strategy } from "./catalog.js";
import { MalformedDer } from "./der.js";
import { scanMemory, type ScannedMemory } from "./memory-scan.js";
import { findOpenSslLibraries } from "./openssl.js";
import { findSecurityFramework } from "./security-framework.js";

export type MemoryScope = "writable" | "readable";

export interface ObjectSource {
    readonly strategy: Strategy;
    readonly holder: string;
    findCandidates(ranges: MemoryRange[]): Candidate[];
}

export type Candidate = () => Discovery | null;

export interface ScanObserver {
    onStarted(scope: MemoryScope): void;
    onDiscovery(discovery: Discovery): void;
    onObjectsSearched(search: ObjectSearch): void;
    onMemoryScanned(memory: ScannedMemory): void;
    onFinished(scan: CompletedScan): void;
    onFailed(error: Error): void;
}

export interface ObjectSearch {
    strategy: Strategy;
    holder: string;
    candidates: number;
    searchMilliseconds: number;
    checkMilliseconds: number;
}

export interface CompletedScan {
    scope: MemoryScope;
    objectMilliseconds: number;
    memory: ScannedMemory;
    memoryMilliseconds: number;
}

export class Scanner {
    readonly #observer: ScanObserver;
    #current: ScanRun | null = null;

    constructor(observer: ScanObserver) {
        this.#observer = observer;
    }

    start(scope: MemoryScope): void {
        this.stop();
        const run = new ScanRun(this.#observer);
        this.#current = run;
        performScan(run, scope, this.#observer).catch(error => {
            if (!(error instanceof ScanCanceled)) {
                this.#observer.onFailed(error);
            }
        });
    }

    stop(): void {
        this.#current?.cancel();
        this.#current = null;
    }
}

async function performScan(run: ScanRun, scope: MemoryScope, observer: ScanObserver): Promise<void> {
    observer.onStarted(scope);
    const writable = Process.enumerateRanges("rw-");

    const objectsStarted = Date.now();
    for (const source of objectSources()) {
        observer.onObjectsSearched(await searchObjects(source, writable, run));
    }
    const objectMilliseconds = Date.now() - objectsStarted;

    const memoryStarted = Date.now();
    const ranges = (scope === "writable") ? writable : Process.enumerateRanges("r--");
    const memory = await scanMemory(ranges, run, progress => observer.onMemoryScanned(progress));
    observer.onFinished({ scope, objectMilliseconds, memory, memoryMilliseconds: Date.now() - memoryStarted });
}

function objectSources(): ObjectSource[] {
    const securityFramework = findSecurityFramework();
    return [...(securityFramework !== null ? [securityFramework] : []), ...findOpenSslLibraries()];
}

async function searchObjects(source: ObjectSource, ranges: MemoryRange[], run: ScanRun): Promise<ObjectSearch> {
    const searchStarted = Date.now();
    const candidates = source.findCandidates(ranges);
    const checkStarted = Date.now();
    for (const candidate of candidates) {
        await run.checkpoint();
        run.consider(candidate);
    }
    return {
        strategy: source.strategy,
        holder: source.holder,
        candidates: candidates.length,
        searchMilliseconds: checkStarted - searchStarted,
        checkMilliseconds: Date.now() - checkStarted,
    };
}

const sliceMilliseconds = 20;

export class ScanRun {
    readonly #observer: ScanObserver;
    #state: "running" | "canceled" = "running";
    #sliceStarted = Date.now();

    constructor(observer: ScanObserver) {
        this.#observer = observer;
    }

    cancel(): void {
        this.#state = "canceled";
    }

    async checkpoint(): Promise<void> {
        if (Date.now() - this.#sliceStarted >= sliceMilliseconds) {
            await new Promise(resolve => setImmediate(resolve));
            this.#sliceStarted = Date.now();
        }
        if (this.#state === "canceled") {
            throw new ScanCanceled();
        }
    }

    consider(candidate: Candidate): void {
        let discovery: Discovery | null;
        try {
            discovery = candidate();
        } catch (error) {
            if (isUntrustedMemoryFailure(error)) {
                return;
            }
            throw error;
        }
        if (discovery !== null) {
            this.#observer.onDiscovery(discovery);
        }
    }
}

class ScanCanceled extends Error {
}

function isUntrustedMemoryFailure(error: unknown): boolean {
    return error instanceof MalformedDer || (error instanceof Error && error.message.startsWith("access violation"));
}
