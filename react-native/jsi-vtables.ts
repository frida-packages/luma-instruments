import { type MemorySearch, readPointer } from "./memory-search.js";
import { primaryVtablesOf, typeNamesEndingWith } from "./rtti.js";

export interface JsiSlots {
    evaluateJavaScript: number;
    global: number;
    utf8: number;
    call: number;
    deletingDestructor: number | null;
}

export type AnchorRoute = "exports" | "type names";

export interface JsiBase {
    module: Module;
    vtable: NativePointer;
    slots: JsiSlots;
    route: AnchorRoute;
}

const BASE_VTABLE_SYMBOL = "_ZTVN8facebook3jsi7RuntimeE";
const BASE_TYPE_NAME = "N8facebook3jsi7RuntimeE";
const DELETING_DESTRUCTOR_SYMBOL = "_ZN8facebook3jsi7RuntimeD0Ev";
const VTABLE_ADDRESS_POINT_OFFSET = 2 * Process.pointerSize;
const MAX_SLOTS = 256;

const anchorSymbols = {
    instrumentation: "_ZN8facebook3jsi7Runtime15instrumentationEv",
    createValueFromJsonUtf8: "_ZN8facebook3jsi7Runtime23createValueFromJsonUtf8EPKhm",
    pushScope: "_ZN8facebook3jsi7Runtime9pushScopeEv",
};

const SLOTS_BEFORE_INSTRUMENTATION = 3;
const SLOTS_BEFORE_CREATE_VALUE_FROM_JSON = 1;
const SLOTS_BEFORE_PUSH_SCOPE = 2;
const PURE_SLOTS_FROM_INSTRUMENTATION_TO_UTF8 = 21;
const PURE_SLOTS_FROM_INSTRUMENTATION_TO_CALL = 51;

export function findJsiBase(module: Module, routes: AnchorRoute[], search: MemorySearch): JsiBase | null {
    for (const route of routes) {
        const base = (route === "exports") ? baseFromExports(module) : baseFromTypeNames(module, search);
        if (base !== null) {
            return base;
        }
    }
    return null;
}

function baseFromExports(module: Module): JsiBase | null {
    const symbol = module.findExportByName(BASE_VTABLE_SYMBOL);
    const anchors = Object.values(anchorSymbols).map(name => module.findExportByName(name));
    if (symbol === null || anchors.includes(null)) {
        return null;
    }
    const vtable = symbol.add(VTABLE_ADDRESS_POINT_OFFSET);
    const entries = slotEntries(vtable);
    const [instrumentation, createValueFromJsonUtf8, pushScope] = anchors.map(anchor => slotHolding(entries, anchor!));
    const deletingDestructor = module.findExportByName(DELETING_DESTRUCTOR_SYMBOL);
    return {
        module,
        vtable,
        slots: {
            evaluateJavaScript: firstPureSlot(entries),
            global: instrumentation - SLOTS_BEFORE_INSTRUMENTATION,
            utf8: createValueFromJsonUtf8 - SLOTS_BEFORE_CREATE_VALUE_FROM_JSON,
            call: pushScope - SLOTS_BEFORE_PUSH_SCOPE,
            deletingDestructor: (deletingDestructor !== null) ? slotHolding(entries, deletingDestructor) : null,
        },
        route: "exports",
    };
}

function baseFromTypeNames(module: Module, search: MemorySearch): JsiBase | null {
    const ranges = readableRangesOf(module);
    const vtable = typeNamesEndingWith(ranges, BASE_TYPE_NAME, search)
        .filter(candidate => candidate.text === BASE_TYPE_NAME)
        .flatMap(name => primaryVtablesOf(ranges, name, search))[0];
    if (vtable === undefined) {
        return null;
    }
    return { module, vtable, slots: structuralSlots(slotEntries(vtable)), route: "type names" };
}

export function structuralSlots(entries: NativePointer[]): JsiSlots {
    const pure = mostFrequent(entries);
    const evaluateJavaScript = entries.findIndex(entry => entry.equals(pure));
    const instrumentation = entries.findIndex((entry, index) => index > evaluateJavaScript && !entry.equals(pure));
    const pureBeforeInstrumentation = entries.slice(evaluateJavaScript, instrumentation).length;
    const pureSlots = entries.map((entry, index) => entry.equals(pure) ? index : -1).filter(index => index !== -1);
    return {
        evaluateJavaScript,
        global: instrumentation - SLOTS_BEFORE_INSTRUMENTATION,
        utf8: pureSlots[pureBeforeInstrumentation + PURE_SLOTS_FROM_INSTRUMENTATION_TO_UTF8 - 1],
        call: pureSlots[pureBeforeInstrumentation + PURE_SLOTS_FROM_INSTRUMENTATION_TO_CALL - 1],
        deletingDestructor: null,
    };
}

export function slotEntries(vtable: NativePointer): NativePointer[] {
    const code = Process.enumerateRanges("--x");
    const entries: NativePointer[] = [];
    for (let i = 0; i !== MAX_SLOTS; i++) {
        const entry = readPointer(vtable.add(i * Process.pointerSize))?.strip() ?? null;
        if (entry === null || !isCode(code, entry)) {
            break;
        }
        entries.push(entry);
    }
    return entries;
}

export function slotFunction(vtable: NativePointer, slot: number): NativePointer {
    return vtable.add(slot * Process.pointerSize).readPointer().strip();
}

export function readableRangesOf(module: Module): MemoryRange[] {
    return module.enumerateRanges("r--").map(({ base, size }) => ({ base, size }));
}

function slotHolding(entries: NativePointer[], implementation: NativePointer): number {
    return entries.findIndex(entry => entry.equals(implementation.strip()));
}

function firstPureSlot(entries: NativePointer[]): number {
    const pure = mostFrequent(entries);
    return entries.findIndex(entry => entry.equals(pure));
}

function mostFrequent(entries: NativePointer[]): NativePointer {
    const counts = new Map<string, { entry: NativePointer; count: number }>();
    for (const entry of entries) {
        const key = entry.toString();
        const tally = counts.get(key) ?? { entry, count: 0 };
        tally.count++;
        counts.set(key, tally);
    }
    return [...counts.values()].reduce((best, tally) => (tally.count > best.count) ? tally : best).entry;
}

function isCode(code: RangeDetails[], address: NativePointer): boolean {
    return code.some(range => address.compare(range.base) >= 0 && address.compare(range.base.add(range.size)) < 0);
}
