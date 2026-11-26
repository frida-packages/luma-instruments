import type { ArchiveFiles } from "./archive-files.js";
import { report } from "./contents-view.js";
import type { RuntimeLink } from "./runtime-link.js";

type ConsoleWidget = CustomInstrumentWidgetMap["console"];
type Responder = CustomInstrumentConsoleResponder;

export type Reachability = () => string | null;

const mainHelpLines = [
    "JavaScript typed here runs in the main process, on its event loop; a promise it evaluates to is awaited, and _ is the last value.",
    "await itself works only inside an async function, such as (async () => await app.whenReady())().",
    "In scope: require (the app's own), electron, app, BrowserWindow, webContents, webFrameMain, ipcMain, session, protocol, dialog, shell.",
    "var declarations last for one input only; keep things on globalThis to use them later.",
    ":save <path>     offer a file from app.asar for saving, such as :save package.json",
    ":help            show this",
];

const realmHelpLines = [
    "JavaScript typed here runs in this process's Node environment; a promise it evaluates to is awaited, and _ is the last value.",
    "await itself works only inside an async function, such as (async () => await require('fs').promises.readdir('.'))().",
    ":save <path>     offer a file from app.asar for saving, such as :save package.json",
    ":help            show this",
];

export class MainConsole {
    readonly #widget: ConsoleWidget;
    readonly #link: RuntimeLink;
    readonly #files: ArchiveFiles;
    readonly #unreachable: Reachability;
    #mode: "main" | "realm" = "main";

    constructor(widget: ConsoleWidget, link: RuntimeLink, files: ArchiveFiles, unreachable: Reachability) {
        this.#widget = widget;
        this.#link = link;
        this.#files = files;
        this.#unreachable = unreachable;
        widget.clear();
    }

    announce(mode: "main" | "realm", text: string): void {
        this.#mode = mode;
        this.#widget.appendOutput(text);
    }

    async handle(text: string, respond: Responder): Promise<void> {
        const trimmed = text.trim();
        if (trimmed === ":help") {
            ((this.#mode === "main") ? mainHelpLines : realmHelpLines).forEach(line => respond.output(line));
            return;
        }
        if (trimmed.startsWith(":save ")) {
            this.#files.exportEntry(trimmed.slice(":save ".length).trim().replace(/^\//, ""), respond.file, respond);
            return;
        }
        if (trimmed.startsWith(":")) {
            respond.error(`Unknown directive ${trimmed.split(/\s/)[0]}. :help lists them.`);
            return;
        }
        const reason = this.#unreachable();
        if (reason !== null) {
            respond.error(reason);
            return;
        }
        report(await this.#link.evaluate(text), respond);
    }

    reportExport(): { output(text: string): void; error(text: string): void } {
        return {
            output: text => this.#widget.appendOutput(text),
            error: text => this.#widget.appendError(text),
        };
    }

    clear(): void {
        this.#widget.clear();
    }
}
