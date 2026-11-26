import type { BundleCatalog } from "./bundles.js";
import type { AnchorRoute } from "./jsi-vtables.js";
import { MemorySearch } from "./memory-search.js";
import type { ModuleTable } from "./module-table.js";
import type { Platform } from "./platforms.js";
import type { Rendezvous } from "./rendezvous.js";
import { type ClassSearch, findRuntimeClasses } from "./runtime-classes.js";
import { findInstances } from "./runtime-instances.js";
import type { RuntimeTable } from "./runtime-table.js";
import type { RuntimeRegistry } from "./runtimes.js";
import type { ScanStatus } from "./scan-status.js";

const anchorRoutes: AnchorRoute[] = ["exports", "type names"];
const SCAN_TIME_LIMIT_MS = 60000;

export class RuntimeScan {
    readonly #registry: RuntimeRegistry;
    readonly #rendezvous: Rendezvous;
    readonly #platform: Platform;
    readonly #status: ScanStatus;
    readonly #table: RuntimeTable;
    readonly #bundles: BundleCatalog;
    readonly #modules: ModuleTable;
    #current: Promise<void> | null = null;
    #search: MemorySearch | null = null;
    #again = false;
    #disposed = false;

    constructor(registry: RuntimeRegistry, rendezvous: Rendezvous, platform: Platform, status: ScanStatus, table: RuntimeTable,
        bundles: BundleCatalog, modules: ModuleTable) {
        this.#registry = registry;
        this.#rendezvous = rendezvous;
        this.#platform = platform;
        this.#status = status;
        this.#table = table;
        this.#bundles = bundles;
        this.#modules = modules;
    }

    rescan(): Promise<void> {
        if (this.#current !== null) {
            this.#again = true;
            return this.#current;
        }
        this.#table.showScanning(true);
        const search = new MemorySearch(SCAN_TIME_LIMIT_MS);
        this.#search = search;
        this.#current = this.#scan(search).finally(() => {
            this.#current = null;
            this.#search = null;
            this.#table.showScanning(false);
            if (this.#again && !this.#disposed) {
                this.#again = false;
                void this.rescan();
            }
        });
        return this.#current;
    }

    stop(): void {
        this.#again = false;
        this.#search?.stop("Stop Scan was pressed");
    }

    dispose(): void {
        this.#disposed = true;
        this.#again = false;
        this.#search?.stop("the instrument was removed");
    }

    async #scan(search: MemorySearch): Promise<void> {
        this.#status.note("Looking for JavaScript runtimes…");
        const modules = await this.#platform.nativeModules(search);
        if (this.#disposed) {
            return;
        }
        this.#modules.list(modules);
        const classes = await findRuntimeClasses(anchorRoutes, search);
        if (this.#disposed) {
            return;
        }
        this.#rendezvous.watchClasses(classes.classes);
        const instances = await findInstances(classes.classes.map(runtimeClass => runtimeClass.vtable), search);
        if (this.#disposed) {
            return;
        }
        for (const { address, vtable } of instances) {
            const runtimeClass = classes.classes.find(candidate => candidate.vtable.equals(vtable))!;
            this.#registry.admit(address, runtimeClass);
        }
        this.#rendezvous.explore();
        const bundles = await this.#bundles.scan(search);
        if (this.#disposed) {
            return;
        }
        this.#status.note(summaryOf(classes, search, this.#registry.all.length, bundles), detailOf(search, classes));
    }
}

function summaryOf(classes: ClassSearch, search: MemorySearch, runtimes: number, bundles: number): string {
    if (search.stopReason !== null) {
        return `The scan stopped before it finished; ${runtimes} runtime${(runtimes === 1) ? "" : "s"} known, `
            + `${bundles} new bundle${(bundles === 1) ? "" : "s"} found.`;
    }
    if (classes.classes.length === 0) {
        return (classes.bases.length === 0)
            ? "No JSI runtime implementation was found in this process."
            : `JSI is linked into ${classes.bases.map(base => base.module.name).join(", ")}, but no Hermes, JSC or V8 runtime class was found.`;
    }
    const found = classes.classes.map(runtimeClass =>
        `${runtimeClass.engine} in ${runtimeClass.base.module.name} (through ${runtimeClass.base.route})`);
    return `${runtimes} runtime${(runtimes === 1) ? "" : "s"} known; ${[...new Set(found)].join(", ")}; `
        + `${bundles} new bundle${(bundles === 1) ? "" : "s"} found.`;
}

function detailOf(search: MemorySearch, classes: ClassSearch): string {
    const parts = [
        `${formattedMiB(search.bytesSearched)} searched in ${Date.now() - search.startedAt} ms`,
        `${classes.modulesSearched} modules looked at`,
        (search.bytesUnreadable !== 0) ? `${formattedMiB(search.bytesUnreadable)} could no longer be read and was skipped` : null,
        (search.candidatesRejected !== 0)
            ? `${search.candidatesRejected} pointer${(search.candidatesRejected === 1) ? "" : "s"} to a known class not at the start of a live object, skipped`
            : null,
        (search.stopReason !== null) ? `stopped early because ${search.stopReason}; Scan looks again` : null,
    ];
    return parts.filter(part => part !== null).join("; ");
}

function formattedMiB(bytes: number): string {
    return `${(bytes / 1048576).toFixed(1)} MiB`;
}
