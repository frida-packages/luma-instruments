/// <reference path="./instrument-typings.d.ts" />

import { Buffer } from "buffer";
import { Writable } from "stream";
import { instrument } from "../../javascriptcore/main.js";

interface Row {
    id: string;
    cells: Record<string, string>;
}

interface WidgetState {
    rows: Map<string, Row>;
    items: Map<string, unknown>;
    buckets: { label: string; count: number }[];
    console: string[];
    values: unknown[];
    disabled: Set<string>;
}

const defaultSettings: CustomInstrumentSettingMap = {
    logScripts: true,
    sourceMegabytes: 64,
};

const widgets = new Map<string, WidgetState>();
const children = new Map<string, { row: CustomInstrumentChildRow; template: string }>();
const offers: { name: string; mediaType: string; bytes: Buffer }[] = [];
const shown: string[] = [];
const watched = [
    "JSEvaluateScript",
    "JSScriptEvaluate",
    "JSScriptCreateFromString",
    "_ZN3JSC14JSGlobalObject4initERNS_2VME",
    "_ZN3JSC14JSGlobalObjectD2Ev",
];
const pristine = new Map<string, string>(Process.findModuleByName("JavaScriptCore") === null ? [] : watched.map(name => [name, hexOf(exportNamed(name).readByteArray(16)!)]));

const ctx = {
    emit() {
    },
    widget(id: string) {
        return widgetHandle(id);
    },
    children(template: string) {
        return {
            add(id: string, row: CustomInstrumentChildRow) {
                children.set(id, { row, template });
                return childHandle(template, id);
            },
            get(id: string) {
                return children.has(id) ? childHandle(template, id) : undefined;
            },
            ids() {
                return [...children.keys()];
            },
            remove(id: string) {
                children.delete(id);
            },
        };
    },
} as unknown as CustomInstrumentContext;

const handle = await instrument.create(ctx, { settings: defaultSettings }, {});

rpc.exports = {
    state() {
        return {
            widgets: Object.fromEntries([...widgets].map(([id, state]) => [id, {
                rows: [...state.rows.values()],
                items: [...state.items.values()],
                buckets: state.buckets,
                console: state.console,
                values: state.values.map(value => JSON.stringify(value, jsonSafe)),
                disabled: [...state.disabled],
            }])),
            children: Object.fromEntries(children),
            offers: offers.map(({ name, mediaType, bytes }) => ({ name, mediaType, size: bytes.length })),
            shown,
        };
    },
    async act(widget: string, action: string, item?: string, child?: string) {
        const request = { widget, action, item: (item === "") ? undefined : item,
            child: (typeof child === "string") ? { template: "context", id: child } : undefined };
        await handle.onAction!(request as unknown as CustomInstrumentAction, responder());
        await settle();
        const offer = offers.at(-1);
        if (offer !== undefined && action === "export") {
            send({ type: "offer", name: offer.name }, offer.bytes.buffer.slice(offer.bytes.byteOffset, offer.bytes.byteOffset + offer.bytes.length) as ArrayBuffer);
        }
    },
    async input(text: string, child: string) {
        const output: string[] = [];
        const respond = {
            ...responder(),
            output: (line: string) => output.push(line),
            error: (line: string) => output.push(`error: ${line}`),
            value: (value: unknown) => output.push(JSON.stringify(value, jsonSafe)),
            image: () => {},
        } as unknown as CustomInstrumentConsoleResponder;
        const consoleInput = { widget: "console", entryId: "1", text, child: { template: "context", id: child } };
        await handle.onConsoleInput!(consoleInput as unknown as CustomInstrumentConsoleInput, respond);
        await settle();
        return output;
    },
    async configure(settings: CustomInstrumentSettingMap) {
        await handle.updateConfig?.({ settings });
    },
    async dispose() {
        await handle.dispose?.();
        return [...pristine].map(([name, bytes]) =>
            `${name} ${(hexOf(exportNamed(name).readByteArray(16)!) === bytes) ? "restored" : "CHANGED"}`);
    },
};

function widgetHandle(id: string, prefix = "") {
    const key = `${prefix}${id}`;
    if (!widgets.has(key)) {
        widgets.set(key, { rows: new Map(), items: new Map(), buckets: [], console: [], values: [], disabled: new Set() });
    }
    const state = widgets.get(key)!;
    return {
        upsertRow(row: Row) {
            state.rows.set(row.id, row);
        },
        removeRow(rowId: string) {
            state.rows.delete(rowId);
        },
        upsertItem(item: { id: string }) {
            state.items.set(item.id, item);
        },
        setHistogram(buckets: { label: string; count: number }[]) {
            state.buckets = buckets;
        },
        appendOutput(text: string) {
            state.console.push(text);
        },
        appendError(text: string) {
            state.console.push(`error: ${text}`);
        },
        appendValue(value: unknown) {
            state.values.push(value);
        },
        setActionEnabled(action: string, enabled: boolean) {
            if (enabled) {
                state.disabled.delete(action);
            } else {
                state.disabled.add(action);
            }
        },
        clear() {
            state.rows.clear();
            state.items.clear();
            state.buckets = [];
            state.console.length = 0;
            state.values.length = 0;
        },
    };
}

function childHandle(template: string, id: string) {
    return {
        template,
        id,
        update(row: Partial<CustomInstrumentChildRow>) {
            children.get(id)!.row = { ...children.get(id)!.row, ...row };
        },
        widget(widgetId: string) {
            return widgetHandle(widgetId, `${template}/${id}/`);
        },
        remove() {
            children.delete(id);
        },
    };
}

function responder(): CustomInstrumentActionResponder {
    return {
        file: ((file: CustomInstrumentOfferedFile) => {
            offers.push({ name: file.name, mediaType: file.mediaType, bytes: Buffer.from(file.bytes as Uint8Array) });
            return new Writable();
        }) as CustomInstrumentOfferFile,
        show(child) {
            shown.push(child?.id ?? "page");
        },
    };
}

function exportNamed(name: string): NativePointer {
    return Process.getModuleByName("JavaScriptCore").getExportByName(name);
}

function settle(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 400));
}

function hexOf(bytes: ArrayBuffer): string {
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

function jsonSafe(_key: string, value: unknown): unknown {
    return (typeof value === "bigint") ? `${value}n` : value;
}
