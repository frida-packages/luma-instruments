/// <reference path="./luma.d.ts" />

import { instrument } from "../../trainer/main.js";
import { FakeWidgets } from "./fake-widgets.js";

const value = "100";
const waitBetweenStepsMs = 1500;

const widgets = new FakeWidgets();
const trainer = await instrument.create(widgets.context(), { features: { types: "common", unaligned: false } },
    {} as CustomInstrumentRestoredState);
const console1 = widgets.console(trainer);

await console1.type(value);
await sleep(waitBetweenStepsMs);
await console1.type("same");
await sleep(waitBetweenStepsMs);
await console1.type("changed");
await console1.type("undo");
await console1.type(value);

await console1.type("reset");
const scan = console1.type(value);
await sleep(30);
await console1.type("87");
await console1.type("stop");
await scan;

await console1.type("0");

trainer.updateConfig!({ features: { types: "all", unaligned: false } });
await console1.type("reset");
await console1.type(value);
trainer.updateConfig!({ features: { types: "int32", unaligned: true } });
await console1.type("reset");
await console1.type(value);

await trainer.dispose!();
console.log("done");

function sleep(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
