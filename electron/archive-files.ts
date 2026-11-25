import { formatSize } from "./app-facts.js";
import type { AsarArchive, AsarEntry } from "./asar-archive.js";
import type { Settings } from "./settings.js";

type FilesWidget = CustomInstrumentWidgetMap["files"];
type OfferFile = CustomInstrumentOfferFile;

export interface ExportReport {
    output(text: string): void;
    error(text: string): void;
}

const LARGEST_FILE_BYTES = 64 * 1024 * 1024;
const ROW_LIMIT = 1000;
const moreRowId = "…";
const mediaTypes: { [extension: string]: string } = {
    js: "text/javascript",
    cjs: "text/javascript",
    mjs: "text/javascript",
    json: "application/json",
    html: "text/html",
    css: "text/css",
    txt: "text/plain",
    map: "application/json",
    png: "image/png",
    svg: "image/svg+xml",
};

export class ArchiveFiles {
    readonly #table: FilesWidget;
    readonly #archive: AsarArchive | null;
    readonly #settings: Settings;

    constructor(table: FilesWidget, archive: AsarArchive | null, settings: Settings) {
        this.#table = table;
        this.#archive = archive;
        this.#settings = settings;
        table.setActionEnabled("archive", archive !== null);
        this.refilter();
    }

    refilter(): void {
        this.#table.clear();
        if (this.#archive === null) {
            return;
        }
        const pattern = (this.#settings.archivePaths !== null) ? new RegExp(this.#settings.archivePaths) : null;
        const shown = this.#archive.entries.filter(entry => pattern === null || pattern.test(entry.path));
        for (const entry of shown.slice(0, ROW_LIMIT - 1)) {
            this.#table.upsertRow({ id: entry.path, cells: cellsOf(entry) });
        }
        if (shown.length >= ROW_LIMIT) {
            const hidden = shown.length - (ROW_LIMIT - 1);
            this.#table.upsertRow({ id: moreRowId, cells: { path: `… ${hidden} more; narrow “Only list app.asar files matching”`, size: "", where: "" } });
        }
    }

    exportArchive(offer: OfferFile, report: ExportReport): void {
        const archive = this.#archive!;
        if (archive.size > LARGEST_FILE_BYTES) {
            report.error(`${archive.path} is ${formatSize(archive.size)}, more than the ${formatSize(LARGEST_FILE_BYTES)} a file offered for saving can be. `
                + "Export the files you need from the app.asar table, or :save them from the console.");
            return;
        }
        const file = offer({ name: "app.asar", mediaType: "application/octet-stream" });
        archive.copyTo(file).then(() => {
            report.output(`Offered ${archive.path} (${formatSize(archive.size)}) for saving.`);
        }, error => {
            report.error(`Reading ${archive.path} failed: ${error.message}`);
        });
    }

    exportEntry(path: string, offer: OfferFile, report: ExportReport): void {
        if (this.#archive === null) {
            report.error("This app has no app.asar.");
            return;
        }
        const entry = this.#archive.find(path);
        if (entry === undefined) {
            report.error(`app.asar has no file ${path}.`);
            return;
        }
        if (entry.size > LARGEST_FILE_BYTES) {
            report.error(`${path} is ${formatSize(entry.size)}, more than the ${formatSize(LARGEST_FILE_BYTES)} a file offered for saving can be.`);
            return;
        }
        const name = path.slice(path.lastIndexOf("/") + 1);
        offer({ name, mediaType: mediaTypeOf(name), bytes: this.#archive.read(entry) });
        report.output(`Offered ${path} (${formatSize(entry.size)}) from app.asar for saving as ${name}.`);
    }
}

function cellsOf(entry: AsarEntry) {
    return {
        path: entry.path,
        size: formatSize(entry.size),
        where: entry.unpacked ? "app.asar.unpacked" : (entry.executable ? "packed, executable" : "packed"),
    };
}

function mediaTypeOf(name: string): string {
    const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
    return mediaTypes[extension] ?? "application/octet-stream";
}
