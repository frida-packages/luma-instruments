import type { ChannelLog } from "./channel-log.js";
import { type FileReply, offerFile } from "./flutter-files.js";
import type { FlutterInspection } from "./flutter-inspection.js";
import type { FilesTable } from "./files-table.js";
import { inspectMessage } from "./message-inspector.js";

export interface Reply extends FileReply {
    value(value: unknown): void;
}

const MATCHES_SHOWN = 200;

const help = [
    "inspect N         decode message N in full",
    "packages          the packages whose libraries the snapshot names",
    "channels          the names in the snapshot that look like channels",
    "strings REGEX     the snapshot's strings that match",
    "libraries [REGEX] the libraries the VM service lists (debug and profile builds)",
    "save FILE         offer a file from the Files table, such as App or kernel_blob.bin",
].join("\n");

export class ConsoleCommands {
    readonly #log: ChannelLog;
    readonly #inspection: FlutterInspection;
    readonly #files: FilesTable;

    constructor(log: ChannelLog, inspection: FlutterInspection, files: FilesTable) {
        this.#log = log;
        this.#inspection = inspection;
        this.#files = files;
    }

    run(text: string, reply: Reply): void {
        const [command, ...rest] = text.trim().split(/\s+/);
        const argument = rest.join(" ");
        switch (command) {
            case "inspect":
                this.inspect(Number(argument.replace(/^#/, "")), reply);
                break;
            case "packages":
                this.#packages(reply);
                break;
            case "channels":
                this.#channelNames(reply);
                break;
            case "strings":
                this.#strings(argument, reply);
                break;
            case "libraries":
                this.#libraries(argument, reply);
                break;
            case "save":
                this.#save(argument, reply);
                break;
            default:
                reply.output(help);
        }
    }

    inspect(id: number, reply: Reply): void {
        const message = this.#log.message(id);
        if (message === undefined) {
            reply.error(`No message #${id} is kept; the last 2000 are.`);
            return;
        }
        inspectMessage(message, reply);
    }

    #packages(reply: Reply): void {
        const strings = this.#inspection.findings?.strings ?? null;
        if (strings === null) {
            reply.error("The snapshot has not been read yet.");
            return;
        }
        outputLines([...strings.packages].map(([name, libraries]) => `${name}: ${libraries} librar${(libraries === 1) ? "y" : "ies"}`), reply);
    }

    #channelNames(reply: Reply): void {
        const strings = this.#inspection.findings?.strings ?? null;
        if (strings === null) {
            reply.error("The snapshot has not been read yet.");
            return;
        }
        outputLines(strings.channelNames, reply);
    }

    #strings(pattern: string, reply: Reply): void {
        const strings = this.#inspection.findings?.strings ?? null;
        if (strings === null) {
            reply.error("The snapshot has not been read yet.");
            return;
        }
        const expression = new RegExp(pattern);
        const matches = [...new Set(strings.strings.filter(text => expression.test(text)))];
        outputLines(shownMatches(matches), reply);
    }

    #libraries(pattern: string, reply: Reply): void {
        const lookup = this.#inspection.findings?.vmService;
        if (lookup?.state !== "found" || lookup.service.unreachable !== null) {
            reply.error("No VM service has answered; release builds have none. `packages` lists what the snapshot names.");
            return;
        }
        const expression = new RegExp(pattern);
        const libraries = lookup.service.isolates.flatMap(isolate => isolate.libraries.map(uri => `${isolate.name}: ${uri}`));
        outputLines(shownMatches(libraries.filter(text => expression.test(text))), reply);
    }

    #save(name: string, reply: Reply): void {
        const file = this.#files.find(name) ?? this.#inspection.findings?.files.find(candidate => candidate.name === name);
        if (file === undefined) {
            reply.error(`No file ${name} in the Files table.`);
            return;
        }
        offerFile(file, reply);
    }
}

function outputLines(lines: string[], reply: Reply): void {
    for (const line of lines) {
        reply.output(line);
    }
}

function shownMatches(matches: string[]): string[] {
    const shown = matches.slice(0, MATCHES_SHOWN);
    return [...shown, (matches.length > MATCHES_SHOWN) ? `… and ${matches.length - MATCHES_SHOWN} more` : `${matches.length} found`];
}
