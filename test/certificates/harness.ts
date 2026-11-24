/// <reference path="./instrument-typings.d.ts" />

import { instrument } from "../../certificates/main.js";

const scanFinishedPrefix = "Scanned ";

const rows = new Set<string>();
const disabledActions = new Set<string>();
let onScanFinished!: () => void;
let shownSightings: string[][] = [];

rpc.exports = {
    init(_stage: string, parameters: { scope?: CustomInstrumentSettingMap["scope"] }) {
        exercise(parameters.scope ?? "writable").catch(error => console.log(`failed: ${error.stack}`));
    },
};

async function exercise(scope: CustomInstrumentSettingMap["scope"]): Promise<void> {
    const handle = await instrument.create(ctx, { settings: { scope } }, {});
    expectRescan(false, "during the first scan");
    await scanFinished();
    expectRescan(true, "after the first scan");

    for (const id of rows) {
        await handle.onAction!({ widget: "certificates", action: "inspect", item: id });
    }
    await handle.onConsoleInput!({ widget: "details", entryId: "1", text: "ed25519" }, respond);
    await handle.onConsoleInput!({ widget: "details", entryId: "2", text: "no such certificate" }, respond);

    console.log("clearing details");
    await handle.onAction!({ widget: "details", action: "clear" });

    console.log("rescanning");
    await handle.onAction!({ widget: "certificates", action: "rescan" });
    expectRescan(false, "during the rescan");
    await scanFinished();
    expectRescan(true, "after the rescan");

    await handle.dispose!();
    console.log("disposed");
}

const ctx = {
    emit(value: unknown) {
        console.log(`emit ${render(value)}`);
    },
    widget(id: string) {
        return new Proxy({}, {
            get(_target, method: string) {
                return (...args: unknown[]) => {
                    console.log(`widget ${id}.${method}(${args.map(render).join(", ")})`);
                    noteWidgetCall(id, method, args);
                };
            },
        });
    },
} as unknown as CustomInstrumentContext;

function expectRescan(enabled: boolean, when: string): void {
    const actual = !disabledActions.has("certificates.rescan");
    console.log(`rescan ${enabled ? "enabled" : "disabled"} ${when}: ${(actual === enabled) ? "ok" : "WRONG"}`);
}

function scanFinished(): Promise<void> {
    return new Promise(resolve => {
        onScanFinished = resolve;
    });
}

const respond: CustomInstrumentConsoleResponder = {
    output: text => console.log(`respond.output ${text}`),
    error: text => console.log(`respond.error ${text}`),
    value: value => {
        console.log(`respond.value ${render(value)}`);
        noteShown(value);
    },
    image: () => {},
};

function noteWidgetCall(id: string, method: string, args: unknown[]): void {
    if (method === "setActionEnabled") {
        noteActionEnabled(`${id}.${args[0]}`, args[1] as boolean);
    }
    if (id === "certificates" && method === "upsertRow") {
        rows.add((args[0] as { id: string }).id);
    }
    if (id === "certificates" && method === "removeRow") {
        rows.delete(args[0] as string);
    }
    if (id === "details" && method === "appendOutput" && (args[0] as string).startsWith(scanFinishedPrefix)) {
        onScanFinished();
    }
    if (id === "details" && method === "appendValue") {
        noteShown(args[0]);
    }
    if (id === "der" && method === "setHex") {
        checkBaseAddress((args[0] as { baseAddress?: unknown }).baseAddress);
    }
}

function noteActionEnabled(key: string, enabled: boolean): void {
    if (enabled) {
        disabledActions.delete(key);
    } else {
        disabledActions.add(key);
    }
}

function noteShown(details: unknown): void {
    shownSightings.push((details as { foundAt: string[] }).foundAt);
}

function checkBaseAddress(baseAddress: unknown): void {
    const expected = shownSightings[0].map(derAddressIn).find(address => address !== null) ?? 0;
    shownSightings = [];
    const verdict = (typeof baseAddress === "number" && baseAddress === expected) ? "ok" : `WRONG, expected ${expected}`;
    console.log(`base address ${verdict}`);
}

function derAddressIn(sighting: string): number | null {
    const match = /(?:^|, )DER at (0x[0-9a-f]+)/.exec(sighting);
    return (match !== null) ? Number(match[1]) : null;
}

function render(value: unknown): string {
    return JSON.stringify(value, (_key, field) => {
        if (field instanceof ArrayBuffer) {
            return `<${field.byteLength} bytes: ${hexOf(field.slice(0, 16))}…>`;
        }
        if (field instanceof NativePointer) {
            return field.toString();
        }
        return field;
    });
}

function hexOf(bytes: ArrayBuffer): string {
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
