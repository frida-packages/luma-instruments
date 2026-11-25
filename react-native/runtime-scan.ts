import type { BundleCatalog } from "./bundles.js";
import type { AnchorRoute } from "./jsi-vtables.js";
import type { ModuleTable } from "./module-table.js";
import type { Platform } from "./platforms.js";
import type { Rendezvous } from "./rendezvous.js";
import { type ClassSearch, findRuntimeClasses } from "./runtime-classes.js";
import { findInstances } from "./runtime-instances.js";
import type { RuntimeTable } from "./runtime-table.js";
import type { RuntimeRegistry } from "./runtimes.js";
import type { ScanStatus } from "./scan-status.js";

const anchorRoutes: AnchorRoute[] = ["exports", "type names"];

export class RuntimeScan {
    readonly #registry: RuntimeRegistry;
    readonly #rendezvous: Rendezvous;
    readonly #platform: Platform;
    readonly #status: ScanStatus;
    readonly #table: RuntimeTable;
    readonly #bundles: BundleCatalog;
    readonly #modules: ModuleTable;
    #current: Promise<void> | null = null;
    #again = false;

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
        this.#current = this.#scan().finally(() => {
            this.#current = null;
            this.#table.showScanning(false);
            if (this.#again) {
                this.#again = false;
                void this.rescan();
            }
        });
        return this.#current;
    }

    async #scan(): Promise<void> {
        this.#status.note("Looking for JavaScript runtimes…");
        this.#modules.list(this.#platform.nativeModules());
        const search = await findRuntimeClasses(anchorRoutes);
        this.#rendezvous.watchClasses(search.classes);
        const instances = await findInstances(search.classes.map(runtimeClass => runtimeClass.vtable));
        for (const { address, vtable } of instances.instances) {
            const runtimeClass = search.classes.find(candidate => candidate.vtable.equals(vtable))!;
            this.#registry.admit(address, runtimeClass);
        }
        this.#rendezvous.explore();
        const bundles = await this.#bundles.scan();
        this.#status.note(summaryOf(search, this.#registry.all.length, bundles),
            `${formattedMiB(instances.bytesSearched)} of heap searched in ${instances.durationMs} ms; `
            + `${search.modulesSearched} modules looked at`);
    }
}

function summaryOf(search: ClassSearch, runtimes: number, bundles: number): string {
    if (search.classes.length === 0) {
        return (search.bases.length === 0)
            ? "No JSI runtime implementation was found in this process."
            : `JSI is linked into ${search.bases.map(base => base.module.name).join(", ")}, but no Hermes, JSC or V8 runtime class was found.`;
    }
    const classes = search.classes.map(runtimeClass =>
        `${runtimeClass.engine} in ${runtimeClass.base.module.name} (through ${runtimeClass.base.route})`);
    return `${runtimes} runtime${(runtimes === 1) ? "" : "s"} known; ${[...new Set(classes)].join(", ")}; `
        + `${bundles} new bundle${(bundles === 1) ? "" : "s"} found.`;
}

function formattedMiB(bytes: number): string {
    return `${(bytes / 1048576).toFixed(1)} MiB`;
}
