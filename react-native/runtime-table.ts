import {
    architectureLabel,
    buildLabel,
    bundleLabel,
    engineLabel,
    reactNativeLabel,
    threadLabel,
} from "./runtime-descriptions.js";
import type { Runtime, RuntimeObserver } from "./runtimes.js";

type RuntimeTableWidget = CustomInstrumentWidgetMap["runtimes"];

export interface RuntimeStatus {
    statusOf(runtime: Runtime): string;
}

const FLUSH_DELAY_MS = 100;

export class RuntimeTable implements RuntimeObserver {
    readonly #table: RuntimeTableWidget;
    readonly #changed = new Set<Runtime>();
    #pendingFlush: ReturnType<typeof setTimeout> | null = null;
    #status!: RuntimeStatus;

    constructor(table: RuntimeTableWidget) {
        this.#table = table;
        table.clear();
    }

    attach(status: RuntimeStatus): void {
        this.#status = status;
    }

    showScanning(scanning: boolean): void {
        this.#table.setActionEnabled("scan", !scanning);
    }

    onRuntimeAdded(runtime: Runtime): void {
        this.show(runtime);
    }

    onRuntimeChanged(runtime: Runtime): void {
        this.show(runtime);
    }

    show(runtime: Runtime): void {
        this.#changed.add(runtime);
        this.#pendingFlush ??= setTimeout(() => this.#flush(), FLUSH_DELAY_MS);
    }

    dispose(): void {
        if (this.#pendingFlush !== null) {
            clearTimeout(this.#pendingFlush);
            this.#flush();
        }
    }

    #flush(): void {
        this.#pendingFlush = null;
        for (const runtime of this.#changed) {
            this.#table.upsertRow({ id: String(runtime.number), cells: this.#cellsOf(runtime) });
        }
        this.#changed.clear();
    }

    #cellsOf(runtime: Runtime) {
        const { facts } = runtime;
        return {
            number: `#${runtime.number}`,
            engine: engineLabel(runtime),
            reactNative: reactNativeLabel(facts),
            architecture: architectureLabel(facts),
            build: buildLabel(facts),
            bundle: bundleLabel(facts),
            thread: threadLabel(runtime),
            status: this.#status.statusOf(runtime),
        };
    }
}
