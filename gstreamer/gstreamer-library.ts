export type LibraryArrival = "already-loaded" | "loaded-later";

export type LibraryListener = (library: Module, arrival: LibraryArrival) => void;

const identifyingExport = "gst_bin_get_type";

export class GStreamerLibraryWatch {
    readonly #listener: LibraryListener;
    #observer: ModuleObserver | null = null;
    #pendingArrival: ReturnType<typeof setTimeout> | null = null;

    constructor(listener: LibraryListener) {
        this.#listener = listener;
    }

    start(): void {
        let attaching = true;
        let alreadyLoaded: Module | null = null;
        this.#observer = Process.attachModuleObserver({
            onAdded: module => {
                if (!isGStreamer(module) || alreadyLoaded !== null || this.#pendingArrival !== null) {
                    return;
                }
                if (attaching) {
                    alreadyLoaded = module;
                } else {
                    this.#pendingArrival = setTimeout(() => this.#arrive(module, "loaded-later"), 0);
                }
            },
        });
        attaching = false;
        if (alreadyLoaded !== null) {
            this.#arrive(alreadyLoaded, "already-loaded");
        }
    }

    dispose(): void {
        this.#stopObserving();
        if (this.#pendingArrival !== null) {
            clearTimeout(this.#pendingArrival);
        }
    }

    #arrive(library: Module, arrival: LibraryArrival): void {
        this.#stopObserving();
        this.#listener(library, arrival);
    }

    #stopObserving(): void {
        this.#observer?.detach();
        this.#observer = null;
    }
}

function isGStreamer(module: Module): boolean {
    return module.findExportByName(identifyingExport) !== null;
}
