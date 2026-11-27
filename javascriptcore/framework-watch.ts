const FRAMEWORK_NAME = "JavaScriptCore";

export class FrameworkWatch {
    readonly #onArrival: (framework: Module) => void;
    #observer: ModuleObserver | null = null;
    #pendingArrival: ReturnType<typeof setTimeout> | null = null;

    constructor(onArrival: (framework: Module) => void) {
        this.#onArrival = onArrival;
    }

    start(): void {
        let attaching = true;
        let alreadyLoaded: Module | null = null;
        this.#observer = Process.attachModuleObserver({
            onAdded: module => {
                if (module.name !== FRAMEWORK_NAME || alreadyLoaded !== null || this.#pendingArrival !== null) {
                    return;
                }
                if (attaching) {
                    alreadyLoaded = module;
                } else {
                    this.#pendingArrival = setTimeout(() => this.#arrive(module), 0);
                }
            },
        });
        attaching = false;
        if (alreadyLoaded !== null) {
            this.#arrive(alreadyLoaded);
        }
    }

    dispose(): void {
        this.#stopObserving();
        if (this.#pendingArrival !== null) {
            clearTimeout(this.#pendingArrival);
        }
    }

    #arrive(framework: Module): void {
        this.#stopObserving();
        this.#onArrival(framework);
    }

    #stopObserving(): void {
        this.#observer?.detach();
        this.#observer = null;
    }
}
