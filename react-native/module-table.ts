import type { NativeModuleInfo } from "./platforms.js";
import type { CallCounter } from "./traffic-view.js";

type ModuleTableWidget = CustomInstrumentWidgetMap["modules"];

interface Row {
    info: NativeModuleInfo;
    listed: boolean;
    calls: number;
}

const FLUSH_DELAY_MS = 500;
const missing = "—";

export class ModuleTable implements CallCounter {
    readonly #table: ModuleTableWidget;
    readonly #rows = new Map<string, Row>();
    readonly #changed = new Set<Row>();
    #pendingFlush: ReturnType<typeof setTimeout> | null = null;

    constructor(table: ModuleTableWidget) {
        this.#table = table;
        table.clear();
    }

    watchable(): string[] {
        return [...this.#rows.values()]
            .filter(({ listed, info }) => listed && !info.base
                && (info.kind === "native module" || info.kind === "TurboModule"))
            .map(row => row.info.name);
    }

    list(modules: NativeModuleInfo[]): void {
        for (const info of modules) {
            const row = this.#rows.get(info.name) ?? { info, listed: true, calls: 0 };
            row.info = info;
            row.listed = true;
            this.#rows.set(info.name, row);
            this.#changed.add(row);
        }
        this.#scheduleFlush();
    }

    count(module: string): void {
        let row = this.#rows.get(module);
        if (row === undefined) {
            row = { info: { name: module, kind: "native module", className: missing, methods: 0, base: false }, listed: false, calls: 0 };
            this.#rows.set(module, row);
        }
        row.calls++;
        this.#changed.add(row);
        this.#scheduleFlush();
    }

    dispose(): void {
        if (this.#pendingFlush !== null) {
            clearTimeout(this.#pendingFlush);
            this.#flush();
        }
    }

    #scheduleFlush(): void {
        this.#pendingFlush ??= setTimeout(() => this.#flush(), FLUSH_DELAY_MS);
    }

    #flush(): void {
        this.#pendingFlush = null;
        for (const { info, listed, calls } of this.#changed) {
            this.#table.upsertRow({
                id: info.name,
                cells: {
                    module: info.name,
                    kind: listed ? info.kind : "seen in traffic",
                    className: info.className,
                    methods: (info.methods !== 0) ? String(info.methods) : missing,
                    calls: String(calls),
                },
            });
        }
        this.#changed.clear();
    }
}
