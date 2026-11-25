import type { Decoded } from "./message-decoding.js";
import { CustomValue } from "./standard-codec.js";

const ELLIPSIS = "…";
const ITEMS_SHOWN = 8;

export function summaryOf(decoded: Decoded, budget: number): string {
    switch (decoded.form) {
        case "call":
            return clipped(`${decoded.method}(${(decoded.args === null) ? "" : valueText(decoded.args, budget)})`, budget);
        case "success":
            return clipped(valueText(decoded.result, budget), budget);
        case "error":
            return clipped(`error ${decoded.code}${(decoded.message !== null) ? `: ${valueText(decoded.message, budget)}` : ""}`, budget);
        case "value":
            return clipped(valueText(decoded.value, budget), budget);
        case "empty":
            return "(empty)";
    }
}

export function valueText(value: unknown, budget: number): string {
    if (value === null || value === undefined) {
        return "null";
    }
    if (typeof value === "string") {
        return JSON.stringify(clipped(value, budget));
    }
    if (typeof value === "bigint") {
        return `${value}n`;
    }
    if (typeof value !== "object") {
        return String(value);
    }
    if (value instanceof CustomValue) {
        return `<type ${value.type}: ${value.undecoded.byteLength} bytes undecoded>`;
    }
    if (ArrayBuffer.isView(value)) {
        return typedListText(value as TypedList);
    }
    if (value instanceof Map) {
        return `{${itemsText([...value].map(([key, item]) => `${keyText(key)}: ${valueText(item, budget)}`), value.size)}}`;
    }
    if (Array.isArray(value)) {
        return `[${itemsText(value.map(item => valueText(item, budget)), value.length)}]`;
    }
    const entries = Object.entries(value);
    return `{${itemsText(entries.map(([key, item]) => `${key}: ${valueText(item, budget)}`), entries.length)}}`;
}

type TypedList = Uint8Array | Int32Array | BigInt64Array | Float32Array | Float64Array;

const typedListNames = new Map<string, string>([
    ["Uint8Array", "Uint8List"],
    ["Int32Array", "Int32List"],
    ["BigInt64Array", "Int64List"],
    ["Float32Array", "Float32List"],
    ["Float64Array", "Float64List"],
]);

function typedListText(list: TypedList): string {
    const name = typedListNames.get(list.constructor.name) ?? list.constructor.name;
    if (list instanceof Uint8Array) {
        return `${name}(${list.length}: ${hexPreview(list)})`;
    }
    const shown = Array.from(list.subarray(0, ITEMS_SHOWN) as ArrayLike<number | bigint>, String);
    return `${name}[${shown.join(", ")}${(list.length > ITEMS_SHOWN) ? `, ${ELLIPSIS}` : ""}]`;
}

const BYTES_PREVIEWED = 16;

function hexPreview(bytes: Uint8Array): string {
    const shown = Array.from(bytes.subarray(0, BYTES_PREVIEWED), byte => byte.toString(16).padStart(2, "0")).join(" ");
    return (bytes.length > BYTES_PREVIEWED) ? `${shown} ${ELLIPSIS}` : shown;
}

function itemsText(items: string[], count: number): string {
    const shown = items.slice(0, ITEMS_SHOWN).join(", ");
    return (count > ITEMS_SHOWN) ? `${shown}, ${ELLIPSIS}` : shown;
}

function keyText(key: unknown): string {
    return (typeof key === "string" && /^[A-Za-z_$][\w$]*$/.test(key)) ? key : valueText(key, ITEMS_SHOWN * 4);
}

function clipped(text: string, budget: number): string {
    return (text.length > budget) ? `${text.slice(0, budget - 1)}${ELLIPSIS}` : text;
}
