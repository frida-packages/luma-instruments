import type { GraphicsBackend, GraphicsBackendFactory } from "./graphics-backend.js";
import type { FinderProgress, MeshFinder } from "./mesh-finder.js";
import type { Settings } from "./settings.js";

type DrawWatch = "watching" | "idle";

interface ActiveBackend {
    backend: GraphicsBackend;
    draws: DrawWatch;
}

export interface ScanControl {
    allowScan(allowed: boolean): void;
}

export class GraphicsApis {
    readonly #factories: GraphicsBackendFactory[];
    readonly #finder: MeshFinder;
    readonly #settings: Settings;
    readonly #progress: FinderProgress;
    readonly #scanControl: ScanControl;
    readonly #active: ActiveBackend[] = [];
    readonly #deferredSearches = new Set<ReturnType<typeof setTimeout>>();
    #searches = 0;
    #scanAllowed = true;
    readonly #starting = new Map<string, ReturnType<typeof setTimeout>>();
    readonly #moduleObserver: ModuleObserver;

    constructor(
        factories: GraphicsBackendFactory[],
        finder: MeshFinder,
        settings: Settings,
        progress: FinderProgress,
        scanControl: ScanControl,
    ) {
        this.#factories = factories;
        this.#finder = finder;
        this.#settings = settings;
        this.#progress = progress;
        this.#scanControl = scanControl;
        this.#moduleObserver = Process.attachModuleObserver({
            onAdded: module => this.#consider(module),
        });
        this.#syncScanAllowed();
    }

    applySettings(): void {
        for (const entry of this.#active) {
            this.#syncDrawWatch(entry);
        }
        this.#syncScanAllowed();
    }

    scanRefusal(): string | null {
        if (!this.#settings.guessUndrawn) {
            return "Scan only looks for buffers never drawn; turn on “Guess meshes in buffers never drawn” to use it.";
        }
        return (this.#searches !== 0) ? "Still looking for buffers; scan again once that is done." : null;
    }

    scan(): void {
        if (this.#active.length === 0) {
            const apis = new Set(this.#factories.map(factory => factory.api));
            this.#progress.note(`None of ${[...apis].join(", ")} is loaded in this process yet.`);
        }
        for (const { backend } of this.#active) {
            this.#search(backend);
        }
    }

    dispose(): void {
        this.#moduleObserver.detach();
        for (const timer of this.#deferredSearches) {
            clearTimeout(timer);
        }
        this.#deferredSearches.clear();
        for (const timer of this.#starting.values()) {
            clearTimeout(timer);
        }
        this.#starting.clear();
        for (const { backend } of this.#active) {
            backend.dispose();
        }
        this.#active.length = 0;
    }

    #consider(module: Module): void {
        for (const factory of this.#factories) {
            if (factory.libraries.test(module.name) && !this.#isKnown(factory.api)) {
                this.#start(factory);
            }
        }
    }

    #isKnown(api: string): boolean {
        return this.#starting.has(api) || this.#active.some(({ backend }) => backend.api === api);
    }

    #start(factory: GraphicsBackendFactory): void {
        if (factory.activation === "while-loading") {
            this.#activate(factory);
            return;
        }
        this.#starting.set(factory.api, setTimeout(() => {
            this.#starting.delete(factory.api);
            this.#activate(factory);
        }, 0));
    }

    #activate(factory: GraphicsBackendFactory): void {
        try {
            const entry: ActiveBackend = { backend: factory.create(this.#finder), draws: "idle" };
            this.#active.push(entry);
            this.#syncDrawWatch(entry);
            this.#searchSoon(entry.backend);
        } catch (error) {
            this.#progress.note(`Could not start on ${factory.api}: ${(error as Error).stack}`);
        }
    }

    #syncDrawWatch(entry: ActiveBackend): void {
        const wanted: DrawWatch = this.#settings.watchDraws ? "watching" : "idle";
        if (wanted === entry.draws) {
            return;
        }
        if (wanted === "watching") {
            entry.backend.watchDraws();
            this.#progress.note(`Watching ${entry.backend.api} draw calls.`);
        } else {
            entry.backend.unwatchDraws();
            this.#progress.note(`Stopped watching ${entry.backend.api} draw calls.`);
        }
        entry.draws = wanted;
    }

    #searchSoon(backend: GraphicsBackend): void {
        const timer = setTimeout(() => {
            this.#deferredSearches.delete(timer);
            this.#search(backend);
        }, 0);
        this.#deferredSearches.add(timer);
    }

    #search(backend: GraphicsBackend): void {
        if (!this.#settings.guessUndrawn) {
            return;
        }
        const started = Date.now();
        this.#progress.note(`Looking for live ${backend.api} buffers…`);
        this.#searchStarted();
        backend.findBuffers().then(
            search => this.#progress.note(
                `Found ${search.buffers} ${backend.api} buffers in ${Date.now() - started} ms (${search.detail}).`),
            error => this.#progress.note(`Could not look for ${backend.api} buffers: ${(error as Error).message}`),
        ).then(() => this.#searchEnded());
    }

    #searchStarted(): void {
        this.#searches++;
        this.#syncScanAllowed();
    }

    #searchEnded(): void {
        this.#searches--;
        this.#syncScanAllowed();
    }

    #syncScanAllowed(): void {
        const allowed = this.#settings.guessUndrawn && this.#searches === 0;
        if (allowed !== this.#scanAllowed) {
            this.#scanAllowed = allowed;
            this.#scanControl.allowScan(allowed);
        }
    }
}
