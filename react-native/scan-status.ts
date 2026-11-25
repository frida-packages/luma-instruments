type StatusWidget = CustomInstrumentWidgetMap["status"];

const statusItemId = "scan";

export class ScanStatus {
    readonly #widget: StatusWidget;

    constructor(widget: StatusWidget) {
        this.#widget = widget;
        widget.clear();
    }

    note(text: string, detail?: string): void {
        this.#widget.upsertItem({ id: statusItemId, title: text, subtitle: detail });
    }

    fail(error: Error): void {
        this.#widget.upsertItem({ id: statusItemId, title: `React Native stopped: ${error.message}`, subtitle: error.stack });
    }
}
