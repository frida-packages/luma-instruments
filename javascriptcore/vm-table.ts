import type { Vm, VmObserver } from "./contexts.js";

type VmsWidget = CustomInstrumentWidgetMap["vms"];

export class VmTable implements VmObserver {
    readonly #widget: VmsWidget;

    constructor(widget: VmsWidget) {
        this.#widget = widget;
        widget.clear();
    }

    onVmChanged(vm: Vm): void {
        const statistics = vm.statistics;
        this.#widget.upsertRow({
            id: String(vm.serial),
            cells: {
                number: String(vm.serial),
                contexts: String(vm.live.length),
                heap: (statistics !== null) ? formattedMiB(statistics.heapCapacity + statistics.extraMemorySize) : "",
                objects: (statistics !== null) ? String(Object.values(statistics.objectTypeCounts).reduce((sum, count) => sum + count, 0)) : "",
                globals: (statistics !== null) ? String(statistics.globalObjectCount) : "",
                profiler: vm.profiling ? "sampling" : (vm.samples !== 0) ? "stopped" : "",
                samples: (vm.samples !== 0) ? String(vm.samples) : "",
            },
        });
    }

    onVmRemoved(vm: Vm): void {
        this.#widget.removeRow(String(vm.serial));
    }
}

function formattedMiB(bytes: number): string {
    return `${(bytes / 1048576).toFixed(1)} MiB`;
}
