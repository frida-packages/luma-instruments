/// <reference path="./luma.d.ts" />

import { instrument } from "../../xpc-spy/main.js";

let emitted = 0;
let widgetCalls = 0;

const ctx = {
    emit() {
        emitted++;
    },
    widget() {
        return new Proxy({}, { get: () => () => widgetCalls++ });
    },
} as unknown as CustomInstrumentContext;

const config: CustomInstrumentConfig = { features: { backtraces: false, dataLimit: 4096 } };
const restored = { services: { rows: [] } } as unknown as CustomInstrumentRestoredState;

const handle = await instrument.create(ctx, config, restored);

const report = setInterval(() => {
    console.log(`emitted ${emitted}, widget calls ${widgetCalls}`);
}, 2000);

setTimeout(() => {
    clearInterval(report);
    handle.dispose!();
    console.log(`disposed after ${emitted} events`);
}, 12000);
