/// <reference path="./instrument-typings.d.ts" />

import { instrument } from "../../certificates/main.js";

const scanFinishedPrefix = "Scanned ";

let phase: "running" | "disposed" = "running";
let disabledActions = new Set<string>();
let onScanFinished = () => {};

const ctx = {
    emit() {
    },
    widget(id: string) {
        return new Proxy({}, {
            get(_target, method: string) {
                return (...args: unknown[]) => {
                    if (phase === "disposed") {
                        console.log(`widget call after dispose: ${id}.${method}`);
                    }
                    if (method === "setActionEnabled") {
                        noteActionEnabled(`${id}.${args[0]}`, args[1] as boolean);
                    }
                    if (method === "appendOutput" && (args[0] as string).startsWith(scanFinishedPrefix)) {
                        onScanFinished();
                    }
                    if (id === "scan" || method === "appendOutput" || method === "appendError" || method === "setActionEnabled") {
                        console.log(`widget ${id}.${method}(${JSON.stringify(args)})`);
                    }
                };
            },
        });
    },
} as unknown as CustomInstrumentContext;

const handle = await instrument.create(ctx, { settings: { scope: "readable" } }, {});
await pause(1500);
expectRescan(false, "while a scan of all readable memory is under way");
console.log("switch scope twice while scanning");
await handle.updateConfig!({ settings: { scope: "writable" } });
await handle.updateConfig!({ settings: { scope: "readable" } });
await pause(1500);
expectRescan(false, "while the restarted scan is under way");
await handle.dispose!();
phase = "disposed";
console.log("disposed while scanning");
await pause(1500);

phase = "running";
disabledActions = new Set();
console.log("created again");
const fresh = await instrument.create(ctx, { settings: { scope: "writable" } }, {});
expectRescan(false, "during the new instance's first scan");
await scanFinished();
expectRescan(true, "once the new instance's first scan has finished");
await fresh.dispose!();
console.log("disposed");

function expectRescan(enabled: boolean, when: string): void {
    const actual = !disabledActions.has("certificates.rescan");
    console.log(`rescan ${enabled ? "enabled" : "disabled"} ${when}: ${(actual === enabled) ? "ok" : "WRONG"}`);
}

function noteActionEnabled(key: string, enabled: boolean): void {
    if (enabled) {
        disabledActions.delete(key);
    } else {
        disabledActions.add(key);
    }
}

function scanFinished(): Promise<void> {
    return new Promise(resolve => {
        onScanFinished = resolve;
    });
}

function pause(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
