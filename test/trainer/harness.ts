/// <reference path="./luma.d.ts" />

import { instrument } from "../../trainer/main.js";
import { FakeWidgets, type Console } from "./fake-widgets.js";

const SIGUSR1 = 30;
const SIGUSR2 = 31;
const POISON_TICKS = 5000;

const game = Process.mainModule;
const known = {
    int32: game.getExportByName("health"),
    float: game.getExportByName("hero").readPointer().add(16),
    double: game.getExportByName("shield").readPointer(),
};
const statusText = game.getExportByName("game_status");
const kill = new NativeFunction(Module.getGlobalExportByName("kill"), "int", ["int", "int"]);

class Screen {
    #waiting: (() => void) | null = null;

    constructor() {
        Interceptor.attach(game.getExportByName("game_status_changed"), {
            onEnter: () => {
                const resolve = this.#waiting!;
                this.#waiting = null;
                setTimeout(resolve, 0);
            },
        });
    }

    shown(field: string): string {
        return new RegExp(`${field}=(\\S+)`).exec(statusText.readUtf8String()!)![1];
    }

    async after(signal: number): Promise<number> {
        const started = Date.now();
        const changed = new Promise<void>(resolve => this.#waiting = resolve);
        kill(Process.id, signal);
        await changed;
        return Date.now() - started;
    }
}

const screen = new Screen();
const widgets = new FakeWidgets();
const trainer = await instrument.create(widgets.context(), { settings: { types: "common", unaligned: false } },
    {} as CustomInstrumentRestoredState);
const console1: Console = widgets.console(trainer);

const openingHints = () => widgets.appended.filter(text => text.includes("Type help")).length;
expect(openingHints() === 1, "an opening hint is shown when the instrument starts");
await console1.type("help");
await console1.type("hello");
await console1.type(screen.shown("int"));
expectKnownAmongCandidates("first scan");

await screen.after(SIGUSR1);
await console1.type(screen.shown("int"));
await screen.after(SIGUSR1);
await console1.type("dec 13");
await console1.type("same");
await screen.after(SIGUSR1);
await console1.type("-");
expectKnownAmongCandidates("narrowing");
expect(widgets.listRows().length === widgets.counter("candidates"), "every candidate is listed");

const intRow = rowOf(known.int32, "int32");
const floatRow = rowOf(known.float, "float");
const doubleRow = rowOf(known.double, "double");

await widgets.act(trainer, "list", "memory", widgets.listRowId(intRow));
const healthAddress = Number(known.int32.toString());
const healthPage = healthAddress - (healthAddress % Process.pageSize);
const expectedBase = Math.max(healthPage, (healthAddress - 128) - ((healthAddress - 128) % 16));
expect(widgets.hexBase() === expectedBase, `memory around a candidate is shown from ${ptr(expectedBase)}, as a number`);

await console1.type(`set ${intRow} 500`);
await console1.type(`set ${floatRow},${doubleRow} 300.5`);
await screen.after(SIGUSR1);
expect(screen.shown("int") === "487" && screen.shown("float") === "287.50" && screen.shown("double") === "287.50",
    `the game took a hit from the written values (${statusText.readUtf8String()})`);
await console1.type("dec 13");
expectKnownAmongCandidates("after set");
await console1.type("undo");
await console1.type("dec 13");
expectKnownAmongCandidates("after undo");

await widgets.act(trainer, "list", "keep", widgets.listRowId(rowOf(known.int32, "int32")));
expect(widgets.counter("candidates") === 1, "keep only leaves one candidate");
await console1.type("undo");

await console1.type(`lock ${rowOf(known.int32, "int32")} 500`);
await console1.type(`lock ${rowOf(known.float, "float")}`);
const lockedFloat = screen.shown("float");
const lockedPoisonMs = await screen.after(SIGUSR2);
expect(screen.shown("int") === "500" && screen.shown("float") === lockedFloat,
    `locked values survive ${POISON_TICKS} writes from a new thread (${statusText.readUtf8String()})`);
await screen.after(SIGUSR1);
expect(screen.shown("int") === "500", "a locked value survives a hit");
await new Promise(resolve => setTimeout(resolve, 300));
const writers = widgets.tableRows("writers");
const poisonWriters = writers.filter(row => isInPoison(ptr(row.code)));
const hitWriters = writers.filter(row => !isInPoison(ptr(row.code)) && row.function.startsWith("game"));
expect(poisonWriters.length === 2 && poisonWriters.every(row => Number(row.writes.replace(/,/g, "")) === POISON_TICKS),
    "the poison thread is reported as writing each locked value 5000 times");
expect(hitWriters.length === 2, "take_hit is reported as a writer");
expect(writers.every(row => /^0x[0-9a-f]+$/.test(row.code) && /^0x[0-9a-f]+$/.test(row.target)), "writer addresses are plain hex");
await widgets.actOnWidget(trainer, "writers", "clear");
expect(widgets.tableRows("writers").length === 0, "Clear empties the writers table");

await console1.type("unlock 1");
const unlockedPoisonMs = await screen.after(SIGUSR2);
expect(screen.shown("int") === String(500 - POISON_TICKS) && screen.shown("float") === lockedFloat,
    `unlocking lock 1 lets the integer change while lock 2 holds (${statusText.readUtf8String()})`);
await new Promise(resolve => setTimeout(resolve, 300));
const writersSinceClear = widgets.tableRows("writers");
expect(writersSinceClear.length === 1 && Number(writersSinceClear[0].writes.replace(/,/g, "")) === POISON_TICKS,
    "after Clear, writers are counted again from nothing");
await console1.type("unlock");
await screen.after(SIGUSR2);
expect(screen.shown("float") !== lockedFloat, "unlocking everything lets the float change");
console.log(`poison run: ${lockedPoisonMs} ms with two locks, ${unlockedPoisonMs} ms with one`);

await widgets.actOnWidget(trainer, "console", "clear");
expect(widgets.cleared.includes("console"), "Clear empties the console");
expect(widgets.disabledActions.size === 0, "no action was disabled");

await console1.type("reset");
await console1.type("4242");
await console1.type("lock 1-5");
expect(widgets.tableRows("locks").length === 4, "four values can be locked at once");
expect(console1.errors.some(text => text.includes("All 4 hardware watchpoints are in use")), "a fifth lock is refused");
await console1.type("reset");
expect(widgets.tableRows("locks").length === 0, "reset releases every lock");
expect(openingHints() === 1, "the opening hint is not shown again on reset");
await console1.type("4242");
await console1.type("lock 8");
expect(widgets.tableRows("locks").length === 1, "watchpoints are free again after reset");

await trainer.dispose!();
const freePoisonMs = await screen.after(SIGUSR2);
console.log(`poison run: ${freePoisonMs} ms with no locks`);
console.log(`PASS (${statusText.readUtf8String()})`);

function expectKnownAmongCandidates(stage: string): void {
    for (const [type, address] of Object.entries(known)) {
        expect(widgets.listRows().some(row => row.address === address.toString() && row.type === type),
            `${stage}: ${type} at ${address} is listed`);
    }
}

function rowOf(address: NativePointer, type: string): string {
    return widgets.listRows().find(row => row.address === address.toString() && row.type === type)!.row;
}

function isInPoison(code: NativePointer): boolean {
    const poison = game.getExportByName("poison");
    return code.compare(poison) >= 0 && code.compare(poison.add(0x100)) < 0;
}

function expect(condition: boolean, what: string): void {
    if (!condition) {
        console.log(`FAIL: ${what}`);
        throw new Error(what);
    }
    console.log(`ok: ${what}`);
}
