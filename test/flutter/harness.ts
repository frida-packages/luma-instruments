/// <reference path="./instrument-typings.d.ts" />

import { Buffer } from "buffer";
import { Writable } from "stream";
import { instrument } from "../../flutter/main.js";
import { objcClass } from "../../flutter/objc-runtime.js";

interface Row {
    id: string;
    cells: Record<string, string>;
}

interface WidgetState {
    rows: Map<string, Row>;
    items: Map<string, unknown>;
    console: string[];
    values: unknown[];
}

const defaultSettings: CustomInstrumentSettingMap = {
    bytesKept: 65536,
    messagesPerSecond: 100,
    emitMessages: false,
    askVmService: true,
};

const widgets = new Map<string, WidgetState>();
const children = new Map<string, { row: CustomInstrumentChildRow; template: string }>();
const offers: { name: string; mediaType: string; bytes: Buffer }[] = [];
const shown: string[] = [];
let emitted = 0;

const ctx = {
    emit() {
        emitted++;
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

const pristine = new Map([...hookedFunctions()].map(([name, address]) => [name, hexOf(address.readByteArray(16)!)]));
const handle = await instrument.create(ctx, { settings: defaultSettings }, {});

rpc.exports = {
    state() {
        return {
            widgets: Object.fromEntries([...widgets].map(([id, state]) => [id, {
                rows: [...state.rows.values()],
                items: [...state.items.values()],
                console: state.console,
                values: state.values.map(value => JSON.stringify(value, jsonSafe)),
            }])),
            children: Object.fromEntries(children),
            offers: offers.map(({ name, mediaType, bytes }) => ({ name, mediaType, size: bytes.length })),
            shown,
            emitted,
        };
    },
    async act(widget: string, action: string, item?: string, child?: string) {
        const request = { widget, action, item, child: (typeof child === "string") ? { template: "channel", id: child } : undefined };
        await handle.onAction!(request as unknown as CustomInstrumentAction, responder());
        await settle();
        const offer = offers.at(-1);
        if (offer !== undefined && action === "save") {
            send({ type: "offer", name: offer.name }, offer.bytes.buffer.slice(offer.bytes.byteOffset, offer.bytes.byteOffset + offer.bytes.length) as ArrayBuffer);
        }
    },
    async input(text: string, child?: string) {
        const output: string[] = [];
        const respond = {
            ...responder(),
            output: (line: string) => output.push(line),
            error: (line: string) => output.push(`error: ${line}`),
            value: (value: unknown) => output.push(JSON.stringify(value, jsonSafe)),
            image: () => {},
        } as unknown as CustomInstrumentConsoleResponder;
        const consoleInput = { widget: "console", entryId: "1", text, child: (typeof child === "string") ? { template: "channel", id: child } : undefined };
        await handle.onConsoleInput!(consoleInput as unknown as CustomInstrumentConsoleInput, respond);
        await settle();
        return output;
    },
    async configure(settings: CustomInstrumentSettingMap) {
        await handle.updateConfig?.({ settings });
    },
    async dispose() {
        await handle.dispose?.();
        return [...pristine].map(([name, bytes]) => {
            const address = hookedFunctions().get(name)!;
            return `${name} ${(hexOf(address.readByteArray(16)!) === bytes) ? "restored" : "CHANGED"}`;
        });
    },
};

function widgetHandle(id: string, prefix = "") {
    const key = `${prefix}${id}`;
    if (!widgets.has(key)) {
        widgets.set(key, { rows: new Map(), items: new Map(), console: [], values: [] });
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
        appendOutput(text: string) {
            state.console.push(text);
        },
        appendError(text: string) {
            state.console.push(`error: ${text}`);
        },
        appendValue(value: unknown) {
            state.values.push(value);
        },
        setActionEnabled() {
        },
        clear() {
            state.rows.clear();
            state.items.clear();
            state.console.length = 0;
            state.values.length = 0;
        },
    };
}

function childHandle(template: string, id: string) {
    return {
        template,
        id,
        update(row: CustomInstrumentChildRow) {
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
        file: ((header: CustomInstrumentOfferedFileHeader) => {
            const chunks: Buffer[] = [];
            const offer = { name: header.name, mediaType: header.mediaType, bytes: Buffer.alloc(0) };
            offers.push(offer);
            return new Writable({
                write(chunk: Buffer, _encoding, callback) {
                    chunks.push(chunk);
                    callback();
                },
                final(callback) {
                    offer.bytes = Buffer.concat(chunks);
                    callback();
                },
            });
        }) as CustomInstrumentOfferFile,
        show(child) {
            shown.push(child?.id ?? "page");
        },
    };
}

function hookedFunctions(): Map<string, NativePointer> {
    const functions = new Map<string, NativePointer>();
    if (Process.findModuleByName("FlutterMacOS") === null) {
        return functions;
    }
    const engineClass = objcClass("FlutterEngine");
    for (const selector of ["engineCallbackOnPlatformMessage:", "sendOnChannel:message:binaryReply:"]) {
        functions.set(`-[FlutterEngine ${selector}]`, engineClass.implementationOf(selector));
    }
    return functions;
}

function settle(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 400));
}

function hexOf(bytes: ArrayBuffer): string {
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

function jsonSafe(_key: string, value: unknown): unknown {
    if (typeof value === "bigint") {
        return `${value}n`;
    }
    if (value instanceof Map) {
        return Object.fromEntries([...value].map(([key, item]) => [String(key), item]));
    }
    if (ArrayBuffer.isView(value)) {
        return `${value.constructor.name}(${Array.from(value as unknown as ArrayLike<number | bigint>, String).join(",")})`;
    }
    return value;
}
