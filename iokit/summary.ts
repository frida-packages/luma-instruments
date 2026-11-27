import { isTruncatedData } from "./kept-bytes.js";

export function summarize(value: unknown, maxLength: number): string {
    const text = new Summary(maxLength).describe(value);
    return (text.length > maxLength) ? text.slice(0, maxLength - 1) + "…" : text;
}

class Summary {
    readonly #maxLength: number;
    #length = 0;

    constructor(maxLength: number) {
        this.#maxLength = maxLength;
    }

    describe(value: unknown): string {
        if (Array.isArray(value)) {
            return `[${this.#describeAll(value.map(element => [null, element]))}]`;
        }
        if (isRecord(value)) {
            return `{${this.#describeAll(Object.entries(value))}}`;
        }
        const text = leafText(value);
        this.#length += text.length;
        return text;
    }

    #describeAll(entries: [string | null, unknown][]): string {
        const parts: string[] = [];
        for (const [key, value] of entries) {
            if (this.#length >= this.#maxLength) {
                parts.push("…");
                break;
            }
            const prefix = (key !== null) ? `${key}: ` : "";
            this.#length += prefix.length + 2;
            parts.push(prefix + this.describe(value));
        }
        return parts.join(", ");
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype && !isTruncatedData(value);
}

function leafText(value: unknown): string {
    if (typeof value === "string") {
        return JSON.stringify(value);
    }
    if (value instanceof ArrayBuffer) {
        return bytesText(value, value.byteLength);
    }
    if (isTruncatedData(value)) {
        return bytesText(value.bytes, value.length);
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    return String(value);
}

function bytesText(bytes: ArrayBuffer, length: number): string {
    const text = cStringIn(new Uint8Array(bytes));
    return (text !== null) ? `<${length} bytes: ${JSON.stringify(text)}>` : `<${length} bytes>`;
}

function cStringIn(bytes: Uint8Array): string | null {
    const end = bytes.indexOf(0);
    const printable = (end > 0) && bytes.subarray(0, end).every(byte => byte >= 0x20 && byte < 0x7f)
        && bytes.subarray(end).every(byte => byte === 0);
    return printable ? String.fromCharCode(...bytes.subarray(0, end)) : null;
}
