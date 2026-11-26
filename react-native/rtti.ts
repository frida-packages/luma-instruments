import { TypeInfo, VtablePrefix } from "./cxx-abi.pat";
import { type MemorySearch, readMemory } from "./memory-search.js";

export interface TypeName {
    text: string;
    address: NativePointer;
}

const APPLE_NON_UNIQUE_NAME_BIT = ptr("0x8000000000000000");
const PRINTABLE_FIRST = 0x21;
const PRINTABLE_LAST = 0x7e;
const LONGEST_NAME = 4096;

export function typeNamesEndingWith(ranges: MemoryRange[], suffix: string, search: MemorySearch): TypeName[] {
    const names: TypeName[] = [];
    for (const range of ranges) {
        for (const match of search.scan(range, asciiPattern(`${suffix}\0`))) {
            for (const name of namesEndingAt(range, match.add(suffix.length))) {
                if (!names.some(known => known.address.equals(name.address))) {
                    names.push(name);
                }
            }
        }
    }
    return names;
}

export function primaryVtablesOf(ranges: MemoryRange[], name: TypeName, search: MemorySearch): NativePointer[] {
    const references = [name.address, name.address.or(APPLE_NON_UNIQUE_NAME_BIT)];
    const typeInfos = ranges.flatMap(range =>
        references.flatMap(reference => search.scan(range, TypeInfo.pattern({ name: reference }))));
    return ranges.flatMap(range =>
        typeInfos.flatMap(typeInfo => search.scan(range, VtablePrefix.pattern({ offsetToTop: 0, typeInfo }))))
        .map(address => address.add(VtablePrefix.size));
}

export function readableTypeName(mangled: string): string {
    const parts: string[] = [];
    let rest = mangled.replace(/^N/, "").replace(/E$/, "");
    for (let match = /^(\d+)/.exec(rest); match !== null; match = /^(\d+)/.exec(rest)) {
        const length = Number(match[1]);
        const part = rest.substr(match[1].length, length);
        parts.push(part.startsWith("_GLOBAL__N") ? "(anonymous namespace)" : part);
        rest = rest.slice(match[1].length + length);
    }
    return (parts.length !== 0) ? parts.join("::") : mangled;
}

function namesEndingAt(range: MemoryRange, end: NativePointer): TypeName[] {
    const windowStart = maxPointer(range.base, end.sub(LONGEST_NAME));
    const bytes = readMemory(windowStart, Number(end.sub(windowStart).toString()));
    if (bytes === null) {
        return [];
    }
    const view = new Uint8Array(bytes);
    let runStart = view.length;
    while (runStart !== 0 && isPrintable(view[runStart - 1])) {
        runStart--;
    }
    const run = String.fromCharCode(...view.subarray(runStart));
    const names: TypeName[] = [];
    for (let offset = 0; offset !== run.length; offset++) {
        const text = run.slice(offset);
        if (isNestedName(text)) {
            names.push({ text, address: end.sub(run.length - offset) });
        }
    }
    return names;
}

function maxPointer(a: NativePointer, b: NativePointer): NativePointer {
    return (a.compare(b) > 0) ? a : b;
}

function isNestedName(text: string): boolean {
    if (!text.startsWith("N") || !text.endsWith("E")) {
        return false;
    }
    let rest = text.slice(1, -1);
    while (rest.length !== 0) {
        const match = /^[1-9]\d*/.exec(rest);
        if (match === null) {
            return false;
        }
        const length = Number(match[0]);
        if (rest.length < match[0].length + length) {
            return false;
        }
        rest = rest.slice(match[0].length + length);
    }
    return true;
}

function isPrintable(byte: number): boolean {
    return byte >= PRINTABLE_FIRST && byte <= PRINTABLE_LAST;
}

function asciiPattern(text: string): string {
    return Array.from(text, character => character.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");
}
