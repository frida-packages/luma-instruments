/// <reference path="./instrument-typings.d.ts" />

import { instrument } from "../../certificates/main.js";

let phase: "running" | "disposed" = "running";

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
                    if (id === "scan" || method === "appendOutput" || method === "appendError") {
                        console.log(`widget ${id}.${method}(${JSON.stringify(args)})`);
                    }
                };
            },
        });
    },
} as unknown as CustomInstrumentContext;

const handle = await instrument.create(ctx, { features: { scope: "readable" } }, {});
await pause(1500);
console.log("rescan while scanning");
await handle.onAction!({ widget: "scan", action: "rescan", item: "scan" });
await pause(1500);
console.log("switch scope twice while scanning");
await handle.updateConfig!({ features: { scope: "writable" } });
await handle.updateConfig!({ features: { scope: "readable" } });
await pause(1500);
await handle.dispose!();
phase = "disposed";
console.log("disposed while scanning");

function pause(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
