import { AppFacts } from "./app-facts.js";
import { ArchiveFiles } from "./archive-files.js";
import { AsarArchive } from "./asar-archive.js";
import { WebContentsView } from "./contents-view.js";
import { locateBundle } from "./electron-bundle.js";
import { IpcLog } from "./ipc-log.js";
import { MainConsole } from "./main-console.js";
import { identifyProcess, type ProcessRole } from "./process-role.js";
import { type Drained, RuntimeLink } from "./runtime-link.js";
import { Settings } from "./settings.js";
import { StatusLine } from "./status-line.js";

export const instrument: CustomInstrument = {
    create(ctx, config) {
        const settings = new Settings(config);
        const status = new StatusLine(ctx.widget("status"));
        const facts = new AppFacts(ctx.widget("facts"));
        const role = identifyProcess();
        facts.showProcess(role);
        const bundle = locateBundle();
        if (bundle === null) {
            status.note("process", "This process is not part of an Electron app",
                "No module in it carries both Node's N-API and Electron's fuse wire.");
            return {};
        }
        const archive = AsarArchive.open(`${bundle.resourcesPath}/app.asar`);
        const appFolder = (archive === null) ? folderOf(`${bundle.resourcesPath}/app`) : null;
        facts.showBundle(bundle, archive, appFolder);
        facts.showAddons();
        const files = new ArchiveFiles(ctx.widget("files"), archive, settings);
        let dropped = 0;
        let capturing = true;
        let unreachable: string | null = "This process's JavaScript has not run since the instrument was added.";
        const link = new RuntimeLink({ onDrained, onLinkFailed });
        const contents = new WebContentsView(ctx.widget("contents"), ctx.children("contents"), link);
        const ipc = new IpcLog(ctx.widget("ipc"), ctx.widget("message"), id => contents.label(id));
        const mainConsole = new MainConsole(ctx.widget("console"), link, files, () => unreachable);
        status.note("process", `The ${role.label} of ${bundle.appPath.slice(bundle.appPath.lastIndexOf("/") + 1)}`, guidanceFor(role));
        if (!RuntimeLink.supported) {
            unreachable = "frida-electron-bridge cannot reach the JavaScript of this Electron build.";
            status.note("javascript", "This app's JavaScript is out of reach", unreachable);
        } else if (!RuntimeLink.hasNodeEnvironment) {
            unreachable = noNodeReason(role);
            status.note("javascript", "No JavaScript of the app's runs in this process", unreachable);
        } else {
            connect();
        }

        return {
            updateConfig(next) {
                settings.apply(next);
                files.refilter();
                if (link.connected) {
                    link.configure(settings.captureOptions(capturing)).catch(error => {
                        status.note("faults", `The new settings did not reach the app: ${error.message}`, error.stack);
                    });
                }
            },
            async onAction(action, respond) {
                if (action.child !== undefined) {
                    contents.clear(Number(action.child.id));
                    return;
                }
                switch (action.widget) {
                    case "contents":
                        if (action.action === "show") {
                            respond.show(contents.pageOf(Number(action.item)));
                        } else {
                            await contents.openDevTools(Number(action.item), contents.pageOf(Number(action.item)));
                        }
                        break;
                    case "ipc":
                        await onIpcAction(action.action, action.item);
                        break;
                    case "message":
                        ipc.clearDetail();
                        break;
                    case "console":
                        mainConsole.clear();
                        break;
                    case "files":
                        if (action.action === "archive") {
                            files.exportArchive(respond.file, mainConsole.reportExport());
                        } else {
                            files.exportEntry(action.item, respond.file, mainConsole.reportExport());
                        }
                        break;
                }
            },
            async onConsoleInput(input, respond) {
                if (input.child !== undefined) {
                    await contents.handle(Number(input.child.id), input.text, respond);
                } else if (input.widget === "message") {
                    ipc.handleInput(input.text, respond);
                } else {
                    await mainConsole.handle(input.text, respond);
                }
            },
            async dispose() {
                contents.dispose();
                await link.dispose();
            },
        };

        function onDrained(drained: Drained): void {
            ipc.take(drained);
            contents.take(drained);
            if (drained.dropped !== 0) {
                dropped += drained.dropped;
                status.note("ipc", `${dropped} IPC message${(dropped === 1) ? "" : "s"} not recorded, over the cap of ${settings.ratePerSecond} a second`,
                    "Raise “Most IPC messages recorded per second”, or narrow “Only IPC channels matching”.");
            }
            if (drained.faults.length !== 0) {
                status.note("faults", `The IPC taps failed ${drained.faults.length} time${(drained.faults.length === 1) ? "" : "s"}; the app was left to carry on`,
                    drained.faults[0]);
            }
        }

        function onLinkFailed(error: Error): void {
            unreachable = `This process's JavaScript stopped answering: ${error.message}`;
            status.note("javascript", unreachable, error.stack);
        }

        function connect(): void {
            status.note("javascript", "Reaching this process's JavaScript…");
            link.connect(settings.captureOptions(capturing)).then(runtime => {
                unreachable = null;
                facts.showRuntime(runtime);
                const mode = runtime.mode as "main" | "realm";
                status.note("javascript", (mode === "main")
                    ? `Reached the main process's JavaScript: Electron ${runtime.versions.electron}, Node ${runtime.versions.node}`
                    : `Reached this ${role.label}'s Node environment: ${runtime.location ?? runtime.processType}`);
                mainConsole.announce(mode, (mode === "main")
                    ? "Main process reached. JavaScript typed here runs in it; :help says what is in scope."
                    : "This process's Node environment is reached. JavaScript typed here runs in it; :help says more.");
            }, error => {
                status.note("javascript", `Could not reach this process's JavaScript: ${error.message}`, error.stack);
            });
        }

        async function onIpcAction(action: "pause" | "resume" | "clear" | "inspect", item: string | undefined): Promise<void> {
            switch (action) {
                case "pause":
                case "resume":
                    capturing = action === "resume";
                    await link.configure(settings.captureOptions(capturing));
                    ipc.showPaused(!capturing);
                    break;
                case "clear":
                    ipc.clear();
                    dropped = 0;
                    status.forget("ipc");
                    break;
                case "inspect":
                    ipc.inspectRow(item!);
                    break;
            }
        }
    },
};

function folderOf(path: string): string | null {
    try {
        File.readAllText(`${path}/package.json`);
        return path;
    } catch (e) {
        return null;
    }
}

function guidanceFor(role: ProcessRole): string {
    switch (role.kind) {
        case "main":
            return "Windows, web contents, IPC and a console into every page are all here.";
        case "renderer":
            return `A renderer shows one page at a time. Its windows, IPC and page consoles are in the main process, pid ${role.parentPid}.`;
        default:
            return `This process only serves the app. Its windows, IPC and consoles are in the main process, pid ${role.parentPid}.`;
    }
}

function noNodeReason(role: ProcessRole): string {
    const where = `Add the instrument to the main process, pid ${role.parentPid}, for its windows, IPC and a console into every page.`;
    if (role.kind === "renderer") {
        return `This renderer is sandboxed, so only its page's own scripts run here, without Node. ${where}`;
    }
    return `No Node environment runs in the ${role.label}. ${where}`;
}
