import { isLiveTopLevelBin } from "./bin-candidates.js";
import { BinScanner, type BinScanObserver, type CompletedScan, type ScanProgress } from "./bin-scan.js";
import type { GraphDisplay } from "./graph-display.js";
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
    readonly #graph: GraphDisplay;
    readonly #settings: Settings;
    readonly #libraryWatch = new GStreamerLibraryWatch((library, arrival) => this.#onLibrary(library, arrival));
    #gst: LoadedGStreamer | null = null;
    #shown: TrackedBin | null = null;
    #arrivals: TrackedBin[] = [];
    #scanning = false;
    #scansFinished = 0;
    readonly #changed = new Set<TrackedBin>();
    #pendingRefresh: ReturnType<typeof setTimeout> | null = null;
    #refreshTimer: ReturnType<typeof setInterval> | null = null;
    #disposed = false;

    constructor(
        status: ScanStatus,
        table: PipelineTable,
        graph: GraphDisplay,
        settings: Settings,
    ) {
        this.#status = status;
        this.#table = table;
        this.#graph = graph;
        this.#settings = settings;
    }

    start(): void {
        this.#status.showWaitingForLibrary();
        this.#table.enableRescan(false);
        this.#libraryWatch.start();
    }

    applySettings(previousDetails: Settings["details"]): void {
        this.#startRefreshTimer();
        if (this.#settings.details !== previousDetails && this.#shown !== null) {
            this.#refresh(this.#shown);
        }
    }

    show(id: string): void {
        const bin = this.#gst!.bins.find(id);
        if (bin === undefined) {
            return;
        }
        this.#shown = bin;
        this.#arrivals = [];
        this.#refresh(bin);
    }

    rescan(): void {
        const gst = this.#gst!;
        const classes = gst.api.binClasses();
        gst.classes = new Set(classes.map(cls => cls.toString()));
        this.#scanning = true;
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
        this.#scanning = false;
        this.#table.enableRescan(true);
        this.#refreshChanged();
        this.#scansFinished++;
        if (this.#scansFinished === 1 && this.#gst!.bins.all().length === 0) {
            this.#graph.clear();
        }
    }

    onScanFailed(error: Error): void {
        this.#status.showScanFailed(error);
        this.#scanning = false;
        this.#table.enableRescan(true);
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
        const { bin, isNew } = this.#gst!.bins.track(object, foundBy);
        if (isNew) {
            this.#arrivals.push(bin);
        }
        this.#changed.add(bin);
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
        this.#showNextIfNothingShown();
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
        this.#showNextIfNothingShown();
    }

    #refresh(bin: TrackedBin): void {
        const { api, bins } = this.#gst!;
        const isShown = bin === this.#shown;
        const { detailFlags, details } = this.#settings;
        const taken = bins.hold(bin, object => api.hasParent(object) ? null : {
            facts: api.factsOf(object),
            dot: isShown ? api.dotOf(object, detailFlags) : null,
        });
        if (taken === null) {
            this.#forgetGone(bin);
            return;
        }
        bin.facts = taken.facts;
        this.#table.showBin(bin, taken.facts);
        if (taken.dot !== null) {
            this.#graph.show(bin, taken.facts, details, taken.dot);
        }
    }

    #forgetGone(bin: TrackedBin): void {
        const { bins } = this.#gst!;
        bins.forget(bin);
        if (this.#shown === bin) {
            this.#shown = null;
        }
        if (bins.find(bin.id) === undefined) {
            this.#table.removeBin(bin);
        }
    }

    #showNextIfNothingShown(): void {
        if (this.#shown !== null || this.#scanning) {
            return;
        }
        const { bins } = this.#gst!;
        this.#arrivals = this.#arrivals.filter(bin => bin.facts !== null && bins.find(bin.id) === bin);
        const next = this.#arrivals.find(bin => bin.facts!.isPipeline) ?? this.#arrivals[0];
        if (next !== undefined) {
            this.show(next.id);
        }
    }
}
