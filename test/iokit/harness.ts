/// <reference path="./luma.d.ts" />

import { instrument } from "../../iokit/main.js";

const DISPOSE_AFTER_MS = 12000;
const LUMA_VALUE_DEPTH = 3;

const explorerSteps: [number, string][] = [
    [1500, ":help"],
    [1600, "io.openable(/Surface/)"],
    [1650, "io.find(\"IOSurfaceRoot\")[0].children().slice(0, 2).map(client => client.properties())"],
    [1700, "globalThis.surfaces = io.find(\"IOSurfaceRoot\"); surfaces.length"],
    [1800, "globalThis.c = surfaces[0].open(); c.describe()"],
    [1900, "c.probe(0, 40)"],
    [2000, "c.call(9999, { scalars: [1, \"0x10\"], struct: [1, 2, 3] })"],
    [2100, "io.path(\"IOService:/\").children().slice(0, 2)"],
    [2200, "io.find(\"IOPlatformExpertDevice\")[0].property(\"model\")"],
    [2250, "[io.named(\"IOSurfaceRoot\").length, io.root.className, surfaces[0].parent().className]"],
    [2300, "io.connections.map(connection => connection.describe().connection)"],
    [2400, "io.replay(1)"],
    [2500, "io.replay(2)"],
    [2600, "io.entry(\"0x0\")"],
    [2700, "c.close(); io.connections.length"],
];

const initialConfig: CustomInstrumentConfig = { settings: { backtraces: false, dataLimit: 256, callsPerSecond: 100 } };
const narrowedConfig: CustomInstrumentConfig = { settings: { classes: "^IOSurface", backtraces: true, dataLimit: 8, callsPerSecond: 1 } };

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

const restoredMethod = { id: "IOSurfaceRootUserClient#9999", cells: { userClient: "IOSurfaceRootUserClient", selector: "9999", calls: "10", errors: "10", meanUs: "2.5", last: "" } };
const restored = {
    methods: { rows: [restoredMethod] },
    lookups: { rows: [] },
    properties: { rows: [] },
    explorer: { entries: [] },
};

const creationStart = Date.now();
const handle = await instrument.create(ctx, initialConfig, restored as unknown as CustomInstrumentRestoredState);
console.log(`created in ${Date.now() - creationStart} ms`);

for (const [delay, text] of explorerSteps) {
    setTimeout(() => {
        console.log(`explorer> ${text}`);
        try {
            handle.onConsoleInput!({ widget: "explorer", entryId: text, text }, respond);
        } catch (error) {
            console.log("explorer threw", (error as Error).message);
        }
    }, delay);
}

setTimeout(() => {
    handle.onConsoleInput!({ widget: "log", entryId: "#3", text: "#3" }, respond);
    handle.onConsoleInput!({ widget: "log", entryId: "99999", text: "99999" }, respond);
}, 3000);

setTimeout(() => {
    handle.onAction!({ widget: "services", action: "showProperties", item: firstSurfaceRoot() }, actionRespond);
    handle.onAction!({ widget: "services", action: "open", item: firstSurfaceRoot() }, actionRespond);
    handle.onAction!({ widget: "services", action: "rescan" }, actionRespond);
}, 3500);

setTimeout(() => {
    for (const widget of ["methods", "lookups", "properties", "log", "explorer"] as const) {
        handle.onAction!({ widget, action: "clear" }, actionRespond);
    }
    console.log("cleared");
}, 5000);

setTimeout(() => {
    handle.updateConfig!(narrowedConfig);
    console.log("updated config: only ^IOSurface, backtraces on, 8 data bytes, 1 call shown per second");
}, DISPOSE_AFTER_MS / 2);

setTimeout(() => {
    handle.dispose!();
    console.log("disposed");
}, DISPOSE_AFTER_MS);

function firstSurfaceRoot(): string {
    const port = Module.getGlobalExportByName("IOServiceGetMatchingService");
    const matching = new NativeFunction(Module.getGlobalExportByName("IOServiceMatching"), "pointer", ["pointer"]);
    const service = new NativeFunction(port, "uint", ["uint", "pointer"])(0, matching(Memory.allocUtf8String("IOSurfaceRoot")));
    const id = Memory.alloc(8);
    new NativeFunction(Module.getGlobalExportByName("IORegistryEntryGetRegistryEntryID"), "int", ["uint", "pointer"])(service, id);
    return `0x${id.readU64().toString(16)}`;
}

function unexpectedFile(): never {
    throw new Error("IOKit offered a file");
}

function printable(value: unknown): string {
    return JSON.stringify(value, (_key, item) => {
        if (item instanceof ArrayBuffer) {
            return `<ArrayBuffer ${Array.from(new Uint8Array(item), byte => byte.toString(16).padStart(2, "0")).join("")}>`;
        }
        if (item instanceof Int64 || item instanceof UInt64 || item instanceof NativePointer) {
            return `<${item.constructor.name} ${item.toString()}>`;
        }
        return item;
    });
}

function hasContainerBelow(depthLimit: number, value: unknown, depth: number): boolean {
    const isContainer = typeof value === "object" && value !== null && !(value instanceof ArrayBuffer) && !(value instanceof Date)
        && !(value instanceof Int64) && !(value instanceof UInt64) && !(value instanceof NativePointer);
    if (!isContainer) {
        return false;
    }
    if (depth >= depthLimit) {
        return true;
    }
    return Object.values(value).some(child => hasContainerBelow(depthLimit, child, depth + 1));
}
