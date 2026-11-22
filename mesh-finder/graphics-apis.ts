import type { GraphicsBackend, GraphicsBackendFactory } from "./graphics-backend.js";
import type { FinderProgress, MeshFinder } from "./mesh-finder.js";
import type { Settings } from "./settings.js";

type DrawWatch = "watching" | "idle";

interface ActiveBackend {
    backend: GraphicsBackend;
    draws: DrawWatch;
}

export class GraphicsApis {
    private readonly active: ActiveBackend[] = [];
    private readonly starting = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly moduleObserver: ModuleObserver;

    constructor(
        private readonly factories: GraphicsBackendFactory[],
        private readonly finder: MeshFinder,
        private readonly settings: Settings,
        private readonly progress: FinderProgress,
    ) {
        this.moduleObserver = Process.attachModuleObserver({
            onAdded: module => this.consider(module),
        });
    }

    applySettings(): void {
        for (const entry of this.active) {
            this.syncDrawWatch(entry);
        }
    }

    scan(): void {
        if (this.active.length === 0) {
            const apis = new Set(this.factories.map(factory => factory.api));
            this.progress.note(`None of ${[...apis].join(", ")} is loaded in this process yet.`);
        }
        for (const { backend } of this.active) {
            this.search(backend);
        }
    }

    dispose(): void {
        this.moduleObserver.detach();
        for (const timer of this.starting.values()) {
            clearTimeout(timer);
        }
        this.starting.clear();
        for (const { backend } of this.active) {
            backend.dispose();
        }
        this.active.length = 0;
    }

    private consider(module: Module): void {
        for (const factory of this.factories) {
            if (factory.libraries.test(module.name) && !this.isKnown(factory.api)) {
                this.start(factory);
            }
        }
    }

    private isKnown(api: string): boolean {
        return this.starting.has(api) || this.active.some(({ backend }) => backend.api === api);
    }

    private start(factory: GraphicsBackendFactory): void {
        if (factory.activation === "while-loading") {
            this.activate(factory);
            return;
        }
        this.starting.set(factory.api, setTimeout(() => {
            this.starting.delete(factory.api);
            this.activate(factory);
        }, 0));
    }

    private activate(factory: GraphicsBackendFactory): void {
        try {
            const entry: ActiveBackend = { backend: factory.create(this.finder), draws: "idle" };
            this.active.push(entry);
            this.syncDrawWatch(entry);
            this.search(entry.backend);
        } catch (error) {
            this.progress.note(`Could not start on ${factory.api}: ${(error as Error).stack}`);
        }
    }

    private syncDrawWatch(entry: ActiveBackend): void {
        const wanted: DrawWatch = this.settings.watchDraws ? "watching" : "idle";
        if (wanted === entry.draws) {
            return;
        }
        if (wanted === "watching") {
            entry.backend.watchDraws();
            this.progress.note(`Watching ${entry.backend.api} draw calls.`);
        } else {
            entry.backend.unwatchDraws();
            this.progress.note(`Stopped watching ${entry.backend.api} draw calls.`);
        }
        entry.draws = wanted;
    }

    private search(backend: GraphicsBackend): void {
        if (!this.settings.guessUndrawn) {
            return;
        }
        const started = Date.now();
        this.progress.note(`Looking for live ${backend.api} buffers…`);
        backend.findBuffers().then(
            search => this.progress.note(
                `Found ${search.buffers} ${backend.api} buffers in ${Date.now() - started} ms (${search.detail}).`),
            error => this.progress.note(`Could not look for ${backend.api} buffers: ${(error as Error).message}`),
        );
    }
}
