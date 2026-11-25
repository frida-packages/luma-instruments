import type { AsarArchive } from "./asar-archive.js";
import type { ElectronBundle } from "./electron-bundle.js";
import type { ProcessRole } from "./process-role.js";
import type { RuntimeFacts } from "./runtime-link.js";

type FactsWidget = CustomInstrumentWidgetMap["facts"];

export class AppFacts {
    readonly #table: FactsWidget;

    constructor(table: FactsWidget) {
        this.#table = table;
        table.clear();
    }

    showProcess(role: ProcessRole): void {
        const parent = (role.kind !== "main") ? `, started by pid ${role.parentPid}` : "";
        this.#show("process", "Process", `${role.label}, pid ${role.pid}${parent}`);
        this.#show("argv", "Command line", role.argv.join(" "));
    }

    showBundle(bundle: ElectronBundle, archive: AsarArchive | null, appFolder: string | null): void {
        if (bundle.version !== null) {
            this.#show("electron", "Electron", bundle.version);
        }
        if (bundle.identifier !== null) {
            this.#show("identifier", "Bundle identifier", bundle.identifier);
        }
        this.#show("bundle", "Installed at", bundle.appPath);
        this.#show("packaging", "App code", packagingOf(archive, appFolder));
        if (archive !== null) {
            this.#show("integrity", "app.asar integrity", integrityOf(bundle, archive));
        }
        for (const fuse of bundle.fuses ?? []) {
            this.#show(`fuse-${fuse.name}`, `Fuse ${fuse.name}`, fuse.state);
        }
    }

    showAddons(): void {
        const addons = Process.enumerateModules().filter(module => module.path.endsWith(".node"));
        this.#show("addons", "Native addons", (addons.length !== 0) ? addons.map(module => module.path).join(", ") : "none loaded");
    }

    showRuntime(facts: RuntimeFacts): void {
        const { versions } = facts;
        this.#show("electron", "Electron", versions.electron ?? "—");
        this.#show("chrome", "Chromium", versions.chrome ?? "—");
        this.#show("node", "Node", versions.node);
        this.#show("v8", "V8", versions.v8);
        if (facts.mode === "main") {
            this.#showMainRuntime(facts);
        } else {
            this.#showRealmRuntime(facts);
        }
    }

    #showMainRuntime(facts: RuntimeFacts): void {
        const { app } = facts;
        this.#show("app", "App", `${app.name} ${app.version}`);
        this.#show("appPath", "App path", `${app.path}${app.packaged ? "" : " (not packaged)"}`);
        this.#show("entry", "Entry script", `${facts.entry ?? "—"}${facts.esmEntry ? " (ES module)" : ""}`);
        this.#show("userData", "User data", app.userData);
        this.#show("store", "Store build", facts.mas ? "Mac App Store" : (facts.windowsStore ? "Windows Store" : "no"));
        if (facts.execArgv.length !== 0) {
            this.#show("execArgv", "Node options", facts.execArgv.join(" "));
        }
        const switches = Object.entries<string>(facts.switches).map(([name, value]) => (value !== "") ? `--${name}=${value}` : `--${name}`);
        this.#show("switches", "Notable switches", (switches.length !== 0) ? switches.join(" ") : "none");
    }

    #showRealmRuntime(facts: RuntimeFacts): void {
        if (facts.location !== null) {
            this.#show("location", "Page", `${facts.title ?? ""} ${facts.location}`.trim());
        }
        if (facts.contextIsolated !== null) {
            this.#show("isolated", "Context isolated", String(facts.contextIsolated));
        }
    }

    #show(id: string, fact: string, value: string): void {
        this.#table.upsertRow({ id, cells: { fact, value } });
    }
}

function packagingOf(archive: AsarArchive | null, appFolder: string | null): string {
    if (archive !== null) {
        return `${archive.path} (${formatSize(archive.size)}, ${archive.entries.length} files)`;
    }
    return appFolder ?? "no app.asar or app folder in Resources";
}

function integrityOf(bundle: ElectronBundle, archive: AsarArchive): string {
    const declared = bundle.declaredIntegrity.get(archive.path);
    const enforced = bundle.fuses?.find(fuse => fuse.name === "EnableEmbeddedAsarIntegrityValidation")?.state === "on";
    const enforcement = enforced ? "enforced" : "not enforced";
    if (declared === undefined) {
        return `no hash declared, ${enforcement}; header SHA256 ${archive.headerHash}`;
    }
    const verdict = (declared.hash === archive.headerHash) ? "header hash matches" : `MISMATCH: declared ${declared.hash}, header is ${archive.headerHash}`;
    return `${verdict} (${declared.algorithm}), ${enforcement}`;
}

export function formatSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KiB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
