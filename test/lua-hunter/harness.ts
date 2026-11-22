/// <reference path="../../lua-hunter/luma.d.ts" />

import { instrument } from "../../lua-hunter/main.js";

type Reply = [kind: "output" | "error" | "value", payload: unknown];

const config: CustomInstrumentConfig = { features: { scanMemory: true, entriesPerTable: 100 } };
const pristineCode = snapshotLuaCode();
const SETTLE_AFTER_DISPOSE_MS = 250;
let widgetLogging = true;

const ctx = {
    emit(value: unknown) {
        console.log("emit", printable(value));
    },
    widget(id: string) {
        return new Proxy({}, {
            get(_target, method: string) {
                return (...args: unknown[]) => {
                    if (widgetLogging) {
                        console.log(`widget ${id}.${method}`, printable(args));
                    }
                };
            },
        });
    },
} as unknown as CustomInstrumentContext;

const startedAt = Date.now();
const handle = await instrument.create(ctx, config, {} as CustomInstrumentRestoredState);
console.log(`created in ${Date.now() - startedAt} ms`);

rpc.exports = {
    async input(text: string): Promise<string> {
        const replies: Reply[] = [];
        await handle.onConsoleInput!({ widget: "console", entryId: "input", text }, {
            output: text => replies.push(["output", text]),
            error: text => replies.push(["error", text]),
            value: value => replies.push(["value", value]),
            image: () => {},
        });
        return printable(replies);
    },
    use(number: number): void {
        handle.onAction!({ widget: "interpreters", action: "use", item: String(number) });
    },
    logWidgets(enabled: boolean): void {
        widgetLogging = enabled;
    },
    async dispose(): Promise<string[]> {
        await handle.dispose!();
        await new Promise(resolve => setTimeout(resolve, SETTLE_AFTER_DISPOSE_MS));
        const current = snapshotLuaCode();
        return [...pristineCode].map(([name, bytes]) => `code of ${name} ${describeDifference(bytes, current.get(name)!)}`);
    },
};

function snapshotLuaCode(): Map<string, Uint8Array> {
    const snapshot = new Map<string, Uint8Array>();
    const candidates = Process.enumerateModules().filter(module => module.path === Process.mainModule.path || /lua/i.test(module.name));
    for (const module of candidates) {
        for (const range of module.enumerateRanges("r-x")) {
            snapshot.set(`${module.name}@${range.base}`, new Uint8Array(range.base.readByteArray(range.size)!));
        }
    }
    return snapshot;
}

function printable(value: unknown): string {
    return JSON.stringify(value, (_key, item) => {
        if (item instanceof Int64 || item instanceof UInt64) {
            return `<${item.constructor.name} ${item.toString()}>`;
        }
        return item;
    });
}

function describeDifference(before: Uint8Array, after: Uint8Array): string {
    const changed = before.findIndex((byte, index) => byte !== after[index]);
    return (changed === -1) ? "restored" : `CHANGED at offset 0x${changed.toString(16)}`;
}
