/// <reference path="./luma.d.ts" />

import { instrument } from "../../xpc-spy/main.js";

const DISPOSE_AFTER_MS = 16000;
const CLEAR_AFTER_MS = 5000;
const LUMA_VALUE_DEPTH = 3;

const initialConfig: CustomInstrumentConfig = { settings: { backtraces: false, dataLimit: 64, messagesPerSecond: 100 } };
const narrowedConfig: CustomInstrumentConfig = { settings: { services: "^com\\.apple\\.", backtraces: true, dataLimit: 8, messagesPerSecond: 1 } };

const ctx = {
    emit(value: unknown) {
        console.log("emit", printable(value));
        if (hasContainerBelow(LUMA_VALUE_DEPTH, value, 0)) {
            console.log("emit exceeds the depth Luma shows");
        }
    },
    widget(id: string) {
        return new Proxy({}, {
            get(_target, method: string) {
                return (...args: unknown[]) => console.log(`widget ${id}.${method}`, printable(args));
            }
        });
    },
} as unknown as CustomInstrumentContext;

const respond: CustomInstrumentConsoleResponder = {
    output: text => console.log("respond.output", text),
    error: text => console.log("respond.error", text),
    value: value => console.log("respond.value", printable(value)),
    image: () => {},
    file: unexpectedFile,
    show: child => console.log(`respond.show ${child?.id ?? "page"}`),
};

const actionRespond: CustomInstrumentActionResponder = {
    file: unexpectedFile,
    show: respond.show,
};

const restoredRow = { id: "(anonymous)", cells: { service: "(anonymous)", peer: "1", sent: "500", received: "700", seen: "", last: "" } };
const restored = { services: { rows: [restoredRow] } };

const creationStart = Date.now();
const handle = await instrument.create(ctx, initialConfig, restored as unknown as CustomInstrumentRestoredState);
console.log(`created in ${Date.now() - creationStart} ms`);

setTimeout(() => inspect(["#3", "99999"]), 3000);

setTimeout(() => {
    handle.onAction!({ widget: "services", action: "clear" }, actionRespond);
    handle.onAction!({ widget: "messages", action: "clear" }, actionRespond);
    console.log("cleared services and messages");
    inspect(["#3"]);
}, CLEAR_AFTER_MS);

setTimeout(() => {
    handle.updateConfig!(narrowedConfig);
    console.log("updated config: only com.apple.*, backtraces on, 8 data bytes, 1 message shown per second");
}, DISPOSE_AFTER_MS / 2);

setTimeout(() => {
    handle.dispose!();
    console.log("disposed");
}, DISPOSE_AFTER_MS);

function inspect(texts: string[]): void {
    for (const text of texts) {
        handle.onConsoleInput!({ widget: "messages", entryId: text, text }, respond);
    }
}

function unexpectedFile(): never {
    throw new Error("XPC Spy offered a file");
}

function printable(value: unknown): string {
    return JSON.stringify(value, (_key, item) => {
        if (item instanceof ArrayBuffer) {
            return `<ArrayBuffer ${Array.from(new Uint8Array(item), byte => byte.toString(16).padStart(2, "0")).join("")}>`;
        }
        if (item instanceof Int64 || item instanceof UInt64) {
            return `<${item.constructor.name} ${item.toString()}>`;
        }
        return item;
    });
}

function hasContainerBelow(depthLimit: number, value: unknown, depth: number): boolean {
    const isContainer = typeof value === "object" && value !== null && !(value instanceof ArrayBuffer) && !(value instanceof Date)
        && !(value instanceof Int64) && !(value instanceof UInt64);
    if (!isContainer) {
        return false;
    }
    if (depth >= depthLimit) {
        return true;
    }
    return Object.values(value).some(child => hasContainerBelow(depthLimit, child, depth + 1));
}
