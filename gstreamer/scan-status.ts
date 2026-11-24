import type { CompletedScan, ScanProgress } from "./bin-scan.js";

type ScanStatusWidget = CustomInstrumentWidgetMap["scan"];

type Phase =
    | { kind: "waiting" }
    | { kind: "loaded-later" }
    | { kind: "scanning"; progress: ScanProgress }
    | { kind: "scanned"; scan: CompletedScan; finishedAt: number }
    | { kind: "failed"; error: Error };

interface Library {
    module: Module;
    version: string;
}

interface StatusItem {
    title: string;
    subtitle: string;
    accessory: string;
}

const scanItemId = "scan";
export const scanningTitle = "Scanning…";

export class ScanStatus {
    readonly #widget: ScanStatusWidget;
    #library: Library | null = null;
    #phase: Phase = { kind: "waiting" };
    #bins = 0;
    #shownText = "";

    constructor(widget: ScanStatusWidget) {
        this.#widget = widget;
        widget.clear();
    }

    showWaitingForLibrary(): void {
        this.#enter({ kind: "waiting" });
    }

    showLibrary(module: Module, version: string): void {
        this.#library = { module, version };
    }

    showLoadedLater(): void {
        this.#enter({ kind: "loaded-later" });
    }

    showScanProgress(progress: ScanProgress): void {
        this.#enter({ kind: "scanning", progress });
    }

    showScanFinished(scan: CompletedScan): void {
        this.#enter({ kind: "scanned", scan, finishedAt: Date.now() });
    }

    showScanFailed(error: Error): void {
        this.#enter({ kind: "failed", error });
    }

    showBinCount(bins: number): void {
        this.#bins = bins;
        this.#show();
    }

    #enter(phase: Phase): void {
        this.#phase = phase;
        this.#show();
    }

    #show(): void {
        const item = itemOf(this.#phase, this.#library, countText(this.#bins));
        const text = JSON.stringify(item);
        if (text !== this.#shownText) {
            this.#shownText = text;
            this.#widget.upsertItem({ id: scanItemId, ...item });
        }
    }
}

function itemOf(phase: Phase, library: Library | null, bins: string): StatusItem {
    switch (phase.kind) {
        case "waiting":
            return {
                title: "GStreamer is not loaded",
                subtitle: "Waiting for it to load; GStreamer linked statically into the program is not supported",
                accessory: "",
            };
        case "loaded-later":
            return {
                title: bins,
                subtitle: `${libraryText(library!)} loaded after attach; each bin appears on its first state change`,
                accessory: "",
            };
        case "scanning":
            return {
                title: scanningTitle,
                subtitle: `${percentage(phase.progress)}% of ${byteCountText(phase.progress.total)} of writable memory searched`,
                accessory: bins,
            };
        case "scanned":
            return {
                title: bins,
                subtitle: `${libraryText(library!)} · ${byteCountText(phase.scan.total)} searched in `
                    + `${durationText(phase.scan.milliseconds)}; later bins appear on their first state change`,
                accessory: clockTime(phase.finishedAt),
            };
        case "failed":
            return {
                title: "Scan failed",
                subtitle: phase.error.message,
                accessory: bins,
            };
    }
}

function countText(bins: number): string {
    return (bins === 1) ? "1 bin" : `${bins} bins`;
}

function libraryText({ module, version }: Library): string {
    return `GStreamer ${version} in ${module.name}`;
}

function percentage({ scanned, total }: ScanProgress): number {
    return Math.floor(scanned * 100 / total);
}

const byteUnits = ["B", "KiB", "MiB", "GiB", "TiB"];

function byteCountText(byteCount: number): string {
    let value = byteCount;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < byteUnits.length - 1) {
        value /= 1024;
        unitIndex++;
    }
    return `${unitIndex === 0 ? value : value.toFixed(1)} ${byteUnits[unitIndex]}`;
}

function durationText(milliseconds: number): string {
    return (milliseconds < 1000) ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

function clockTime(timestamp: number): string {
    return new Date(timestamp).toTimeString().slice(0, 8);
}
