import type { Context, ContextRegistry } from "./contexts.js";
import { GlobalObjectLayout } from "./global-layout.js";
import { HeapSearch } from "./heap-search.js";
import type { JscApi } from "./jsc-api.js";
import type { JscInternals } from "./jsc-internals.js";

export interface ScanReport {
    found: number;
    bytesSearched: number;
    bytesUnreadable: number;
    ms: number;
    timeLimitMs: number | null;
    problem: string | null;
}

export interface DiscoveryObserver {
    onScanStarted(): void;
    onScanFinished(report: ScanReport): void;
}

const SCAN_TIME_LIMIT_MS = 60000;
const NAME_DELAY_MS = 1000;

export class ContextDiscovery {
    readonly #registry: ContextRegistry;
    readonly #api: JscApi;
    readonly #internals: JscInternals;
    readonly #observer: DiscoveryObserver;
    readonly #layout: GlobalObjectLayout;
    readonly #created: NativePointer[] = [];
    readonly #listeners: InvocationListener[] = [];
    readonly #timers = new Set<ReturnType<typeof setTimeout>>();
    #scanning: Promise<void> | null = null;

    constructor(registry: ContextRegistry, api: JscApi, internals: JscInternals, observer: DiscoveryObserver) {
        this.#registry = registry;
        this.#api = api;
        this.#internals = internals;
        this.#observer = observer;
        this.#layout = new GlobalObjectLayout(internals);
    }

    start(): void {
        const discovery = this;
        this.#listeners.push(Interceptor.attach(this.#internals.globalObjectInit, {
            onEnter(args) {
                discovery.#noteCreation(args[0]);
            },
        }));
        this.#listeners.push(Interceptor.attach(this.#internals.globalObjectDestructor, {
            onEnter(args) {
                discovery.#noteDestruction(args[0]);
            },
        }));
        void this.scan();
    }

    scan(): Promise<void> {
        this.#scanning ??= this.#scan().finally(() => {
            this.#scanning = null;
        });
        return this.#scanning;
    }

    refresh(context: Context): Promise<void> {
        return context.lane.run(() => context.destroyed ? null : {
            name: this.#api.nameOf(context.address),
            inspectable: this.#api.isInspectable(context.address),
        }).then(facts => {
            if (facts !== null) {
                context.name = facts.name;
                context.inspectable = facts.inspectable;
                this.#registry.changed(context);
            }
        });
    }

    setInspectable(context: Context, inspectable: boolean): Promise<void> {
        return context.lane.run(() => {
            if (!context.destroyed) {
                this.#api.setInspectable(context.address, inspectable);
            }
        }).then(() => this.refresh(context));
    }

    dispose(): void {
        for (const listener of this.#listeners) {
            listener.detach();
        }
        for (const timer of this.#timers) {
            clearTimeout(timer);
        }
    }

    async #scan(): Promise<void> {
        this.#observer.onScanStarted();
        const vtable = this.#internals.debuggableVtable;
        if (vtable === null) {
            this.#observer.onScanFinished({ found: 0, bytesSearched: 0, bytesUnreadable: 0, ms: 0, timeLimitMs: null,
                problem: "JSGlobalObjectDebuggable's vtable was not found, so only contexts made from now on are listed" });
            return;
        }
        const search = new HeapSearch(SCAN_TIME_LIMIT_MS);
        const globals = new Set<string>();
        for (const match of await search.findPointers([vtable])) {
            const global = this.#layout.globalObjectOf(match.address);
            if (global !== null && !globals.has(global.toString())) {
                globals.add(global.toString());
                this.#registry.admit(global, this.#layout.classChainOf(global), "scan");
            }
        }
        await Promise.all(this.#registry.contexts.filter(context => !context.destroyed).map(context => this.refresh(context)));
        this.#observer.onScanFinished({
            found: globals.size,
            bytesSearched: search.bytesSearched,
            bytesUnreadable: search.bytesUnreadable,
            ms: Date.now() - search.startedAt,
            timeLimitMs: search.timedOut ? search.timeLimitMs : null,
            problem: (globals.size === 0 && search.bytesSearched !== 0 && !this.#layout.learned)
                ? "no JSGlobalObjectDebuggable led to a global object whose class could be read" : null,
        });
    }

    #noteCreation(global: NativePointer): void {
        this.#created.push(global);
        if (this.#created.length === 1) {
            this.#later(() => this.#admitCreated(), 0);
        }
    }

    #noteDestruction(global: NativePointer): void {
        const pending = this.#created.findIndex(address => address.equals(global));
        if (pending !== -1) {
            this.#created.splice(pending, 1);
        }
        this.#registry.destroy(global);
    }

    #admitCreated(): void {
        for (const global of this.#created.splice(0)) {
            const context = this.#registry.admit(global, this.#layout.classChainOf(global), "creation");
            this.#later(() => void this.refresh(context), NAME_DELAY_MS);
        }
    }

    #later(work: () => void, delayMs: number): void {
        const timer = setTimeout(() => {
            this.#timers.delete(timer);
            work();
        }, delayMs);
        this.#timers.add(timer);
    }
}
