/// <reference path="./luma.d.ts" />

import { instrument } from "../../trainer/main.js";
import { FakeWidgets } from "./fake-widgets.js";

const SIGUSR2 = 31;
const POISON_TICKS = 5000;
const ROUNDS = 30;

const game = Process.mainModule;
const known = {
    int32: game.getExportByName("health"),
    float: game.getExportByName("hero").readPointer().add(16),
};
const statusText = game.getExportByName("game_status");
const kill = new NativeFunction(Module.getGlobalExportByName("kill"), "int", ["int", "int"]);
let waiting: (() => void) | null = null;
Interceptor.attach(game.getExportByName("game_status_changed"), {
    onEnter() {
        const resolve = waiting!;
        waiting = null;
        setTimeout(resolve, 0);
    },
});

const widgets = new FakeWidgets();
const trainer = await instrument.create(widgets.context(), { settings: { types: "common", unaligned: false } },
    {} as CustomInstrumentRestoredState);
const console1 = widgets.console(trainer);
await console1.type(/int=(\S+)/.exec(statusText.readUtf8String()!)![1]);
await console1.type(`lock ${rowOf(known.int32, "int32")}`);
await console1.type(`lock ${rowOf(known.float, "float")}`);

let extra = 0;
for (let round = 1; round <= ROUNDS; round++) {
    await widgets.actOnWidget(trainer, "writers", "clear");
    await poison();
    await new Promise(resolve => setTimeout(resolve, 300));
    const counts = widgets.tableRows("writers").map(row => Number(row.writes.replace(/,/g, "")));
    const wrong = counts.filter(count => count !== POISON_TICKS);
    if (wrong.length !== 0) {
        extra++;
    }
    console.log(`round ${round}: ${counts.join(" ")}${(wrong.length !== 0) ? " WRONG" : ""}`);
    if (wrong.length !== 0) {
        for (const row of widgets.tableRows("writers")) {
            console.log(`  ${row.code} ${row.function} ${row.writes} ${row.target}`);
        }
    }
}
console.log(`RESULT ${extra} of ${ROUNDS} rounds counted wrong`);
await trainer.dispose!();

async function poison(): Promise<void> {
    const changed = new Promise<void>(resolve => waiting = resolve);
    kill(Process.id, SIGUSR2);
    await changed;
}

function rowOf(address: NativePointer, type: string): string {
    return widgets.listRows().find(row => row.address === address.toString() && row.type === type)!.row;
}
