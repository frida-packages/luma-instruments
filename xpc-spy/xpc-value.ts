import { blocks } from "./block.js";
import { summarize } from "./summary.js";
import { typeName, xpc, xpcTypes } from "./xpc.js";

const EXPANDED_LEVELS = 2;
const NODES_PER_MESSAGE = 2000;
const ENTRIES_PER_CONTAINER = 256;
const STRING_BYTES = 4096;
const NESTED_SUMMARY_LENGTH = 160;

export interface TruncatedData {
    bytes: ArrayBuffer;
    length: number;
}

export function toJavaScript(object: NativePointer, dataLimit: number): unknown {
    return new Conversion(dataLimit).convert(object, 0);
}

class Conversion {
    private remainingNodes = NODES_PER_MESSAGE;

    constructor(private readonly dataLimit: number) {
    }

    convert(object: NativePointer, level: number): unknown {
        this.remainingNodes--;
        const type = xpc.getType(object);
        const converter = converters.get(type.toString());
        if (converter === undefined) {
            return `<${typeName(object)}>`;
        }
        return converter(object, this, level);
    }

    convertEntries(dictionary: NativePointer, level: number): unknown {
        if (this.remainingNodes <= 0) {
            return "…";
        }
        const result: Record<string, unknown> = {};
        const entries = dictionaryEntries(dictionary, ENTRIES_PER_CONTAINER);
        for (const [key, value] of entries) {
            result[key] = this.convert(value, level + 1);
        }
        const omitted = xpc.dictionaryGetCount(dictionary).toNumber() - entries.length;
        if (omitted > 0) {
            result["…"] = `${omitted} more`;
        }
        return this.nested(result, level);
    }

    convertElements(array: NativePointer, level: number): unknown {
        if (this.remainingNodes <= 0) {
            return "…";
        }
        const count = xpc.arrayGetCount(array).toNumber();
        const shown = Math.min(count, ENTRIES_PER_CONTAINER);
        const result: unknown[] = [];
        for (let index = 0; index !== shown; index++) {
            result.push(this.convert(xpc.arrayGetValue(array, index), level + 1));
        }
        if (count > shown) {
            result.push(`… ${count - shown} more`);
        }
        return this.nested(result, level);
    }

    convertData(data: NativePointer, level: number): unknown {
        const length = xpc.dataGetLength(data).toNumber();
        const kept = Math.min(length, this.dataLimit);
        const bytes = (kept === 0) ? new ArrayBuffer(0) : xpc.dataGetBytesPtr(data).readByteArray(kept)!;
        if (kept === length) {
            return bytes;
        }
        const truncated: TruncatedData = { bytes, length };
        return this.nested(truncated, level);
    }

    private nested(container: unknown, level: number): unknown {
        return (level === EXPANDED_LEVELS) ? summarize(container, NESTED_SUMMARY_LENGTH) : container;
    }
}

type Converter = (object: NativePointer, conversion: Conversion, level: number) => unknown;

const converterEntries: [NativePointer, Converter][] = [
    [xpcTypes.dictionary, (object, conversion, level) => conversion.convertEntries(object, level)],
    [xpcTypes.error, (object, conversion, level) => conversion.convertEntries(object, level)],
    [xpcTypes.array, (object, conversion, level) => conversion.convertElements(object, level)],
    [xpcTypes.string, stringOf],
    [xpcTypes.int64, object => integerOf(xpc.int64GetValue(object))],
    [xpcTypes.uint64, object => integerOf(xpc.uint64GetValue(object))],
    [xpcTypes.bool, object => xpc.boolGetValue(object) !== 0],
    [xpcTypes.double, object => xpc.doubleGetValue(object)],
    [xpcTypes.date, object => new Date(xpc.dateGetValue(object).toNumber() / 1e6)],
    [xpcTypes.data, (object, conversion, level) => conversion.convertData(object, level)],
    [xpcTypes.uuid, object => uuidOf(xpc.uuidGetBytes(object))],
    [xpcTypes.null, () => null],
    [xpcTypes.connection, connectionOf],
];

const converters = new Map(converterEntries.map(([type, converter]) => [type.toString(), converter]));

function stringOf(object: NativePointer): string {
    const length = xpc.stringGetLength(object).toNumber();
    const text = xpc.stringGetStringPtr(object).readCString(Math.min(length, STRING_BYTES))!;
    return (length > STRING_BYTES) ? `${text}… (${length} bytes)` : text;
}

function integerOf(value: Int64 | UInt64): number | Int64 | UInt64 {
    const number = value.toNumber();
    return Number.isSafeInteger(number) ? number : value;
}

function uuidOf(bytes: NativePointer): string {
    const hex = Array.from(new Uint8Array(bytes.readByteArray(16)!), byte => byte.toString(16).padStart(2, "0")).join("");
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-").toUpperCase();
}

function connectionOf(object: NativePointer): string {
    const pid = xpc.connectionGetPid(object);
    return (pid !== 0) ? `<connection to pid ${pid}>` : "<connection>";
}

let visitEntry: (key: NativePointer, value: NativePointer) => boolean;

const entryVisitor = blocks.makeGlobal(new NativeCallback((_block: NativePointer, key: NativePointer, value: NativePointer) => {
    return visitEntry(key, value) ? 1 : 0;
}, "bool", ["pointer", "pointer", "pointer"]));

function dictionaryEntries(dictionary: NativePointer, limit: number): [string, NativePointer][] {
    const entries: [string, NativePointer][] = [];
    visitEntry = (key, value) => {
        entries.push([key.readCString()!, value]);
        return entries.length !== limit;
    };
    xpc.dictionaryApply(dictionary, entryVisitor);
    return entries;
}
