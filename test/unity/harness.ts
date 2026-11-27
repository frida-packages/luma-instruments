/// <reference path="./instrument-typings.d.ts" />

import { Buffer } from "buffer";
import { Writable } from "stream";
import { instrument } from "../../unity/main.js";

interface Row {
    id: string;
    cells: Record<string, string>;
}

interface WidgetState {
    rows: Map<string, Row>;
    items: Map<string, unknown>;
    console: string[];
    values: unknown[];
    histogram: { label: string; count: number }[];
    disabled: Set<string>;
    state: unknown;
    data: ArrayBuffer | null;
    events: unknown[];
}

const defaultSettings: CustomInstrumentSettingMap = {
    mostTraced: 256,
    callsPerSecond: 100,
    charsPerValue: 160,
};

const widgets = new Map<string, WidgetState>();
const children = new Map<string, { row: CustomInstrumentChildRow; template: string }>();
const offers: { name: string; mediaType: string; bytes: Buffer }[] = [];
const shown: string[] = [];

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
                console: state.console,
                values: state.values.map(value => JSON.stringify(value, jsonSafe)),
                histogram: state.histogram.slice(0, 12),
                disabled: [...state.disabled],
                state: state.state,
                dataBytes: state.data?.byteLength ?? null,
                events: state.events.length,
            }])),
            children: Object.fromEntries(children),
            offers: offers.map(({ name, mediaType, bytes }) => ({ name, mediaType, size: bytes.length })),
            shown,
        };
    },
    async act(widget: string, action: string, item?: string, child?: string) {
        const request = { widget, action, item, child: (typeof child === "string") ? { template: "scene", id: child } : undefined };
        await handle.onAction!(request as unknown as CustomInstrumentAction, responder());
        const offer = offers.at(-1);
        if (offer !== undefined && (action === "dump" || action === "save")) {
            await settle();
            send({ type: "offer", name: offer.name }, offer.bytes.buffer.slice(offer.bytes.byteOffset, offer.bytes.byteOffset + offer.bytes.length) as ArrayBuffer);
        }
    },
    async input(text: string) {
        const output: string[] = [];
        const respond = {
            ...responder(),
            output: (line: string) => output.push(line),
            error: (line: string) => output.push(`error: ${line}`),
            value: (value: unknown) => output.push(JSON.stringify(value, jsonSafe) ?? "undefined"),
            image: () => {},
        } as unknown as CustomInstrumentConsoleResponder;
        try {
            await handle.onConsoleInput!({ widget: "console", entryId: "1", text } as unknown as CustomInstrumentConsoleInput, respond);
        } catch (e) {
            output.push(`thrown: ${(e as Error).message}`);
        }
        return output;
    },
    async view(child: string, value: unknown) {
        await handle.onViewMessage!({ widget: "hierarchy", value, data: null, child: { template: "scene", id: child } } as CustomInstrumentViewMessage);
        return widgets.get(`scene/${child}/hierarchy`)!.events.at(-1);
    },
    viewData(child: string) {
        const state = widgets.get(`scene/${child}/hierarchy`)!;
        send({ type: "view-data", child, state: state.state }, state.data);
    },
    async configure(settings: CustomInstrumentSettingMap) {
        await handle.updateConfig?.({ settings });
    },
    async dispose() {
        await handle.dispose?.();
    },
};

function widgetHandle(id: string, prefix = "") {
    const key = `${prefix}${id}`;
    if (!widgets.has(key)) {
        widgets.set(key, { rows: new Map(), items: new Map(), console: [], values: [], histogram: [], disabled: new Set(), state: null, data: null, events: [] });
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
        removeItem(itemId: string) {
            state.items.delete(itemId);
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
        setHistogram(buckets: { label: string; count: number }[]) {
            state.histogram = buckets;
        },
        setState(value: unknown, data?: ArrayBuffer | ArrayBufferView) {
            state.state = value;
            state.data = (data === undefined) ? null : ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer : data;
        },
        sendEvent(value: unknown) {
            state.events.push(value);
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
            state.console.length = 0;
            state.values.length = 0;
            state.histogram = [];
            state.state = null;
            state.data = null;
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

function settle(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 400));
}

function jsonSafe(_key: string, value: unknown): unknown {
    if (value instanceof NativePointer) {
        return value.toString();
    }
    return value;
}
