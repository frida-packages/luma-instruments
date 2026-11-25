import { TypeInfo, VtablePrefix } from "./cxx-abi.pat";

export interface TypeName {
    text: string;
    address: NativePointer;
}

const APPLE_NON_UNIQUE_NAME_BIT = ptr("0x8000000000000000");
const PRINTABLE_FIRST = 0x21;
const PRINTABLE_LAST = 0x7e;

export function typeNamesEndingWith(ranges: MemoryRange[], suffix: string): TypeName[] {
    const names: TypeName[] = [];
    for (const range of ranges) {
        for (const match of scanQuietly(range, asciiPattern(`${suffix}\0`))) {
            const end = match.address.add(suffix.length);
            for (const start of nameStartsBefore(end)) {
                if (!names.some(name => name.address.equals(start))) {
                    names.push({ text: start.readUtf8String()!, address: start });
                }
            }
        }
    }
    return names;
}

export function primaryVtablesOf(ranges: MemoryRange[], name: TypeName): NativePointer[] {
    const references = [name.address, name.address.or(APPLE_NON_UNIQUE_NAME_BIT)];
    const typeInfos = ranges.flatMap(range =>
        references.flatMap(reference => scanQuietly(range, TypeInfo.pattern({ name: reference }))))
        .map(match => match.address);
    return ranges.flatMap(range =>
        typeInfos.flatMap(typeInfo => scanQuietly(range, VtablePrefix.pattern({ offsetToTop: 0, typeInfo }))))
        .map(match => match.address.add(VtablePrefix.size));
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

function nameStartsBefore(end: NativePointer): NativePointer[] {
    let runStart = end;
    while (isPrintable(runStart.sub(1).readU8())) {
        runStart = runStart.sub(1);
    }
    const run = runStart.readUtf8String(Number(end.sub(runStart).toString()))!;
    const starts: NativePointer[] = [];
    for (let offset = 0; offset !== run.length; offset++) {
        if (isNestedName(run.slice(offset))) {
            starts.push(runStart.add(offset));
        }
    }
    return starts;
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

function scanQuietly(range: MemoryRange, pattern: string): MemoryScanMatch[] {
    try {
        return Memory.scanSync(range.base, range.size, pattern);
    } catch (e) {
        return [];
    }
}
