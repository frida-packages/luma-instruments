import type { TruncatedData } from "./xpc-value.js";

export function summarize(value: unknown, maxLength: number): string {
    const text = new Summary(maxLength).describe(value);
    return (text.length > maxLength) ? text.slice(0, maxLength - 1) + "…" : text;
}

class Summary {
    private length = 0;

    constructor(private readonly maxLength: number) {
    }

    describe(value: unknown): string {
        if (Array.isArray(value)) {
            return `[${this.describeAll(value.map(element => [null, element]))}]`;
        }
        if (isRecord(value)) {
            return `{${this.describeAll(Object.entries(value))}}`;
        }
        const text = leafText(value);
        this.length += text.length;
        return text;
    }

    private describeAll(entries: [string | null, unknown][]): string {
        const parts: string[] = [];
        for (const [key, value] of entries) {
            if (this.length >= this.maxLength) {
                parts.push("…");
                break;
            }
            const prefix = (key !== null) ? `${key}: ` : "";
            this.length += prefix.length + 2;
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
        return `<${value.byteLength} bytes>`;
    }
    if (isTruncatedData(value)) {
        return `<${value.length} bytes>`;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    return String(value);
}

function isTruncatedData(value: unknown): value is TruncatedData {
    return typeof value === "object" && value !== null && (value as Partial<TruncatedData>).bytes instanceof ArrayBuffer;
}
