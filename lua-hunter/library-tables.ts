import { boundedCStringAt, type ModuleImage } from "./module-image.js";

export interface LibraryFunction {
    name: string;
    address: NativePointer;
}

type EntryReading = LibraryFunction | "placeholder" | "invalid";

const libraryMarkers = ["collectgarbage", "gmatch", "concat", "randomseed", "difftime", "running"];
const standardNames = new Set([
    "assert", "collectgarbage", "dofile", "error", "getmetatable", "ipairs", "load", "loadfile", "loadstring", "next", "pairs",
    "pcall", "print", "rawequal", "rawget", "rawlen", "rawset", "select", "setmetatable", "tonumber", "tostring", "type", "unpack",
    "xpcall", "byte", "char", "dump", "find", "format", "gmatch", "gsub", "len", "lower", "match", "rep", "reverse", "sub", "upper",
    "concat", "insert", "remove", "sort", "pack", "maxn", "abs", "ceil", "floor", "fmod", "max", "min", "random", "randomseed",
    "sqrt", "sin", "cos", "clock", "date", "difftime", "execute", "exit", "getenv", "rename", "time", "tmpname", "create",
    "resume", "running", "status", "wrap", "yield",
]);
const MIN_STANDARD_NAMES = 4;
const ENTRY_SIZE = 2 * Process.pointerSize;
const MAX_ENTRIES = 64;
const MAX_NAME_LENGTH = 32;
const namePattern = /^[_A-Za-z][_A-Za-z0-9]*$/;

export function findLibraryFunctions(image: ModuleImage): LibraryFunction[] {
    const markerStrings = libraryMarkers.flatMap(marker => image.findCStrings(marker, "whole"));
    if (markerStrings.length === 0) {
        return [];
    }
    const functions = new Map<string, LibraryFunction>();
    for (const { address: slot } of Memory.findPointers(image.data, markerStrings)) {
        const table = tableAround(image, slot);
        if (table.filter(entry => standardNames.has(entry.name)).length < MIN_STANDARD_NAMES) {
            continue;
        }
        for (const entry of table) {
            functions.set(entry.address.toString(), entry);
        }
    }
    return [...functions.values()];
}

function tableAround(image: ModuleImage, slot: NativePointer): LibraryFunction[] {
    const isEntry = (address: NativePointer) => readEntry(image, address) !== "invalid";
    if (!isEntry(slot)) {
        return [];
    }
    let first = slot;
    for (let count = 0; count !== MAX_ENTRIES && isEntry(first.sub(ENTRY_SIZE)); count++) {
        first = first.sub(ENTRY_SIZE);
    }
    const entries: LibraryFunction[] = [];
    for (let entry = first; entries.length !== MAX_ENTRIES; entry = entry.add(ENTRY_SIZE)) {
        const reading = readEntry(image, entry);
        if (reading === "invalid") {
            break;
        }
        if (reading !== "placeholder") {
            entries.push(reading);
        }
    }
    return entries;
}

function readEntry(image: ModuleImage, entry: NativePointer): EntryReading {
    let name: NativePointer;
    let address: NativePointer;
    try {
        name = entry.readPointer();
        address = entry.add(Process.pointerSize).readPointer().strip();
    } catch (e) {
        return "invalid";
    }
    if (!image.contains(name)) {
        return "invalid";
    }
    const text = identifierAt(name);
    if (text === null) {
        return "invalid";
    }
    if (address.isNull()) {
        return "placeholder";
    }
    return image.isCode(address) ? { name: text, address } : "invalid";
}

function identifierAt(address: NativePointer): string | null {
    const text = boundedCStringAt(address, MAX_NAME_LENGTH + 1);
    return namePattern.test(text) ? text : null;
}
