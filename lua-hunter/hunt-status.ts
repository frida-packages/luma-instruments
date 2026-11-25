type StatusWidget = CustomInstrumentWidgetMap["status"];

const statusItemId = "hunt";

export class HuntStatus {
    readonly #widget: StatusWidget;

    constructor(widget: StatusWidget) {
        this.#widget = widget;
        widget.clear();
    }

    note(text: string): void {
        this.#widget.upsertItem({ id: statusItemId, title: text });
    }

    fail(error: Error): void {
        this.#widget.upsertItem({ id: statusItemId, title: `Lua Hunter stopped: ${error.message}`, subtitle: error.stack });
    }
}
