/// <reference path="./luma.d.ts" />

import { instrument } from "../../iokit/main.js";

let events = 0;

const ctx = {
    emit() {
        events++;
    },
    widget() {
        return new Proxy({}, { get: () => () => {} });
    },
} as unknown as CustomInstrumentContext;

const config: CustomInstrumentConfig = { settings: { backtraces: false, dataLimit: 256, callsPerSecond: 100 } };
const restored = { methods: { rows: [] }, lookups: { rows: [] }, properties: { rows: [] }, explorer: { entries: [] } };

await instrument.create(ctx, config, restored as unknown as CustomInstrumentRestoredState);

setInterval(() => console.log(`${events} events`), 1000);
