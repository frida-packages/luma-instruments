export function encodeTargetValue(root: any, maxDepth: number, maxChars: number): any {
    const seen = new Set<any>();
    let budget = maxChars;
    return encode(root, 0);

    function encode(value: any, depth: number): any {
        if (budget <= 0) {
            return { $luma: "truncated" };
        }
        switch (typeof value) {
            case "string":
                return encodeString(value);
            case "number":
                budget -= 8;
                return (Number.isFinite(value) && !Object.is(value, -0)) ? value : { $luma: "number", text: Object.is(value, -0) ? "-0" : String(value) };
            case "boolean":
                budget -= 5;
                return value;
            case "undefined":
                return { $luma: "undefined" };
            case "bigint":
                return { $luma: "bigint", text: value.toString() };
            case "symbol":
                return { $luma: "symbol", text: String(value.description ?? "") };
            case "function":
                return { $luma: "function", name: String(value.name ?? "") };
        }
        if (value === null) {
            return null;
        }
        if (seen.has(value)) {
            return { $luma: "circular" };
        }
        if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
            return encodeBytes(value);
        }
        if (value instanceof Date) {
            return { $luma: "date", text: Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString() };
        }
        if (value instanceof Error) {
            budget -= 64;
            return { $luma: "error", name: String(value.name), message: String(value.message), stack: String(value.stack ?? "") };
        }
        if (value instanceof RegExp) {
            return { $luma: "regexp", source: value.source, flags: value.flags };
        }
        if (value instanceof Promise) {
            return { $luma: "promise" };
        }
        if (depth >= maxDepth) {
            return { $luma: "deep", class: classOf(value) ?? (Array.isArray(value) ? "Array" : "Object") };
        }
        seen.add(value);
        try {
            return encodeContainer(value, depth + 1);
        } finally {
            seen.delete(value);
        }
    }

    function encodeString(value: string): any {
        const kept = (value.length > budget) ? value.slice(0, Math.max(budget, 0)) : value;
        budget -= kept.length + 2;
        return (kept.length < value.length) ? { $luma: "string", text: kept, length: value.length } : value;
    }

    function encodeBytes(value: ArrayBuffer | ArrayBufferView): any {
        const view = (value instanceof ArrayBuffer)
            ? new Uint8Array(value)
            : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        const kept = Math.max(0, Math.min(view.length, Math.floor(budget / 2), 65536));
        let hex = "";
        for (let i = 0; i !== kept; i++) {
            hex += view[i].toString(16).padStart(2, "0");
        }
        budget -= hex.length + 16;
        return { $luma: "bytes", class: (value instanceof ArrayBuffer) ? "ArrayBuffer" : value.constructor.name, length: view.length, hex };
    }

    function encodeContainer(value: any, depth: number): any {
        if (Array.isArray(value)) {
            return encodeItems(value, depth);
        }
        if (value instanceof Map) {
            return { $luma: "map", entries: encodeItems([...value.entries()], depth) };
        }
        if (value instanceof Set) {
            return { $luma: "set", values: encodeItems([...value.values()], depth) };
        }
        const fields: Record<string, any> = {};
        let shown = 0;
        const keys = Object.keys(value);
        for (const key of keys) {
            if (shown === 100 || budget <= 0) {
                fields["…"] = { $luma: "more", count: keys.length - shown };
                break;
            }
            budget -= key.length + 4;
            fields[key] = encodeField(value, key, depth);
            shown++;
        }
        if (typeof value.outerHTML === "string") {
            fields.outerHTML = encodeString(value.outerHTML.slice(0, 300));
        }
        const className = classOf(value);
        return (className !== null) ? { $luma: "object", class: className, fields } : fields;
    }

    function encodeItems(items: any[], depth: number): any[] {
        const encoded: any[] = [];
        for (const item of items) {
            if (encoded.length === 100 || budget <= 0) {
                encoded.push({ $luma: "more", count: items.length - encoded.length });
                break;
            }
            budget -= 2;
            encoded.push(encode(item, depth));
        }
        return encoded;
    }

    function encodeField(value: any, key: string, depth: number): any {
        try {
            return encode(value[key], depth);
        } catch (e) {
            return { $luma: "thrown", text: String(e) };
        }
    }

    function classOf(value: any): string | null {
        const prototype = Object.getPrototypeOf(value);
        if (prototype === null || prototype === Object.prototype) {
            return null;
        }
        const name = prototype.constructor?.name;
        return (typeof name === "string" && name !== "Object" && name !== "") ? name : null;
    }
}
