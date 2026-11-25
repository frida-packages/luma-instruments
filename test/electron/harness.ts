/// <reference path="./luma.d.ts" />

import { Writable } from "stream";
import { instrument } from "../../electron/main.js";
import Electron from "../../electron/node_modules/frida-electron-bridge/dist/index.js";

type Reply = [kind: "output" | "error" | "value", payload: unknown];

interface WidgetState {
    rows: Map<string, Record<string, string>>;
    items: Map<string, unknown>;
    entries: Array<[string, unknown]>;
    disabled: Set<string>;
    calls: number;
}

interface Offered {
    name: string;
    mediaType: string;
    size: number;
    sha256: string;
    head: string;
}

const defaultSettings = { ratePerSecond: 200, maxChars: 4096, archivePaths: "^(?!(.*/)?node_modules/)" };
const tapsProbe = `(() => {
    const require = process.mainModule ? process.mainModule.require.bind(process.mainModule) : process.getBuiltinModule("module").createRequire(process.execPath);
    const electron = require("electron");
    const own = (object, name) => Object.prototype.hasOwnProperty.call(object, name);
    const contentsPrototype = process._linkedBinding("electron_browser_web_contents").WebContents.prototype;
    const framePrototype = process._linkedBinding("electron_browser_web_frame_main").WebFrameMain.prototype;
    const all = electron.webContents.getAllWebContents();
    return JSON.stringify({
        shim: Symbol.for("re.frida.luma.electron") in globalThis,
        ipcMainEmit: own(electron.ipcMain, "emit"),
        mapSet: own(electron.ipcMain._invokeHandlers, "set") || all.some(c => own(c.ipc._invokeHandlers, "set")),
        handlers: [...electron.ipcMain._invokeHandlers.values()].concat(...all.map(c => [...c.ipc._invokeHandlers.values()])).map(f => String(f)),
        senders: [contentsPrototype.send, contentsPrototype.sendToFrame, contentsPrototype.postMessage, framePrototype.send, framePrototype.postMessage].map(f => String(f)),
        listeners: Object.fromEntries(all.map(c => [c.id, ["ipc-message-sync", "render-process-gone", "unresponsive", "responsive", "did-start-loading", "destroyed"].map(n => c.listenerCount(n)).join("/")])),
    });
})()`;
const rowCaps: { [widget: string]: number } = { ipc: 1000, files: 1000, contents: 256 };
const widgets = new Map<string, WidgetState>();
const pages = new Map<string, CustomInstrumentChildRow>();
const offered: Offered[] = [];
let shown: string | null | undefined;

const ctx = {
    emit(value: unknown) {
        console.log("emit", JSON.stringify(value));
    },
    widget: (id: string) => widgetHandle(id),
    children(template: string) {
        return {
            add(id: string, row: CustomInstrumentChildRow) {
                pages.set(id, row);
                return pageHandle(template, id);
            },
            get: (id: string) => pages.has(id) ? pageHandle(template, id) : undefined,
            ids: () => [...pages.keys()],
            remove(id: string) {
                if (!pages.delete(id)) {
                    throw new Error(`there is no child ${id}`);
                }
            },
        };
    },
} as unknown as CustomInstrumentContext;

const pristine = targetTaps();
const startedAt = Date.now();
const handle = await instrument.create(ctx, { settings: defaultSettings } as CustomInstrumentConfig, {} as CustomInstrumentRestoredState);
console.log(`created in ${Date.now() - startedAt} ms`);

rpc.exports = {
    state(): string {
        return JSON.stringify({
            widgets: Object.fromEntries([...widgets].map(([id, state]) => [id, {
                rows: [...state.rows].map(([rowId, cells]) => ({ id: rowId, ...cells })),
                items: [...state.items.values()],
                entries: state.entries,
                disabled: [...state.disabled],
                calls: state.calls,
            }])),
            pages: [...pages].map(([id, row]) => ({ id, ...row })),
            offered,
        }, printable);
    },
    async input(widget: string, child: string | null, text: string): Promise<string> {
        const replies: Reply[] = [];
        const input = (child !== null)
            ? { child: { template: "contents" as const, id: child }, widget: "console" as const, entryId: "input", text }
            : { widget: widget as "console", entryId: "input", text };
        await handle.onConsoleInput!(input, {
            output: line => replies.push(["output", line]),
            error: line => replies.push(["error", line]),
            value: value => replies.push(["value", value]),
            image: () => {},
            file: offerFile as CustomInstrumentOfferFile,
            show: page => {
                shown = page?.id ?? null;
            },
        });
        return JSON.stringify(replies, printable);
    },
    async action(widget: string, action: string, item: string | null, child: string | null): Promise<string> {
        shown = undefined;
        const chosen: any = { widget, action };
        if (item !== null) {
            chosen.item = item;
        }
        if (child !== null) {
            chosen.child = { template: "contents", id: child };
        }
        await handle.onAction!(chosen, {
            file: offerFile as CustomInstrumentOfferFile,
            show: page => {
                shown = page?.id ?? null;
            },
        });
        return JSON.stringify({ shown: shown ?? null });
    },
    async configure(settings: Record<string, unknown>): Promise<void> {
        await handle.updateConfig!({ settings: { ...defaultSettings, ...settings } } as CustomInstrumentConfig);
    },
    async dispose(): Promise<void> {
        await handle.dispose!();
    },
    pristine(): Promise<string> {
        return pristine;
    },
    targetTaps,
};

function targetTaps(): Promise<string> {
    return (Process.findModuleByName("Electron Framework") === null || isHelper())
        ? Promise.resolve("not the main process")
        : Electron.perform(realm => realm.toJs(realm.evaluate(tapsProbe)) as string);
}

function isHelper(): boolean {
    return Process.mainModule.name.includes(" Helper");
}

function widgetHandle(id: string) {
    const state: WidgetState = widgets.get(id) ?? { rows: new Map(), items: new Map(), entries: [], disabled: new Set(), calls: 0 };
    widgets.set(id, state);
    return {
        upsertRow({ id: rowId, cells }: { id: string; cells: Record<string, string> }) {
            state.calls++;
            state.rows.delete(rowId);
            state.rows.set(rowId, cells);
            if (state.rows.size > (rowCaps[id] ?? Infinity)) {
                state.rows.delete(state.rows.keys().next().value!);
            }
        },
        removeRow(rowId: string) {
            state.calls++;
            state.rows.delete(rowId);
        },
        upsertItem(item: { id: string }) {
            state.calls++;
            state.items.set(item.id, item);
        },
        removeItem(itemId: string) {
            state.calls++;
            state.items.delete(itemId);
        },
        appendOutput(text: string) {
            state.entries.push(["output", text]);
        },
        appendError(text: string) {
            state.entries.push(["error", text]);
        },
        appendValue(value: unknown) {
            state.entries.push(["value", value]);
        },
        setActionEnabled(action: string, enabled: boolean) {
            if (enabled) {
                state.disabled.delete(action);
            } else {
                state.disabled.add(action);
            }
        },
        clear() {
            state.calls++;
            state.rows.clear();
            state.items.clear();
            state.entries.length = 0;
        },
    };
}

function pageHandle(template: string, id: string) {
    return {
        template,
        id,
        update(row: Partial<CustomInstrumentChildRow>) {
            pages.set(id, { ...pages.get(id)!, ...row });
        },
        widget: (widget: string) => widgetHandle(`${template}/${id}/${widget}`),
        remove() {
            pages.delete(id);
        },
    };
}

function offerFile(file: { name: string; mediaType: string; bytes?: ArrayBuffer }): Writable | void {
    if (file.bytes !== undefined) {
        offered.push({ name: file.name, mediaType: file.mediaType, size: file.bytes.byteLength, sha256: Checksum.compute("sha256", file.bytes), head: headOf(file.bytes) });
        return;
    }
    const checksum = new Checksum("sha256");
    let size = 0;
    let head = "";
    return new Writable({
        write(chunk: Uint8Array, _encoding, done) {
            const bytes = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
            if (size === 0) {
                head = headOf(bytes);
            }
            checksum.update(bytes);
            size += chunk.byteLength;
            done();
        },
        final(done) {
            offered.push({ name: file.name, mediaType: file.mediaType, size, sha256: checksum.getString(), head });
            done();
        },
    });
}

function headOf(bytes: ArrayBuffer): string {
    return [...new Uint8Array(bytes.slice(0, 16))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function printable(_key: string, value: unknown): unknown {
    if (value instanceof ArrayBuffer) {
        return { bytes: headOf(value), length: value.byteLength };
    }
    if (value instanceof Map) {
        return { map: [...value] };
    }
    if (value instanceof Set) {
        return { set: [...value] };
    }
    if (typeof value === "bigint") {
        return `${value}n`;
    }
    if (value === undefined) {
        return "<undefined>";
    }
    if (typeof value === "function") {
        return `<function ${value.name}>`;
    }
    if (value instanceof Error) {
        return `<${value.name}: ${value.message}>`;
    }
    if (value instanceof Date) {
        return `<Date ${value.toISOString()}>`;
    }
    return value;
}
