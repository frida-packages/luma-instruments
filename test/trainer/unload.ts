/// <reference path="./luma.d.ts" />

import { instrument } from "../../trainer/main.js";
import { FakeWidgets } from "./fake-widgets.js";

const widgets = new FakeWidgets();
const trainer = await instrument.create(widgets.context(), { settings: { types: "int32", unaligned: false } },
    {} as CustomInstrumentRestoredState);
const console1 = widgets.console(trainer);
const health = Process.mainModule.getExportByName("health");

await console1.type(String(health.readS32()));
await widgets.act(trainer, "list", "lock", `${health}:int32`);
console.log(`locked ${health}; the script now unloads without disposing the instrument`);
