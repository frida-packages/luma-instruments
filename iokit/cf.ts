import { keepBytes } from "./kept-bytes.js";
import { summarize } from "./summary.js";

const EXPANDED_LEVELS = 2;
const NODES_PER_VALUE = 2000;
const ENTRIES_PER_CONTAINER = 256;
const NESTED_SUMMARY_LENGTH = 160;
const UTF8 = 0x08000100;
const SINT64 = 4;
const FLOAT64 = 6;

const framework = Module.load("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");

export const cf = {
    release: new NativeFunction(exported("CFRelease"), "void", ["pointer"]),
    getTypeID: new NativeFunction(exported("CFGetTypeID"), "uint", ["pointer"]),
    copyTypeIDDescription: new NativeFunction(exported("CFCopyTypeIDDescription"), "pointer", ["ulong"]),
    stringCreateWithCString: new NativeFunction(exported("CFStringCreateWithCString"), "pointer", ["pointer", "pointer", "uint"]),
    stringGetLength: new NativeFunction(exported("CFStringGetLength"), "int64", ["pointer"]),
    stringGetMaximumSizeForEncoding: new NativeFunction(exported("CFStringGetMaximumSizeForEncoding"), "int64", ["long", "uint"]),
    stringGetCString: new NativeFunction(exported("CFStringGetCString"), "bool", ["pointer", "pointer", "long", "uint"]),
    numberIsFloatType: new NativeFunction(exported("CFNumberIsFloatType"), "bool", ["pointer"]),
    numberGetValue: new NativeFunction(exported("CFNumberGetValue"), "bool", ["pointer", "long", "pointer"]),
    booleanGetValue: new NativeFunction(exported("CFBooleanGetValue"), "bool", ["pointer"]),
    dataGetLength: new NativeFunction(exported("CFDataGetLength"), "int64", ["pointer"]),
    dataGetBytePtr: new NativeFunction(exported("CFDataGetBytePtr"), "pointer", ["pointer"]),
    dictionaryGetCount: new NativeFunction(exported("CFDictionaryGetCount"), "int64", ["pointer"]),
    dictionaryGetKeysAndValues: new NativeFunction(exported("CFDictionaryGetKeysAndValues"), "void", ["pointer", "pointer", "pointer"]),
    arrayGetCount: new NativeFunction(exported("CFArrayGetCount"), "int64", ["pointer"]),
    arrayGetValueAtIndex: new NativeFunction(exported("CFArrayGetValueAtIndex"), "pointer", ["pointer", "long"]),
};

const typeIds = {
    string: typeIdOf("CFStringGetTypeID"),
    number: typeIdOf("CFNumberGetTypeID"),
    boolean: typeIdOf("CFBooleanGetTypeID"),
    data: typeIdOf("CFDataGetTypeID"),
    dictionary: typeIdOf("CFDictionaryGetTypeID"),
    array: typeIdOf("CFArrayGetTypeID"),
};

export function toJavaScript(object: NativePointer, dataLimit: number): unknown {
    return new Conversion(dataLimit).convert(object, 0);
}

export function createString(text: string): NativePointer {
    return cf.stringCreateWithCString(NULL, Memory.allocUtf8String(text), UTF8);
}

export function stringOf(object: NativePointer): string {
    const size = cf.stringGetMaximumSizeForEncoding(cf.stringGetLength(object).toNumber(), UTF8).toNumber() + 1;
    const buffer = Memory.alloc(size);
    cf.stringGetCString(object, buffer, size, UTF8);
    return buffer.readUtf8String()!;
}

class Conversion {
    readonly #dataLimit: number;
    #remainingNodes = NODES_PER_VALUE;

    constructor(dataLimit: number) {
        this.#dataLimit = dataLimit;
    }

    convert(object: NativePointer, level: number): unknown {
        this.#remainingNodes--;
        switch (cf.getTypeID(object)) {
            case typeIds.dictionary:
                return this.#convertEntries(object, level);
            case typeIds.array:
                return this.#convertElements(object, level);
            case typeIds.string:
                return stringOf(object);
            case typeIds.number:
                return numberOf(object);
            case typeIds.boolean:
                return cf.booleanGetValue(object) !== 0;
            case typeIds.data:
                return this.#nested(keepBytes(cf.dataGetBytePtr(object), cf.dataGetLength(object).toNumber(), this.#dataLimit), level);
            default:
                return `<${typeNameOf(object)}>`;
        }
    }

    #convertEntries(dictionary: NativePointer, level: number): unknown {
        if (this.#remainingNodes <= 0) {
            return "…";
        }
        const count = cf.dictionaryGetCount(dictionary).toNumber();
        const keys = Memory.alloc(Math.max(count, 1) * Process.pointerSize);
        const values = Memory.alloc(Math.max(count, 1) * Process.pointerSize);
        cf.dictionaryGetKeysAndValues(dictionary, keys, values);
        const shown = Math.min(count, ENTRIES_PER_CONTAINER);
        const result: Record<string, unknown> = {};
        for (let index = 0; index !== shown; index++) {
            const offset = index * Process.pointerSize;
            result[this.#keyText(keys.add(offset).readPointer(), level)] = this.convert(values.add(offset).readPointer(), level + 1);
        }
        if (count > shown) {
            result["…"] = `${count - shown} more`;
        }
        return this.#nested(result, level);
    }

    #keyText(key: NativePointer, level: number): string {
        const value = this.convert(key, level + 1);
        return (typeof value === "string") ? value : summarize(value, NESTED_SUMMARY_LENGTH);
    }

    #convertElements(array: NativePointer, level: number): unknown {
        if (this.#remainingNodes <= 0) {
            return "…";
        }
        const count = cf.arrayGetCount(array).toNumber();
        const shown = Math.min(count, ENTRIES_PER_CONTAINER);
        const result: unknown[] = [];
        for (let index = 0; index !== shown; index++) {
            result.push(this.convert(cf.arrayGetValueAtIndex(array, index), level + 1));
        }
        if (count > shown) {
            result.push(`… ${count - shown} more`);
        }
        return this.#nested(result, level);
    }

    #nested(container: unknown, level: number): unknown {
        return (level === EXPANDED_LEVELS) ? summarize(container, NESTED_SUMMARY_LENGTH) : container;
    }
}

function numberOf(object: NativePointer): number | Int64 {
    const value = Memory.alloc(8);
    if (cf.numberIsFloatType(object) !== 0) {
        cf.numberGetValue(object, FLOAT64, value);
        return value.readDouble();
    }
    cf.numberGetValue(object, SINT64, value);
    const integer = value.readS64();
    const number = integer.toNumber();
    return Number.isSafeInteger(number) ? number : integer;
}

function typeNameOf(object: NativePointer): string {
    const description = cf.copyTypeIDDescription(cf.getTypeID(object));
    const name = stringOf(description);
    cf.release(description);
    return name;
}

function typeIdOf(getter: string): number {
    return new NativeFunction(exported(getter), "uint", [])();
}

function exported(name: string): NativePointer {
    return framework.getExportByName(name);
}
