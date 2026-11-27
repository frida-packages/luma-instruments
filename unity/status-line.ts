type StatusWidget = CustomInstrumentWidgetMap["status"];

export type StatusTopic = "runtime" | "scenes" | "trace" | "calls" | "dump";

export class StatusLine {
    readonly #widget: StatusWidget;

    constructor(widget: StatusWidget) {
        this.#widget = widget;
        widget.clear();
    }

    note(topic: StatusTopic, title: string, subtitle?: string): void {
        this.#widget.upsertItem({ id: topic, title, subtitle });
    }

    forget(topic: StatusTopic): void {
        this.#widget.removeItem(topic);
    }
}
