/// <reference path="./luma.d.ts" />

import { instrument } from "../../xpc-spy/main.js";

const DISPOSE_AFTER_MS = 16000;
const LUMA_VALUE_DEPTH = 3;

const initialConfig: CustomInstrumentConfig = { features: { backtraces: false, dataLimit: 64 } };
const narrowedConfig: CustomInstrumentConfig = { features: { services: "^com\\.apple\\.", backtraces: true, dataLimit: 8 } };

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

const restoredRow = { id: "(anonymous)", cells: { service: "(anonymous)", peer: "1", sent: "500", received: "700", seen: "", last: "" } };
const restored = { services: { rows: [restoredRow] } };

const handle = await instrument.create(ctx, initialConfig, restored as unknown as CustomInstrumentRestoredState);
console.log("created");

setTimeout(() => {
    for (const text of ["#3", "99999"]) {
        handle.onConsoleInput!({ widget: "messages", entryId: text, text }, {
            output: (text: string) => console.log("respond.output", text),
            error: (text: string) => console.log("respond.error", text),
            value: (value: unknown) => console.log("respond.value", printable(value)),
            image: () => {},
        });
    }
}, 3000);

setTimeout(() => {
    handle.updateConfig!(narrowedConfig);
    console.log("updated config: only com.apple.*, backtraces on, 8 data bytes");
}, DISPOSE_AFTER_MS / 2);

setTimeout(() => {
    handle.dispose!();
    console.log("disposed");
}, DISPOSE_AFTER_MS);

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
