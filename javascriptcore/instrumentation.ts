import { Buffer } from "buffer";
import { ContextConsole } from "./context-console.js";
import { ContextPages } from "./context-pages.js";
import { ContextSessions } from "./context-sessions.js";
import { ContextTable } from "./context-table.js";
import { type Context, ContextRegistry } from "./contexts.js";
import { ContextDiscovery } from "./discovery.js";
import { HeapStatistics } from "./heap-statistics.js";
import { JscApi } from "./jsc-api.js";
import { internalsOf } from "./jsc-internals.js";
import { Lanes } from "./lanes.js";
import { Profiler } from "./profiler.js";
import { ScriptLog, type ScriptRecord } from "./script-log.js";
import { ScriptTable } from "./script-table.js";
import type { StatusLine } from "./status-line.js";
import { VmTable } from "./vm-table.js";

type MainAction = CustomInstrumentActionMap[keyof CustomInstrumentActionMap];

const MOST_FILE_BYTES = 64 * 1048576;

export class Instrumentation {
    readonly #status: StatusLine;
    readonly #lanes = new Lanes();
    readonly #registry: ContextRegistry;
    readonly #contexts: ContextTable;
    readonly #discovery: ContextDiscovery;
    readonly #pages: ContextPages;
    readonly #sessions: ContextSessions;
    readonly #console: ContextConsole;
    readonly #heap: HeapStatistics;
    readonly #profiler: Profiler;
    readonly #scriptTable: ScriptTable;
    readonly #scripts: ScriptLog;

    constructor(ctx: CustomInstrumentContext, module: Module, status: StatusLine) {
        const api = new JscApi(module);
        this.#status = status;
        this.#registry = new ContextRegistry(api, this.#lanes);
        this.#contexts = new ContextTable(ctx.widget("contexts"));
        this.#pages = new ContextPages(ctx.children("context"));
        this.#registry.observeContexts(this.#contexts);
        this.#registry.observeContexts(this.#pages);
        this.#registry.observeContexts({ onContextChanged: () => status.refresh(), onContextRemoved: () => status.refresh() });
        this.#registry.observeVms(new VmTable(ctx.widget("vms")));
        this.#discovery = new ContextDiscovery(this.#registry, api, internalsOf(module), {
            onScanStarted: () => {
                this.#contexts.showScanning(true);
                status.showScanning();
            },
            onScanFinished: report => {
                this.#contexts.showScanning(false);
                status.showReport(report);
                void this.#heap.refreshAll();
            },
        });
        this.#sessions = new ContextSessions(api, {
            onSettled: (context, settlement) => this.#pages.showSettlement(context, settlement),
            onBusyChanged: context => this.#pages.showActivity(context, {
                running: this.#sessions.running(context),
                awaiting: this.#sessions.awaiting(context),
            }),
        });
        this.#console = new ContextConsole(this.#registry, this.#sessions);
        this.#heap = new HeapStatistics(api, this.#registry, ctx.widget("heap"));
        const hotFunctions = ctx.widget("profile");
        hotFunctions.clear();
        this.#profiler = new Profiler(api, this.#registry, { onHotFunctions: functions => hotFunctions.setHistogram(functions) });
        this.#scriptTable = new ScriptTable(ctx.widget("scripts"), this.#registry);
        this.#scripts = new ScriptLog(api, module, this.#scriptTable);
        status.watch(this.#registry);
    }

    start(settings: CustomInstrumentSettingMap): void {
        this.configure(settings);
        this.#discovery.start();
    }

    configure(settings: CustomInstrumentSettingMap): void {
        this.#scripts.configure(settings.logScripts, settings.sourceMegabytes);
    }

    act(action: MainAction, respond: CustomInstrumentActionResponder): Promise<void> | void {
        switch (action.widget) {
            case "contexts":
                return this.#actOnContexts(action, respond);
            case "vms":
                return this.#actOnVms(action);
            case "scripts":
                return this.#actOnScripts(action, respond);
            case "profile":
                return this.#profiler.clear();
        }
    }

    clearConsole(id: string): void {
        const context = this.#pages.contextOf(id);
        if (context !== undefined) {
            this.#pages.pageOf(context)?.widget("console").clear();
        }
    }

    async input(id: string, text: string, respond: CustomInstrumentConsoleResponder): Promise<void> {
        const context = this.#pages.contextOf(id);
        if (context === undefined) {
            respond.error("This context is no longer listed.");
            return;
        }
        await this.#console.run(context, text, respond);
    }

    async dispose(): Promise<void> {
        this.#discovery.dispose();
        this.#scripts.dispose();
        this.#scriptTable.dispose();
        await this.#profiler.dispose();
        await this.#sessions.dispose();
        this.#lanes.dispose();
    }

    #actOnContexts(action: CustomInstrumentActionMap["contexts"], respond: CustomInstrumentActionResponder): Promise<void> | void {
        if (action.action === "scan") {
            return this.#discovery.scan();
        }
        const context = this.#registry.contextNumbered(Number(action.item))!;
        switch (action.action) {
            case "show":
                return this.#show(context, respond);
            case "inspect":
            case "uninspect":
                return context.destroyed ? undefined : this.#discovery.setInspectable(context, action.action === "inspect");
        }
    }

    #show(context: Context, respond: CustomInstrumentActionResponder): Promise<void> {
        respond.show(this.#pages.show(context));
        return context.destroyed ? Promise.resolve() : this.#discovery.refresh(context);
    }

    async #actOnVms(action: CustomInstrumentActionMap["vms"]): Promise<void> {
        if (action.action === "refresh") {
            await this.#heap.refreshAll();
            return;
        }
        const vm = this.#registry.vmNumbered(Number(action.item))!;
        switch (action.action) {
            case "heap":
                await this.#heap.show(vm);
                break;
            case "profile":
                await this.#profiler.start(vm);
                break;
            case "unprofile":
                await this.#profiler.stop(vm);
                break;
        }
    }

    #actOnScripts(action: CustomInstrumentActionMap["scripts"], respond: CustomInstrumentActionResponder): void {
        if (action.action === "clear") {
            this.#scripts.clear();
            return;
        }
        const record = this.#scripts.recordNumbered(Number(action.item))!;
        if (record.source === null) {
            this.#status.note(`Script #${record.serial}'s source ${record.sourceDropped ? "is no longer kept" : "was never seen"}, so it cannot be exported.`);
            return;
        }
        const bytes = Buffer.from(record.source, "utf8");
        if (bytes.length > MOST_FILE_BYTES) {
            this.#status.note(`Script #${record.serial} is ${bytes.length} bytes as UTF-8, more than the 64 MiB a file can hold.`);
            return;
        }
        respond.file({ name: fileNameOf(record), mediaType: "text/javascript", bytes });
    }
}

function fileNameOf(record: ScriptRecord): string {
    const last = (record.url ?? "").split(/[/?#]/).filter(part => part.length !== 0).pop() ?? "";
    const plain = last.replace(/[^A-Za-z0-9._-]/g, "_");
    return (plain.length !== 0 && plain !== "." && plain !== "..") ? plain : `script-${record.serial}.js`;
}
