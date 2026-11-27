import type { ContextRegistry, MemoryStatistics, Vm } from "./contexts.js";
import type { JscApi } from "./jsc-api.js";

type HeapWidget = CustomInstrumentWidgetMap["heap"];

const TYPES_SHOWN = 40;

export class HeapStatistics {
    readonly #api: JscApi;
    readonly #registry: ContextRegistry;
    readonly #widget: HeapWidget;

    constructor(api: JscApi, registry: ContextRegistry, widget: HeapWidget) {
        this.#api = api;
        this.#registry = registry;
        this.#widget = widget;
        widget.clear();
    }

    async show(vm: Vm): Promise<void> {
        const statistics = await this.refresh(vm);
        if (statistics === null) {
            return;
        }
        this.#widget.setHistogram(Object.entries(statistics.objectTypeCounts)
            .map(([label, count]) => ({ label, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, TYPES_SHOWN));
    }

    refreshAll(): Promise<unknown> {
        return Promise.all(this.#registry.vms.map(vm => this.refresh(vm)));
    }

    async refresh(vm: Vm): Promise<MemoryStatistics | null> {
        const text = await vm.lane.run(() => {
            const context = vm.live[0];
            return (context !== undefined) ? this.#api.memoryStatistics(context.address) : null;
        });
        if (text === null) {
            return null;
        }
        vm.statistics = JSON.parse(text) as MemoryStatistics;
        this.#registry.vmChanged(vm);
        return vm.statistics;
    }
}
