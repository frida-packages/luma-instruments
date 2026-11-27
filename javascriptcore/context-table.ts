import type { Context, ContextObserver } from "./contexts.js";

type ContextsWidget = CustomInstrumentWidgetMap["contexts"];

export class ContextTable implements ContextObserver {
    readonly #widget: ContextsWidget;

    constructor(widget: ContextsWidget) {
        this.#widget = widget;
        widget.clear();
    }

    showScanning(scanning: boolean): void {
        this.#widget.setActionEnabled("scan", !scanning);
    }

    onContextChanged(context: Context): void {
        this.#widget.upsertRow({
            id: String(context.serial),
            cells: {
                number: String(context.serial),
                kind: context.kind,
                name: context.name ?? "",
                className: context.className,
                vm: String(context.vm.serial),
                runsOn: context.runsOn,
                inspectable: (context.inspectable === null) ? "" : context.inspectable ? "yes" : "no",
                status: context.destroyed ? "destroyed" : (context.discovery === "scan") ? "live" : "live, new",
            },
        });
    }

    onContextRemoved(context: Context): void {
        this.#widget.removeRow(String(context.serial));
    }
}
