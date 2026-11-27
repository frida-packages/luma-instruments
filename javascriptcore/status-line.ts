import type { ContextRegistry } from "./contexts.js";
import type { ScanReport } from "./discovery.js";

type StatusWidget = CustomInstrumentWidgetMap["status"];

const ITEM_ID = "status";
const REFRESH_DELAY_MS = 300;

export class StatusLine {
    readonly #widget: StatusWidget;
    #registry: ContextRegistry | null = null;
    #scanning = false;
    #report: ScanReport | null = null;
    #note: string | null = null;
    #pendingRefresh: ReturnType<typeof setTimeout> | null = null;

    constructor(widget: StatusWidget) {
        this.#widget = widget;
        widget.clear();
        widget.upsertItem({ id: ITEM_ID, title: "Waiting for JavaScriptCore to load" });
    }

    watch(registry: ContextRegistry): void {
        this.#registry = registry;
        this.refresh();
    }

    showScanning(): void {
        this.#scanning = true;
        this.refresh();
    }

    showReport(report: ScanReport): void {
        this.#scanning = false;
        this.#report = report;
        this.refresh();
    }

    note(text: string): void {
        this.#note = text;
        this.refresh();
    }

    refresh(): void {
        this.#pendingRefresh ??= setTimeout(() => {
            this.#pendingRefresh = null;
            this.#render(this.#registry!);
        }, REFRESH_DELAY_MS);
    }

    dispose(): void {
        if (this.#pendingRefresh !== null) {
            clearTimeout(this.#pendingRefresh);
        }
    }

    #render(registry: ContextRegistry): void {
        const contexts = registry.liveCount;
        const vms = registry.vms.filter(vm => vm.live.length !== 0).length;
        const title = `${contexts} context${(contexts === 1) ? "" : "s"} in ${vms} VM${(vms === 1) ? "" : "s"}`
            + (this.#scanning ? "; looking through memory for more…" : "");
        const subtitle = [this.#note, (this.#report !== null) ? reportText(this.#report) : null]
            .filter(part => part !== null)
            .join(" · ");
        this.#widget.upsertItem({ id: ITEM_ID, title, subtitle });
    }
}

function reportText(report: ScanReport): string {
    if (report.problem !== null) {
        return `The scan found nothing: ${report.problem}`;
    }
    const parts = [
        `the last scan found ${report.found} in ${formattedMiB(report.bytesSearched)} of heap, in ${report.ms} ms`,
        (report.bytesUnreadable !== 0) ? `${formattedMiB(report.bytesUnreadable)} could no longer be read` : null,
        (report.timeLimitMs !== null) ? `it stopped at its limit of ${report.timeLimitMs / 1000} s; Scan looks again` : null,
    ];
    const text = parts.filter(part => part !== null).join("; ");
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function formattedMiB(bytes: number): string {
    return `${(bytes / 1048576).toFixed(1)} MiB`;
}
