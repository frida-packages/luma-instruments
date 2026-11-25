import type { TrafficTotals } from "./channel-log.js";
import type { Findings } from "./flutter-inspection.js";

type StatusWidget = CustomInstrumentWidgetMap["status"];
type StatusItem = Parameters<StatusWidget["upsertItem"]>[0];

const REFRESH_DELAY_MS = 500;
const ITEM_ID = "status";

export class StatusLine {
    readonly #widget: StatusWidget;
    #findings: Findings | null = null;
    #totals: TrafficTotals = { messages: 0, unshown: 0, engines: 0 };
    #problem: string | null = null;
    #shown = "";
    #pendingRefresh: ReturnType<typeof setTimeout> | null = null;

    constructor(widget: StatusWidget) {
        this.#widget = widget;
        this.#render();
    }

    showFindings(findings: Findings): void {
        this.#findings = findings;
        this.#scheduleRefresh();
    }

    showTotals(totals: TrafficTotals): void {
        this.#totals = totals;
        this.#scheduleRefresh();
    }

    showProblem(problem: string): void {
        this.#problem = problem;
        this.#scheduleRefresh();
    }

    dispose(): void {
        if (this.#pendingRefresh !== null) {
            clearTimeout(this.#pendingRefresh);
        }
    }

    #scheduleRefresh(): void {
        this.#pendingRefresh ??= setTimeout(() => {
            this.#pendingRefresh = null;
            this.#render();
        }, REFRESH_DELAY_MS);
    }

    #render(): void {
        const item = itemOf(this.#findings, this.#totals, this.#problem);
        const text = JSON.stringify(item);
        if (text !== this.#shown) {
            this.#shown = text;
            this.#widget.upsertItem(item);
        }
    }
}

function itemOf(findings: Findings | null, totals: TrafficTotals, problem: string | null): StatusItem {
    if (findings === null) {
        return { id: ITEM_ID, title: "Waiting for a Flutter engine to load", subtitle: "FlutterMacOS, Flutter, libflutter.so, libflutter_linux_gtk.so or flutter_windows.dll" };
    }
    const dart = findings.engineFacts.dartVersion?.split(" ")[0];
    const title = [`Flutter on ${findings.platform.name}`, (dart !== undefined) ? `Dart ${dart}` : null, findings.snapshot?.build ?? null]
        .filter(part => part !== null)
        .join(" · ");
    return { id: ITEM_ID, title, subtitle: problem ?? trafficText(findings, totals) };
}

function trafficText(findings: Findings, totals: TrafficTotals): string {
    if (!findings.channels.watching) {
        return findings.channels.how;
    }
    const unshown = (totals.unshown !== 0) ? `, ${totals.unshown} only counted (over the messages shown per second)` : "";
    const engines = (totals.engines > 1) ? ` across ${totals.engines} engines` : "";
    return `${totals.messages} channel messages${engines}${unshown}`;
}
