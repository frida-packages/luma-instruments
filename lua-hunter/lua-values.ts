import { type LuaApi, luaTypeNames, luaTypes } from "./lua-api.js";

export interface ReadLimits {
    entriesPerTable: number;
}

const EXPANDED_LEVELS = 2;
const STACK_SLOTS_PER_LEVEL = 4;
const STRING_BYTES = 4096;
const SUMMARY_LENGTH = 120;
const SUMMARY_ENTRIES = 8;
const UNCOUNTED_REMAINDER = 100000;

export class LuaValueReader {
    readonly #api: LuaApi;
    readonly #L: NativePointer;
    readonly #limits: ReadLimits;
    readonly #path = new Set<string>();

    constructor(
        api: LuaApi,
        L: NativePointer,
        limits: ReadLimits,
    ) {
        this.#api = api;
        this.#L = L;
        this.#limits = limits;
    }

    read(index: number): unknown {
        return this.#convert(index, 0);
    }

    text(index: number): string {
        const api = this.#api;
        const L = this.#L;
        const type = api.typeOf(L, index);
        switch (type) {
            case luaTypes.string:
                return this.#stringAt(index);
            case luaTypes.number:
                return String(this.#numberAt(index));
            case luaTypes.boolean:
                return String(api.toBoolean(L, index));
            case luaTypes.nil:
                return "nil";
            default:
                return this.#identity(index, type);
        }
    }

    #convert(index: number, level: number): unknown {
        const api = this.#api;
        const L = this.#L;
        const type = api.typeOf(L, index);
        switch (type) {
            case luaTypes.nil:
                return null;
            case luaTypes.boolean:
                return api.toBoolean(L, index);
            case luaTypes.number:
                return this.#numberAt(index);
            case luaTypes.string:
                return this.#stringAt(index);
            case luaTypes.table:
                return (level < EXPANDED_LEVELS) ? this.#tableAt(index, level) : this.#summaryOf(index);
            case luaTypes.function:
                return this.#functionAt(index);
            default:
                return this.#identity(index, type);
        }
    }

    #numberAt(index: number): number | string | Int64 {
        const api = this.#api;
        const L = this.#L;
        if (api.isInteger(L, index)) {
            const integer = api.toInteger(L, index);
            const value = integer.toNumber();
            return Number.isSafeInteger(value) ? value : integer;
        }
        const value = api.toNumber(L, index);
        if (Number.isFinite(value)) {
            return value;
        }
        return Number.isNaN(value) ? "nan" : (value > 0) ? "inf" : "-inf";
    }

    #stringAt(index: number): string {
        const api = this.#api;
        const L = this.#L;
        api.pushCopy(L, index);
        const bytes = api.toBytes(L, -1)!;
        api.setTop(L, -2);
        const text = decodeLuaString(bytes.subarray(0, STRING_BYTES));
        return (bytes.length > STRING_BYTES) ? `${text}… (${bytes.length} bytes)` : text;
    }

    #tableAt(index: number, level: number): unknown {
        const api = this.#api;
        const L = this.#L;
        const identity = this.#identity(index, luaTypes.table);
        if (this.#path.has(identity)) {
            return `${identity} (already shown)`;
        }
        if (!api.ensureStack(L, STACK_SLOTS_PER_LEVEL)) {
            return identity;
        }
        this.#path.add(identity);
        const table = absolute(api, L, index);
        const entries: [unknown, unknown][] = [];
        let omitted = 0;
        api.pushNil(L);
        while (api.next(L, table)) {
            if (entries.length === this.#limits.entriesPerTable) {
                omitted = 1 + this.#countRemaining(table);
                break;
            }
            entries.push([this.#keyAt(-2), this.#convert(api.top(L), level + 1)]);
            api.setTop(L, -2);
        }
        this.#path.delete(identity);
        return shapeOf(entries, omitted);
    }

    #countRemaining(table: number): number {
        const api = this.#api;
        const L = this.#L;
        let remaining = 0;
        api.setTop(L, -2);
        while (api.next(L, table)) {
            api.setTop(L, -2);
            if (++remaining === UNCOUNTED_REMAINDER) {
                api.setTop(L, -2);
                break;
            }
        }
        return remaining;
    }

    #keyAt(index: number): unknown {
        const api = this.#api;
        const L = this.#L;
        const type = api.typeOf(L, index);
        if (type === luaTypes.string) {
            return this.#stringAt(index);
        }
        if (type === luaTypes.number) {
            return this.#numberAt(index);
        }
        return `[${this.text(index)}]`;
    }

    #summaryOf(index: number): string {
        const api = this.#api;
        const L = this.#L;
        if (!api.ensureStack(L, STACK_SLOTS_PER_LEVEL)) {
            return this.#identity(index, luaTypes.table);
        }
        const table = absolute(api, L, index);
        const parts: string[] = [];
        let more = false;
        api.pushNil(L);
        while (api.next(L, table)) {
            if (parts.length === SUMMARY_ENTRIES) {
                api.setTop(L, -3);
                more = true;
                break;
            }
            const value = (api.typeOf(L, -1) === luaTypes.table) ? "{…}" : this.#leafText(-1);
            parts.push((api.typeOf(L, -2) === luaTypes.string) ? `${this.#stringAt(-2)} = ${value}` : value);
            api.setTop(L, -2);
        }
        const summary = `{ ${parts.join(", ")}${more ? ", …" : ""} }`;
        return (summary.length > SUMMARY_LENGTH) ? summary.slice(0, SUMMARY_LENGTH - 1) + "…" : summary;
    }

    #leafText(index: number): string {
        return (this.#api.typeOf(this.#L, index) === luaTypes.string) ? JSON.stringify(this.#stringAt(index)) : this.text(index);
    }

    #functionAt(index: number): string {
        const cFunction = this.#api.cFunctionAt(this.#L, index);
        if (cFunction === null) {
            return this.#identity(index, luaTypes.function);
        }
        return `function: builtin ${cFunction} (${whereIs(cFunction)})`;
    }

    #identity(index: number, type: number): string {
        return `${luaTypeNames.get(type) ?? "value"}: ${this.#api.toPointer(this.#L, index)}`;
    }
}

function absolute(api: LuaApi, L: NativePointer, index: number): number {
    return (index < 0) ? api.top(L) + 1 + index : index;
}

export function shapeOf(entries: [unknown, unknown][], omitted: number): unknown {
    if (isSequence(entries)) {
        const sequence = entries.slice().sort((a, b) => (a[0] as number) - (b[0] as number)).map(([, value]) => value);
        return (omitted !== 0) ? [...sequence, `… ${omitted} more`] : sequence;
    }
    const record: Record<string, unknown> = {};
    for (const [key, value] of entries) {
        record[(typeof key === "string") ? key : `[${String(key)}]`] = value;
    }
    if (omitted !== 0) {
        record["…"] = `${omitted} more`;
    }
    return record;
}

function isSequence(entries: [unknown, unknown][]): boolean {
    if (entries.length === 0) {
        return false;
    }
    const keys = new Set(entries.map(([key]) => key));
    for (let n = 1; n <= entries.length; n++) {
        if (!keys.has(n)) {
            return false;
        }
    }
    return true;
}

function whereIs(code: NativePointer): string {
    const symbol = DebugSymbol.fromAddress(code);
    if (symbol.name !== null) {
        return `${symbol.moduleName}!${symbol.name}`;
    }
    const module = Process.findModuleByAddress(code);
    return (module !== null) ? `${module.name}+0x${code.sub(module.base).toString(16)}` : "unknown code";
}

export type InvalidByteNotation = (byte: number) => string;

const escapedByte: InvalidByteNotation = byte => `\\x${byte.toString(16).padStart(2, "0")}`;

export function decodeLuaString(bytes: Uint8Array, invalidByte: InvalidByteNotation = escapedByte): string {
    let text = "";
    for (let offset = 0; offset < bytes.length;) {
        const sequence = utf8SequenceAt(bytes, offset);
        if (sequence === null) {
            text += invalidByte(bytes[offset]);
            offset++;
        } else {
            text += String.fromCodePoint(sequence.codePoint);
            offset += sequence.length;
        }
    }
    return text;
}

function utf8SequenceAt(bytes: Uint8Array, offset: number): { codePoint: number, length: number } | null {
    const lead = bytes[offset];
    if (lead < 0x80) {
        return (lead >= 0x20 || lead === 0x09 || lead === 0x0a || lead === 0x0d) ? { codePoint: lead, length: 1 } : null;
    }
    const length = (lead >= 0xf0 && lead < 0xf5) ? 4 : (lead >= 0xe0 && lead < 0xf0) ? 3 : (lead >= 0xc2 && lead < 0xe0) ? 2 : 0;
    if (length === 0 || offset + length > bytes.length) {
        return null;
    }
    let codePoint = lead & (0xff >> (length + 1));
    for (let i = 1; i !== length; i++) {
        const continuation = bytes[offset + i];
        if ((continuation & 0xc0) !== 0x80) {
            return null;
        }
        codePoint = (codePoint << 6) | (continuation & 0x3f);
    }
    return { codePoint, length };
}
