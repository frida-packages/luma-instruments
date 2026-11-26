/// <reference path="./luma.d.ts" />

import { instrument } from "../../xpc-spy/main.js";

const RUNS = 2;
const RUN_MS = 4000;
const SETTLE_MS = 1000;

const config: CustomInstrumentConfig = { settings: { backtraces: false, dataLimit: 64, messagesPerSecond: 100 } };
const restored = { services: { rows: [] } } as unknown as CustomInstrumentRestoredState;

const emitted = Array.from({ length: RUNS }, () => 0);
let current = 0;
let afterDispose = 0;

exercise().catch(error => console.log(`failed: ${error.stack}`));

async function exercise(): Promise<void> {
    for (let run = 0; run !== RUNS; run++) {
        current = run;
        const started = Date.now();
        const handle = await instrument.create(contextFor(run), config, restored);
        console.log(`run ${run + 1}: created in ${Date.now() - started} ms`);
        await sleep(RUN_MS);
        await handle.dispose!();
        current = -1;
    }
    await sleep(SETTLE_MS);
    console.log(`events per run: ${emitted.join(", ")}; events after their run was disposed: ${afterDispose}`);
}

function contextFor(run: number): CustomInstrumentContext {
    return {
        emit() {
            if (run === current) {
                emitted[run]++;
            } else {
                afterDispose++;
            }
        },
        widget(id: string) {
            return new Proxy({}, {
                get(_target, method: string) {
                    return (...args: unknown[]) => noteWidgetCall(run, id, method, args);
                },
            });
        },
    } as unknown as CustomInstrumentContext;
}

function noteWidgetCall(run: number, id: string, method: string, args: unknown[]): void {
    const text = String(args[0]);
    if (id === "messages" && (method === "appendError" || (method === "appendOutput" && !text.startsWith("#")))) {
        console.log(`run ${run + 1}: ${method} ${text}`);
    }
}

function sleep(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
