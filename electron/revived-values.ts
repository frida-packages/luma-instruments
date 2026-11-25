export function revive(encoded: any): any {
    if (encoded === null || typeof encoded !== "object") {
        return encoded;
    }
    if (Array.isArray(encoded)) {
        return encoded.map(revive);
    }
    switch (encoded.$luma) {
        case undefined:
            return reviveFields(encoded);
        case "undefined":
            return undefined;
        case "number":
            return Number(encoded.text);
        case "bigint":
            return BigInt(encoded.text);
        case "symbol":
            return Symbol(encoded.text);
        case "string":
            return `${encoded.text}… (${encoded.length} characters)`;
        case "function":
            return namedFunction(encoded.name);
        case "bytes":
            return bytesOf(encoded.hex);
        case "date":
            return new Date(encoded.text);
        case "error":
            return errorOf(encoded);
        case "regexp":
            return new RegExp(encoded.source, encoded.flags);
        case "map":
            return new Map(encoded.entries.map((entry: any) => Array.isArray(entry) ? entry.map(revive) : [revive(entry), undefined]));
        case "set":
            return new Set(encoded.values.map(revive));
        case "object":
            return { "[[Class]]": encoded.class, ...reviveFields(encoded.fields) };
        default:
            return `[${describeTag(encoded)}]`;
    }
}

export function summarize(encoded: any, limit: number): string {
    const text = render(encoded, 3);
    return (text.length > limit) ? `${text.slice(0, limit - 1)}…` : text;
}

export function summarizeArguments(encoded: any, limit: number): string {
    const text = Array.isArray(encoded) ? encoded.map(item => render(item, 3)).join(", ") : render(encoded, 3);
    return (text.length > limit) ? `${text.slice(0, limit - 1)}…` : text;
}

function reviveFields(fields: { [key: string]: any }): { [key: string]: any } {
    const revived: { [key: string]: any } = {};
    for (const [key, value] of Object.entries(fields)) {
        revived[key] = revive(value);
    }
    return revived;
}

function namedFunction(name: string): Function {
    return { [name]: function () {} }[name];
}

function bytesOf(hex: string): ArrayBuffer {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i !== bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes.buffer;
}

function errorOf(encoded: any): Error {
    const error = new Error(encoded.message);
    error.name = encoded.name;
    error.stack = encoded.stack;
    return error;
}

function describeTag(encoded: any): string {
    switch (encoded.$luma) {
        case "circular":
            return "Circular";
        case "promise":
            return "Promise";
        case "deep":
            return encoded.class;
        case "more":
            return `… ${encoded.count} more`;
        case "thrown":
            return `getter threw ${encoded.text}`;
        default:
            return "…";
    }
}

function render(encoded: any, depth: number): string {
    if (encoded === null || typeof encoded !== "object") {
        return (typeof encoded === "string") ? JSON.stringify(encoded) : String(encoded);
    }
    if (Array.isArray(encoded)) {
        return (depth === 0) ? `[…${encoded.length}]` : `[${encoded.map(item => render(item, depth - 1)).join(", ")}]`;
    }
    switch (encoded.$luma) {
        case undefined:
            return renderFields(encoded, depth);
        case "undefined":
            return "undefined";
        case "number":
            return encoded.text;
        case "bigint":
            return `${encoded.text}n`;
        case "symbol":
            return `Symbol(${encoded.text})`;
        case "string":
            return `${JSON.stringify(encoded.text)}…`;
        case "function":
            return `[Function ${encoded.name}]`;
        case "bytes":
            return `${encoded.class}(${encoded.length}) ${encoded.hex.slice(0, 32)}${(encoded.hex.length > 32) ? "…" : ""}`;
        case "date":
            return encoded.text;
        case "error":
            return `${encoded.name}: ${encoded.message}`;
        case "regexp":
            return `/${encoded.source}/${encoded.flags}`;
        case "map":
            return `Map(${encoded.entries.length})`;
        case "set":
            return `Set(${encoded.values.length})`;
        case "object":
            return `${encoded.class} ${renderFields(encoded.fields, depth)}`;
        default:
            return `[${describeTag(encoded)}]`;
    }
}

function renderFields(fields: { [key: string]: any }, depth: number): string {
    const keys = Object.keys(fields);
    if (depth === 0) {
        return (keys.length === 0) ? "{}" : "{…}";
    }
    return `{${keys.map(key => `${key}: ${render(fields[key], depth - 1)}`).join(", ")}}`;
}
