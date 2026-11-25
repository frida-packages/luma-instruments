import { isLiveTopLevelBin } from "./bin-candidates.js";
import type { BinPage, BinPages } from "./bin-pages.js";
import { BinScanner, type BinScanObserver, type CompletedScan, type ScanProgress } from "./bin-scan.js";
import { GStreamerApi } from "./gstreamer-api.js";
import { GStreamerLibraryWatch, type LibraryArrival } from "./gstreamer-library.js";
import type { PipelineTable } from "./pipeline-table.js";
import type { ScanStatus } from "./scan-status.js";
import type { Settings } from "./settings.js";
import { StateChangeHook } from "./state-change-hook.js";
import { TrackedBins, type Discovery, type TrackedBin } from "./tracked-bins.js";

interface LoadedGStreamer {
    api: GStreamerApi;
    bins: TrackedBins;
    scanner: BinScanner;
    hook: StateChangeHook;
    classes: Set<string>;
}

const settleMilliseconds = 250;

export class PipelineWatch implements BinScanObserver {
    readonly #status: ScanStatus;
    readonly #table: PipelineTable;
    readonly #pages: BinPages;
    readonly #settings: Settings;
    readonly #libraryWatch = new GStreamerLibraryWatch((library, arrival) => this.#onLibrary(library, arrival));
    #gst: LoadedGStreamer | null = null;
    readonly #changed = new Set<TrackedBin>();
    #pendingRefresh: ReturnType<typeof setTimeout> | null = null;
    #refreshTimer: ReturnType<typeof setInterval> | null = null;
    #disposed = false;

    constructor(
        status: ScanStatus,
        table: PipelineTable,
        pages: BinPages,
        settings: Settings,
    ) {
        this.#status = status;
        this.#table = table;
        this.#pages = pages;
        this.#settings = settings;
    }

    start(): void {
        this.#status.showWaitingForLibrary();
        this.#table.enableRescan(false);
        this.#libraryWatch.start();
        if (this.#gst === null) {
            this.#pages.dropUnconfirmed();
        }
    }

    applySettings(previousDetails: Settings["details"]): void {
        this.#startRefreshTimer();
        if (this.#settings.details !== previousDetails && this.#gst !== null) {
            this.#refreshAll();
        }
    }

    show(id: string): BinPage | null {
        const bin = this.#gst!.bins.find(id);
        if (bin === undefined) {
            return null;
        }
        this.#refresh(bin);
        return this.#pages.find(bin);
    }

    rescan(): void {
        const gst = this.#gst!;
        const classes = gst.api.binClasses();
        gst.classes = new Set(classes.map(cls => cls.toString()));
        this.#table.enableRescan(false);
        gst.scanner.start(classes);
    }

    dispose(): void {
        this.#disposed = true;
        this.#libraryWatch.dispose();
        this.#stopRefreshTimer();
        if (this.#pendingRefresh !== null) {
            clearTimeout(this.#pendingRefresh);
        }
        if (this.#gst !== null) {
            this.#gst.scanner.stop();
            this.#gst.hook.dispose();
            this.#gst.bins.dispose();
        }
    }

    onCandidate(address: NativePointer): void {
        if (isLiveTopLevelBin(address, this.#gst!.classes)) {
            this.#track(address, "memory scan");
        }
    }

    onScanProgress(progress: ScanProgress): void {
        this.#status.showScanProgress(progress);
    }

    onScanFinished(scan: CompletedScan): void {
        this.#status.showScanFinished(scan);
        this.#table.enableRescan(true);
        this.#refreshChanged();
        this.#pages.dropUnconfirmed();
    }

    onScanFailed(error: Error): void {
        this.#status.showScanFailed(error);
        this.#table.enableRescan(true);
        this.#pages.dropUnconfirmed();
    }

    #onLibrary(library: Module, arrival: LibraryArrival): void {
        const api = new GStreamerApi(library);
        this.#status.showLibrary(library, api.version);
        this.#gst = {
            api,
            bins: new TrackedBins(api),
            scanner: new BinScanner(this),
            hook: new StateChangeHook(api, root => this.#onRootChanging(root)),
            classes: new Set(),
        };
        this.#startRefreshTimer();
        if (arrival === "already-loaded") {
            this.rescan();
        } else {
            this.#status.showLoadedLater();
            this.#table.enableRescan(true);
        }
    }

    #onRootChanging(root: NativePointer): void {
        if (!this.#disposed) {
            this.#track(root, "state change");
        }
    }

    #track(object: NativePointer, foundBy: Discovery): void {
        this.#changed.add(this.#gst!.bins.track(object, foundBy));
        this.#pendingRefresh ??= setTimeout(() => this.#refreshChanged(), settleMilliseconds);
    }

    #refreshChanged(): void {
        if (this.#pendingRefresh !== null) {
            clearTimeout(this.#pendingRefresh);
            this.#pendingRefresh = null;
        }
        const bins = [...this.#changed];
        this.#changed.clear();
        bins.forEach(bin => this.#refresh(bin));
    }

    #startRefreshTimer(): void {
        this.#stopRefreshTimer();
        if (this.#gst !== null && this.#settings.refreshMilliseconds !== 0) {
            this.#refreshTimer = setInterval(() => this.#refreshAll(), this.#settings.refreshMilliseconds);
        }
    }

    #stopRefreshTimer(): void {
        if (this.#refreshTimer !== null) {
            clearInterval(this.#refreshTimer);
            this.#refreshTimer = null;
        }
    }

    #refreshAll(): void {
        this.#gst!.bins.all().forEach(bin => this.#refresh(bin));
    }

    #refresh(bin: TrackedBin): void {
        const { api, bins } = this.#gst!;
        const { detailFlags, details } = this.#settings;
        const taken = bins.hold(bin, object => api.hasParent(object) ? null : {
            facts: api.factsOf(object),
            dot: api.dotOf(object, detailFlags),
        });
        if (taken === null) {
            this.#forgetGone(bin);
            return;
        }
        this.#table.showBin(bin, taken.facts);
        this.#pages.show(bin, taken.facts, details, taken.dot);
    }

    #forgetGone(bin: TrackedBin): void {
        const { bins } = this.#gst!;
        bins.forget(bin);
        if (bins.find(bin.id) === undefined) {
            this.#table.removeBin(bin);
            this.#pages.remove(bin);
        }
    }
}
