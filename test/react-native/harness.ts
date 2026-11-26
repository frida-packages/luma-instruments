/// <reference path="./luma.d.ts" />

import { Buffer } from "buffer";
import { Writable } from "stream";
import { findJsiBase, slotEntries, structuralSlots } from "../../react-native/jsi-vtables.js";
import { instrument } from "../../react-native/main.js";
import { MemorySearch } from "../../react-native/memory-search.js";

type Reply = [kind: "output" | "error" | "value", payload: unknown];

interface Offer {
    name: string;
    mediaType: string;
    size: number;
    sha256: string;
}

const config: CustomInstrumentConfig = {
    settings: { captureTraffic: true, watchEveryModule: false, bytesPerCall: 2048, callsKept: 2000 },
};
const SETTLE_AFTER_DISPOSE_MS = 1500;
const pages = new Map<string, CustomInstrumentChildRow>();
const tables = new Map<string, Map<string, Record<string, string>>>();
const consoles = new Map<string, Reply[]>();
const scanStates: boolean[] = [];
let widgetLogging = false;
let shownPage: string | null = null;
let lastOffer: Promise<Offer> | null = null;

const ctx = {
    emit(value: unknown) {
        console.log("emit", printable(value));
    },
    widget: (id: string) => widgetProxy(id),
    children(template: string) {
        return {
            add(id: string, row: CustomInstrumentChildRow) {
                pages.set(id, row);
                return pageHandle(template, id);
            },
            get: (id: string) => pages.has(id) ? pageHandle(template, id) : undefined,
            ids: () => [...pages.keys()],
            remove(id: string) {
                pages.delete(id);
            },
        };
    },
} as unknown as CustomInstrumentContext;

const respond: CustomInstrumentActionResponder = {
    file: offerFile as CustomInstrumentOfferFile,
    show(child) {
        shownPage = child?.id ?? null;
    },
};

const pristine = snapshotEntryPoints();
let handle = await instrument.create(ctx, config, {} as CustomInstrumentRestoredState);

rpc.exports = {
    async waitForScan(): Promise<boolean[]> {
        while (!scanStates.includes(true)) {
            await sleep(20);
        }
        return scanStates;
    },
    pages(): string {
        return printable([...pages].map(([id, row]) => ({ id, ...row })));
    },
    rows(widget: string): string {
        return printable([...(tables.get(widget) ?? new Map())].map(([id, cells]) => ({ id, ...cells })));
    },
    consoleOf(widget: string): string {
        return printable(consoles.get(widget) ?? []);
    },
    async input(child: string | null, text: string): Promise<string> {
        const replies: Reply[] = [];
        const input = (child !== null)
            ? { child: { template: "runtime" as const, id: child }, widget: "console" as const, entryId: "input", text }
            : { widget: "detail" as const, entryId: "input", text };
        await handle.onConsoleInput!(input as CustomInstrumentConsoleInput, {
            output: text => replies.push(["output", text]),
            error: text => replies.push(["error", text]),
            value: value => replies.push(["value", value]),
            image: () => {},
            file: respond.file,
            show: respond.show,
        });
        return printable(replies);
    },
    async action(widget: string, action: string, item: string | null, child: string | null): Promise<string> {
        shownPage = null;
        lastOffer = null;
        const chosen: Record<string, unknown> = { widget, action };
        if (item !== null) {
            chosen.item = item;
        }
        if (child !== null) {
            chosen.child = { template: "runtime", id: child };
        }
        await handle.onAction!(chosen as CustomInstrumentAction, respond);
        const offer = (lastOffer !== null) ? await lastOffer : null;
        return printable({ shown: shownPage, offer });
    },
    scanStates(): boolean[] {
        return scanStates;
    },
    async configure(settings: Record<string, unknown>): Promise<void> {
        await handle.updateConfig!({ settings: { ...config.settings, ...settings } } as CustomInstrumentConfig);
    },
    slotRoutes(): string {
        const modules = Process.enumerateModules().filter(module => module.findExportByName("_ZTVN8facebook3jsi7RuntimeE") !== null
            || module.path === Process.mainModule.path);
        return printable(modules.map(module => {
            const exported = findJsiBase(module, ["exports"], new MemorySearch());
            const named = findJsiBase(module, ["type names"], new MemorySearch());
            return {
                module: module.name,
                exports: exported?.slots ?? null,
                typeNames: named?.slots ?? null,
                structuralFromExportedVtable: (exported !== null) ? structuralSlots(slotEntries(exported.vtable)) : null,
            };
        }));
    },
    logWidgets(enabled: boolean): void {
        widgetLogging = enabled;
    },
    async createAgain(settings: Record<string, unknown>): Promise<void> {
        pages.clear();
        scanStates.length = 0;
        handle = await instrument.create(ctx, { settings: { ...config.settings, ...settings } } as CustomInstrumentConfig,
            {} as CustomInstrumentRestoredState);
    },
    async dispose(): Promise<string[]> {
        await handle.dispose!();
        await sleep(SETTLE_AFTER_DISPOSE_MS);
        const current = snapshotEntryPoints();
        return [...pristine].map(([name, bytes]) => `${name} ${(current.get(name) === bytes) ? "restored" : "CHANGED"}`);
    },
};

function widgetProxy(id: string) {
    return new Proxy({}, {
        get(_target, method: string) {
            return (...args: unknown[]) => {
                record(id, method, args);
                if (widgetLogging) {
                    console.log(`widget ${id}.${method}`, printable(args));
                }
            };
        },
    });
}

function record(id: string, method: string, args: unknown[]): void {
    const table = tables.get(id) ?? new Map<string, Record<string, string>>();
    tables.set(id, table);
    const entries = consoles.get(id) ?? [];
    consoles.set(id, entries);
    switch (method) {
        case "upsertRow": {
            const row = args[0] as { id: string; cells: Record<string, string> };
            table.set(row.id, row.cells);
            break;
        }
        case "upsertItem": {
            const item = args[0] as { id: string; title: string; subtitle?: string };
            table.set(item.id, { title: item.title, subtitle: item.subtitle ?? "" });
            break;
        }
        case "clear":
            table.clear();
            entries.length = 0;
            break;
        case "appendOutput":
            entries.push(["output", args[0]]);
            break;
        case "appendError":
            entries.push(["error", args[0]]);
            break;
        case "appendValue":
            entries.push(["value", args[0]]);
            break;
        case "setActionEnabled":
            if (id === "runtimes" && args[0] === "scan") {
                scanStates.push(args[1] as boolean);
            }
            break;
    }
}

function pageHandle(template: string, id: string) {
    return {
        template,
        id,
        update(row: Partial<CustomInstrumentChildRow>) {
            pages.set(id, { ...pages.get(id)!, ...row });
        },
        widget: (widget: string) => widgetProxy(`${template}/${id}/${widget}`),
    };
}

function offerFile(file: { name: string; mediaType: string; bytes?: ArrayBuffer }): Writable | void {
    const chunks: Buffer[] = [];
    const sink = new Writable({
        write(chunk: Buffer, _encoding, callback) {
            chunks.push(chunk);
            callback();
        },
    });
    lastOffer = new Promise(resolve => sink.on("finish", () => {
        const all = Buffer.concat(chunks);
        const bytes = all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) as ArrayBuffer;
        resolve({ name: file.name, mediaType: file.mediaType, size: all.byteLength, sha256: Checksum.compute("sha256", bytes) });
    }));
    return sink;
}

function snapshotEntryPoints(): Map<string, string> {
    const snapshot = new Map<string, string>();
    for (const module of Process.enumerateModules()) {
        if (module.findExportByName("_ZTVN8facebook3jsi7RuntimeE") === null && module.path !== Process.mainModule.path) {
            continue;
        }
        for (const range of module.enumerateRanges("r-x")) {
            snapshot.set(`${module.name}@${range.base}`, Checksum.compute("sha256", range.base.readByteArray(range.size)!));
        }
    }
    return snapshot;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function printable(value: unknown): string {
    return JSON.stringify(value, (_key, item) => {
        if (item instanceof NativePointer || item instanceof Int64 || item instanceof UInt64) {
            return item.toString();
        }
        return item;
    });
}
