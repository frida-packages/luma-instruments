/// <reference path="../../lua-hunter/luma.d.ts" />

import { instrument } from "../../lua-hunter/main.js";

type Reply = [kind: "output" | "error" | "value", payload: unknown];

const config: CustomInstrumentConfig = { settings: { scanMemory: true, entriesPerTable: 100 } };
const pristineCode = snapshotLuaCode();
const SETTLE_AFTER_DISPOSE_MS = 250;
let widgetLogging = true;
let widgetCalls: string[] = [];
const scanStates: boolean[] = [];
const pages = new Map<string, CustomInstrumentChildRow>();
let shownPage: string | null = null;

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
                if (!pages.delete(id)) {
                    throw new Error(`there is no child ${id}`);
                }
            },
        };
    },
} as unknown as CustomInstrumentContext;

const respond: CustomInstrumentActionResponder = {
    file: () => {
        throw new Error("Lua Hunter offered a file");
    },
    show(child) {
        shownPage = child?.id ?? null;
    },
};

const startedAt = Date.now();
const handle = await instrument.create(ctx, config, {} as CustomInstrumentRestoredState);
console.log(`created in ${Date.now() - startedAt} ms`);
await firstSweepEnded();
console.log(`first sweep ended ${Date.now() - startedAt} ms after create began`);

rpc.exports = {
    async input(number: number, text: string): Promise<string> {
        const replies: Reply[] = [];
        const child = { template: "interpreter" as const, id: String(number) };
        await handle.onConsoleInput!({ child, widget: "console", entryId: "input", text }, {
            output: text => replies.push(["output", text]),
            error: text => replies.push(["error", text]),
            value: value => replies.push(["value", value]),
            image: () => {},
            file: respond.file,
            show: respond.show,
        });
        return printable(replies);
    },
    pages(): string {
        return printable([...pages].map(([id, row]) => ({ id, ...row })));
    },
    show(number: number): string | null {
        shownPage = null;
        handle.onAction!({ widget: "interpreters", action: "show", item: String(number) }, respond);
        return shownPage;
    },
    scanStates(): boolean[] {
        return scanStates;
    },
    scan(): boolean[] {
        handle.onAction!({ widget: "interpreters", action: "scan" }, respond);
        return scanStates;
    },
    clear(number: number): string[] {
        widgetCalls = [];
        handle.onAction!({ child: { template: "interpreter", id: String(number) }, widget: "console", action: "clear" }, respond);
        return widgetCalls;
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

function widgetProxy(id: string) {
    return new Proxy({}, {
        get(_target, method: string) {
            return (...args: unknown[]) => {
                widgetCalls.push(`${id}.${method}`);
                if (id === "interpreters" && method === "setActionEnabled" && args[0] === "scan") {
                    scanStates.push(args[1] as boolean);
                }
                if (widgetLogging) {
                    console.log(`widget ${id}.${method}`, printable(args));
                }
            };
        },
    });
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

async function firstSweepEnded(): Promise<void> {
    while (!scanStates.includes(true)) {
        await new Promise(resolve => setTimeout(resolve, 20));
    }
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
