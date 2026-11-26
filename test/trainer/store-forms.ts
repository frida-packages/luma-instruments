/// <reference path="./luma.d.ts" />

import { watchpointLocks, WriteLog } from "../../trainer/locks.js";
import { typesSelectedBy } from "../../trainer/value-types.js";

interface Form {
    name: string;
    outside: [number, number[]][];
    result?: number;
}

const LOCKED = 0x11223344;
const lockedBytes = [0x44, 0x33, 0x22, 0x11];
const forms: Form[] = [
    { name: "form_str_w", outside: [] },
    { name: "form_str_x", outside: [[4, [0x66, 0x66, 0x00, 0x00]]] },
    { name: "form_strb", outside: [] },
    { name: "form_strh", outside: [] },
    { name: "form_stur", outside: [] },
    { name: "form_str_s", outside: [] },
    { name: "form_str_d", outside: [[-4, [0x00, 0x00, 0x00, 0x00]]] },
    { name: "form_str_q", outside: [[-8, new Array(8).fill(0x3c)], [4, new Array(4).fill(0x3c)]] },
    { name: "form_pre", outside: [], result: 0 },
    { name: "form_post", outside: [], result: 12 },
    { name: "form_stp_w", outside: [[-4, [0x11, 0x11, 0x00, 0x00]]] },
    { name: "form_stp_x_pre", outside: [[-4, [0x33, 0x33, 0x00, 0x00]], [4, [0x44, 0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]]], result: -4 },
    { name: "form_reg", outside: [] },
    { name: "form_stlr", outside: [] },
    { name: "form_swp", outside: [], result: LOCKED },
];

const game = Process.mainModule;
const slab = game.getExportByName("slab");
const locked = slab.add(16);
const command = game.getExportByName("command");
const done = game.getExportByName("done");
const result = game.getExportByName("result");
const int32 = typesSelectedBy("int32")[0];
const log = new WriteLog(() => {});
const lock = watchpointLocks.lock({ address: locked, type: int32, value: LOCKED, where: "slab" }, log);
let failures = 0;

for (const [index, form] of forms.entries()) {
    resetOutside();
    const code = storeIn(form.name);
    command.writeS32(index);
    while (done.readS32() !== index) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    const problems: string[] = [];
    if (!same(Array.from(new Uint8Array(locked.readByteArray(4)!)), lockedBytes)) {
        problems.push(`locked bytes are ${hex(locked, 4)}`);
    }
    for (const [offset, bytes] of form.outside) {
        if (!same(Array.from(new Uint8Array(locked.add(offset).readByteArray(bytes.length)!)), bytes)) {
            problems.push(`bytes at ${offset} are ${hex(locked.add(offset), bytes.length)}, not ${bytes.map(b => b.toString(16)).join(" ")}`);
        }
    }
    if (form.result !== undefined) {
        const expected = (form.result === LOCKED) ? uint64(LOCKED) : uint64(locked.add(form.result).toString());
        if (!result.readU64().equals(expected)) {
            problems.push(`result is ${result.readU64().toString(16)}, not ${expected.toString(16)}`);
        }
    }
    const writes = log.writers.get(`${code}:${lock.start}`)?.writes ?? 0;
    if (writes !== 1) {
        problems.push(`${writes} writes counted from ${code}`);
    }
    if (lock.undone !== index + 1) {
        problems.push(`${lock.undone} writes undone after ${index + 1} forms`);
    }
    failures += (problems.length !== 0) ? 1 : 0;
    console.log(`${(problems.length === 0) ? "ok" : "FAIL"}: ${form.name} ${Instruction.parse(code)} ${problems.join("; ")}`);
}
watchpointLocks.unlock(lock);
console.log((failures === 0) ? `PASS (${forms.length} store forms)` : `FAIL: ${failures} of ${forms.length} store forms`);

function resetOutside(): void {
    slab.writeByteArray(new Array(16).fill(0xaa));
    slab.add(20).writeByteArray(new Array(44).fill(0xaa));
}

function storeIn(name: string): NativePointer {
    let at = game.getExportByName(name);
    while (!/^(st|swp)/.test(Instruction.parse(at).mnemonic)) {
        at = Instruction.parse(at).next;
    }
    return at;
}

function same(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((value, i) => value === b[i]);
}

function hex(address: NativePointer, length: number): string {
    return Array.from(new Uint8Array(address.readByteArray(length)!), b => b.toString(16)).join(" ");
}
