/// <reference path="./luma.d.ts" />

import { instrument } from "../../gstreamer/main.js";
import type { GraphState } from "../../gstreamer/graph-display.js";
import { scanningTitle } from "../../gstreamer/scan-status.js";

interface Expectation {
    name: string;
    type: string;
    kind: string;
    state: string;
    elements: number;
    presence: "listed" | "until-signal" | "absent" | "after-signal";
    foundBy: string;
    children: string[];
}

interface Row {
    id: string;
    cells: Record<string, string>;
}

interface SentGraph {
    value: GraphState;
    data: ArrayBuffer;
    dot: string;
}

interface WidgetCall {
    widget: string;
    method: string;
    afterDispose: boolean;
}

type Detail = "states" | "all" | "verbose";

const SIGUSR1 = (Process.platform === "darwin") ? 30 : 10;
const SCAN_TIMEOUT_MS = 30000;
const SETTLE_MS = 800;
const IDLE_MS = 2500;
const SIGNAL_SETTLE_MS = 1500;
const AFTER_DISPOSE_MS = 2500;
const COMPARED_BYTES = 16;
const details: Detail[] = ["states", "all", "verbose"];
const capsDetail = "format=(string)I420";
const fullCaps = "framerate=(fraction)15/1, pixel-aspect-ratio=(fraction)1/1";

const rows = new Map<string, Row>();
const graphs: SentGraph[] = [];
const calls: WidgetCall[] = [];
let disposed = false;
let scansFinished = 0;
let statusTitle = "";
let statusText = "";
let rescanEnabled = true;
let failures = 0;

const ctx = {
    emit(value: unknown) {
        console.log(`emit ${JSON.stringify(value)}`);
    },
    widget(id: string) {
        return new Proxy({}, {
            get(_target, method: string) {
                return (...args: any[]) => record(id, method, args);
            },
        });
    },
} as unknown as CustomInstrumentContext;

rpc.exports = {
    test(out: string): Promise<number> {
        return test(out);
    },
    explore(out: string, seconds: number): Promise<number> {
        return explore(out, seconds);
    },
};

async function test(out: string): Promise<number> {
    const expectations = JSON.parse(Module.getGlobalExportByName("gstreamer_expectations").readUtf8String()!) as Expectation[];
    const setState = Module.getGlobalExportByName("gst_element_set_state");
    const pristine = hexOf(setState.readByteArray(COMPARED_BYTES)!);

    const handle = await instrument.create(ctx, configWith("all", 1), { graph: { state: null } });
    checkRescan(false, "during the first scan");
    await scanFinished(1);
    checkRescan(true, "after the first scan");
    checkRows(expectations, "before-signal");
    checkAutoShown(expectations);
    handle.onAction!({ widget: "pipelines", action: "rescan" });
    checkRescan(false, "during the rescan");
    await scanFinished(2);
    checkRescan(true, "after the rescan");
    checkRows(expectations, "before-signal");
    for (const expected of expectations.filter(isListedBeforeSignal)) {
        checkShown(handle, expected, out);
    }
    await checkDetails(handle, out);
    await checkIdle(handle);
    await checkSignal(handle, expectations, out);

    await handle.dispose!();
    disposed = true;
    await sleep(AFTER_DISPOSE_MS);
    checkQuietAfterDispose();
    verify(hexOf(setState.readByteArray(COMPARED_BYTES)!) === pristine,
        "gst_element_set_state is back to its original bytes",
        "gst_element_set_state was left changed after dispose");
    console.log(`\n${failures} failures`);
    return failures;
}

async function explore(out: string, seconds: number): Promise<number> {
    const setState = Module.getGlobalExportByName("gst_element_set_state");
    const pristine = hexOf(setState.readByteArray(COMPARED_BYTES)!);
    const handle = await instrument.create(ctx, configWith("all", 1), { graph: { state: null } });
    await scanFinished(1);
    await sleep(seconds * 1000);
    console.log(`\n${rows.size} rows:`);
    for (const row of rows.values()) {
        console.log(`  ${Object.values(row.cells).join(" | ")}`);
    }
    for (const row of binRows()) {
        for (const detail of ["all", "verbose"] as Detail[]) {
            await handle.updateConfig!(configWith(detail, 1));
            handle.onAction!({ widget: "pipelines", action: "show", item: row.id });
            const shown = latestGraphOf(row.id);
            verify(shown !== null && shown.dot.startsWith("digraph"),
                `${row.cells.name} (${detail}): ${shown?.dot.length} bytes of dot`,
                `${row.cells.name} (${detail}): no graph was sent`);
            if (shown !== null) {
                saveDot(out, `${row.cells.name}-${detail}`, shown);
            }
        }
    }
    await handle.dispose!();
    disposed = true;
    await sleep(AFTER_DISPOSE_MS);
    checkQuietAfterDispose();
    verify(hexOf(setState.readByteArray(COMPARED_BYTES)!) === pristine,
        "gst_element_set_state is back to its original bytes",
        "gst_element_set_state was left changed after dispose");
    console.log(`\n${failures} failures`);
    return failures;
}

function record(widget: string, method: string, args: any[]): void {
    calls.push({ widget, method, afterDispose: disposed });
    if (widget === "pipelines" && method === "setActionEnabled" && args[0] === "rescan") {
        rescanEnabled = args[1];
    } else if (widget === "scan" && method === "upsertItem") {
        if (statusTitle === scanningTitle && args[0].title !== scanningTitle) {
            scansFinished++;
        }
        statusTitle = args[0].title;
        statusText = [args[0].title, args[0].subtitle, args[0].accessory].join(" | ");
    } else if (widget === "pipelines" && method === "upsertRow") {
        rows.set(args[0].id, args[0]);
    } else if (widget === "pipelines" && method === "removeRow") {
        rows.delete(args[0]);
    } else if (widget === "pipelines" && method === "clear") {
        rows.clear();
    } else if (widget === "graph" && method === "setState") {
        const data = args[1] as ArrayBuffer;
        graphs.push({ value: args[0], data, dot: textOf(data) });
    } else if (widget === "graph") {
        console.log(`graph.${method}()`);
    }
}

function configWith(detail: Detail, refreshInterval: number): CustomInstrumentConfig {
    return { settings: { details: detail, refreshInterval } };
}

function checkRescan(enabled: boolean, when: string): void {
    const state = enabled ? "enabled" : "disabled";
    verify(rescanEnabled === enabled, `Rescan memory is ${state} ${when}`, `Rescan memory is not ${state} ${when}`);
}

async function scanFinished(count: number): Promise<void> {
    const started = Date.now();
    while (scansFinished < count) {
        if (Date.now() - started > SCAN_TIMEOUT_MS) {
            throw new Error(`the scan did not finish: ${statusText}`);
        }
        await sleep(100);
    }
    await sleep(SETTLE_MS);
    console.log(`status: ${statusText}`);
}

function checkRows(expectations: Expectation[], phase: "before-signal" | "after-signal"): void {
    const expected = expectations.filter(phase === "before-signal" ? isListedBeforeSignal : isListedAfterSignal);
    const unexpected = expectations.filter(e => !expected.includes(e));
    console.log(`\n${phase}: ${rows.size} rows`);
    for (const row of rows.values()) {
        console.log(`  ${Object.values(row.cells).join(" | ")}`);
    }
    for (const e of expected) {
        const row = rowNamed(e.name);
        if (row === undefined) {
            verify(false, "", `${e.name} is not listed`);
            continue;
        }
        const wanted = { type: e.type, kind: e.kind, state: e.state, elements: String(e.elements), found: e.foundBy, address: row.id };
        const mismatches = Object.entries(wanted).filter(([column, value]) => row.cells[column] !== value)
            .map(([column, value]) => `${column} is ${row.cells[column]}, expected ${value}`);
        verify(mismatches.length === 0, `${e.name} is listed as expected`, `${e.name}: ${mismatches.join("; ")}`);
    }
    for (const e of unexpected) {
        verify(rowNamed(e.name) === undefined, `${e.name} is not listed`, `${e.name} is listed and should not be`);
    }
    const strays = binRows().filter(row => !expected.some(e => e.name === row.cells.name));
    verify(strays.length === 0, "nothing unexpected is listed", `unexpected rows: ${strays.map(row => row.cells.name).join(", ")}`);
}

function checkAutoShown(expectations: Expectation[]): void {
    const first = graphs[0];
    if (first === undefined) {
        verify(false, "", "no graph was shown without asking");
        return;
    }
    const expected = expectations.find(e => e.name === first.value.pipeline.name);
    verify(expected !== undefined && expected.kind === "pipeline",
        `${first.value.pipeline.name} was shown without asking`,
        `the graph shown without asking is ${first.value.pipeline.name}`);
}

function checkShown(handle: CustomInstrumentHandle, expected: Expectation, out: string): void {
    const row = rowNamed(expected.name)!;
    handle.onAction!({ widget: "pipelines", action: "show", item: row.id });
    const shown = graphs[graphs.length - 1];
    const { pipeline } = shown.value;
    const missing = expected.children.filter(child => !shown.dot.includes(child));
    const problems = [
        ...(pipeline.id !== row.id ? [`the graph is of ${pipeline.id}`] : []),
        ...(pipeline.name !== expected.name ? [`it is named ${pipeline.name}`] : []),
        ...(pipeline.type !== expected.type ? [`its type is ${pipeline.type}`] : []),
        ...(pipeline.state !== expected.state ? [`its state is ${pipeline.state}`] : []),
        ...(!shown.dot.startsWith("digraph") ? ["its data does not start with digraph"] : []),
        ...(missing.length !== 0 ? [`its dot does not name ${missing.join(", ")}`] : []),
    ];
    verify(problems.length === 0, `Show ${expected.name}: ${shown.dot.length} bytes of dot naming every element`,
        `Show ${expected.name}: ${problems.join("; ")}`);
    saveDot(out, expected.name, shown);
}

async function checkDetails(handle: CustomInstrumentHandle, out: string): Promise<void> {
    const row = rowNamed("tee-pipeline")!;
    const dots = new Map<Detail, SentGraph>();
    for (const detail of details) {
        await handle.updateConfig!(configWith(detail, 1));
        handle.onAction!({ widget: "pipelines", action: "show", item: row.id });
        const shown = graphs[graphs.length - 1];
        dots.set(detail, shown);
        verify(shown.value.details === detail && shown.value.pipeline.id === row.id,
            `detail ${detail}: ${shown.dot.length} bytes`,
            `detail ${detail}: the last graph has details ${shown.value.details} for ${shown.value.pipeline.name}`);
        saveDot(out, `tee-pipeline-${detail}`, shown);
    }
    const [states, all, verbose] = details.map(detail => dots.get(detail)!.dot);
    verify(!states.includes(capsDetail) && all.includes(capsDetail) && !all.includes(fullCaps) && verbose.includes(fullCaps),
        "caps details appear from the default detail on, and in full only when verbose",
        `caps detail in states, all, verbose: ${[states, all, verbose].map(dot => dot.includes(capsDetail))}; `
            + `full caps: ${[states, all, verbose].map(dot => dot.includes(fullCaps))}`);
    await handle.updateConfig!(configWith("all", 1));
}

async function checkIdle(handle: CustomInstrumentHandle): Promise<void> {
    const row = rowNamed("lonely-bin")!;
    handle.onAction!({ widget: "pipelines", action: "show", item: row.id });
    const before = graphs.length;
    await sleep(IDLE_MS);
    verify(graphs.length === before, "an unchanging graph is not sent again",
        `${graphs.length - before} states were sent for an unchanging graph`);
}

async function checkSignal(handle: CustomInstrumentHandle, expectations: Expectation[], out: string): Promise<void> {
    const app = rowNamed("app-pipeline")!;
    handle.onAction!({ widget: "pipelines", action: "show", item: app.id });
    const clearsBefore = calls.filter(call => call.widget === "graph" && call.method === "clear").length;
    new NativeFunction(Module.getGlobalExportByName("raise"), "int", ["int"])(SIGUSR1);
    await sleep(SIGNAL_SETTLE_MS);
    checkRows(expectations, "after-signal");
    const clearsAfter = calls.filter(call => call.widget === "graph" && call.method === "clear").length;
    const last = graphs[graphs.length - 1];
    verify(clearsAfter === clearsBefore && last.value.pipeline.name === "late-pipeline",
        "after app-pipeline died the view went on to late-pipeline without being cleared",
        `after app-pipeline died the view shows ${last.value.pipeline.name}, cleared ${clearsAfter - clearsBefore} times`);
    const late = rowNamed("late-pipeline");
    if (late !== undefined) {
        checkShown(handle, expectations.find(e => e.name === "late-pipeline")!, out);
    }
}

function checkQuietAfterDispose(): void {
    const late = calls.filter(call => call.afterDispose);
    verify(late.length === 0, "no widget call after dispose",
        `widget calls after dispose: ${late.map(call => `${call.widget}.${call.method}`).join(", ")}`);
}

function isListedBeforeSignal(e: Expectation): boolean {
    return e.presence === "listed" || e.presence === "until-signal";
}

function isListedAfterSignal(e: Expectation): boolean {
    return e.presence === "listed" || e.presence === "after-signal";
}

function rowNamed(name: string): Row | undefined {
    return binRows().find(row => row.cells.name === name);
}

function binRows(): Row[] {
    return [...rows.values()];
}

function latestGraphOf(id: string): SentGraph | null {
    return [...graphs].reverse().find(graph => graph.value.pipeline.id === id) ?? null;
}

function saveDot(out: string, name: string, graph: SentGraph): void {
    send({ type: "dot", path: `${out}/${name}.dot` }, graph.data);
}

function verify(passed: boolean, success: string, failure: string): void {
    if (!passed) {
        failures++;
    }
    console.log(passed ? `PASS ${success}` : `FAIL ${failure}`);
}

function textOf(data: ArrayBuffer): string {
    return Array.from(new Uint8Array(data), byte => String.fromCharCode(byte)).join("");
}

function hexOf(bytes: ArrayBuffer): string {
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

function sleep(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
