import { BundleCatalog, type OfferReply } from "./bundles.js";
import { JsiEvaluator } from "./jsi-evaluator.js";
import { ModuleTable } from "./module-table.js";
import { currentPlatform } from "./platforms.js";
import { Rendezvous } from "./rendezvous.js";
import type { WatchReply } from "./runtime-kit.js";
import { RuntimePages } from "./runtime-pages.js";
import { RuntimeScan } from "./runtime-scan.js";
import { RuntimeSessions } from "./runtime-sessions.js";
import { RuntimeTable } from "./runtime-table.js";
import { type Runtime, runtimeLabel, RuntimeRegistry } from "./runtimes.js";
import { ScanStatus } from "./scan-status.js";
import { Settings } from "./settings.js";
import { TrafficView } from "./traffic-view.js";

export const instrument: CustomInstrument = {
    create(ctx, config) {
        const settings = new Settings(config);
        const platform = currentPlatform();
        const status = new ScanStatus(ctx.widget("status"));
        const registry = new RuntimeRegistry();
        const table = new RuntimeTable(ctx.widget("runtimes"));
        const pages = new RuntimePages(ctx.children("runtime"), table, registry);
        const modules = new ModuleTable(ctx.widget("modules"));
        const traffic = new TrafficView(ctx.widget("traffic"), ctx.widget("detail"), settings, modules);
        const bundles = new BundleCatalog(ctx.widget("bundles"));
        const rendezvous = new Rendezvous(registry, new JsiEvaluator(), platform, {
            onOwnerLearned: runtime => sessions.onOwnerLearned(runtime),
            onRuntimeClosed: runtime => sessions.onRuntimeClosed(runtime),
        });
        const plan = {
            moduleNames: () => {
                const loaded = platform.loadedModuleNames();
                return modules.watchable().filter(name => settings.watchEveryModule || loaded.has(name));
            },
            loadedModuleNames: () => platform.knowsLoadedModules ? [...platform.loadedModuleNames()] : null,
            bridgeTable: () => platform.bridgeTable(),
        };
        const sessions = new RuntimeSessions(registry, rendezvous, settings, plan, {
            onTraffic: (runtime, drained) => traffic.add(runtime, drained),
            onSettled: (runtime, settlement) => pages.onSettled(runtime, settlement),
            onWatching: (runtime, reply) => traffic.note(watchingSummary(runtime, reply)),
        });
        const scan = new RuntimeScan(registry, rendezvous, platform, status, table, bundles, modules);
        registry.observe(table);
        registry.observe(pages);
        registry.observe({ onRuntimeAdded() {}, onRuntimeChanged: runtime => bundles.noteRuntime(runtime) });
        table.attach(pages);
        pages.attach(rendezvous, sessions, scan);
        scan.rescan().catch(error => status.fail(error));

        return {
            updateConfig(next) {
                settings.apply(next);
                sessions.applySettings();
            },
            onAction({ widget, action, item, child }, respond) {
                if (child !== undefined) {
                    const runtime = runtimeOf(child.id);
                    if (action === "clear") {
                        pages.clear(runtime);
                    } else {
                        offerBundleOf(runtime, { ...consoleReply(pages.pageOf(runtime)!.widget("console")), file: respond.file });
                    }
                    return;
                }
                const detail = { ...consoleReply(ctx.widget("detail")), file: respond.file };
                switch (widget) {
                    case "runtimes":
                        if (action === "scan") {
                            void scan.rescan();
                        } else if (action === "show") {
                            respond.show(pages.pageOf(runtimeOf(item!)));
                        } else {
                            offerBundleOf(runtimeOf(item!), detail);
                        }
                        break;
                    case "bundles":
                        bundles.offer(bundles.numbered(Number(item))!, detail);
                        break;
                    case "traffic":
                        if (action === "show") {
                            traffic.show(item!);
                        } else {
                            traffic.clearTable();
                        }
                        break;
                    case "detail":
                        traffic.clearDetail();
                        break;
                }
            },
            async onConsoleInput({ child, text }, respond) {
                if (child !== undefined) {
                    await pages.handle(runtimeOf(child.id), text, respond);
                } else {
                    traffic.run(text, respond);
                }
            },
            async dispose() {
                await sessions.dispose();
                rendezvous.dispose();
                platform.dispose();
                traffic.dispose();
                modules.dispose();
                table.dispose();
            },
        };

        function runtimeOf(id: string): Runtime {
            return registry.numbered(Number(id))!;
        }

        function offerBundleOf(runtime: Runtime, reply: OfferReply): void {
            const bundle = bundles.bundleOf(runtime);
            if (bundle === null) {
                const url = runtime.facts?.bundleURL;
                reply.error((url !== null && url !== undefined)
                    ? `${runtimeLabel(runtime)} loaded its bundle from ${url}, which is not a file in this process's reach; `
                        + "the Bundles table lists what was found in memory."
                    : `${runtimeLabel(runtime)} has not said where its bundle came from yet.`);
                return;
            }
            bundles.offer(bundle, reply);
        }
    },
};

function consoleReply(console: CustomInstrumentConsoleWidget): Pick<OfferReply, "output" | "error"> {
    return {
        output: text => console.appendOutput(text),
        error: text => console.appendError(text),
    };
}

function watchingSummary(runtime: Runtime, reply: WatchReply | string): string {
    if (typeof reply === "string") {
        return `${runtimeLabel(runtime)}: calls cannot be watched: ${reply}`;
    }
    const parts = [
        reply.bridge ? "the bridge's message queue" : null,
        reply.events ? "device events" : null,
        (reply.modules !== 0) ? `${reply.methods} methods of ${reply.modules} native modules` : null,
    ].filter(part => part !== null);
    return `${runtimeLabel(runtime)}: watching ${(parts.length !== 0) ? parts.join(", ") : "nothing; no native modules were reachable"}.`;
}
