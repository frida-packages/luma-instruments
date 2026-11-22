import { type LuaApi, luaTypes } from "./lua-api.js";
import { LuaValueReader, type ReadLimits } from "./lua-values.js";

export type Outcome =
    | { kind: "returned"; printed: string[]; values: unknown[] }
    | { kind: "failed"; printed: string[]; error: unknown }
    | { kind: "rejected"; error: string };

const CHUNK_NAME = "=console";
const EVALUATION_STACK_SLOTS = 16;
export const MAX_RESULTS = 64;

const printCaptureSource = `
local buffer, tostring, select = ...
return function(...)
  local line = ""
  for i = 1, select("#", ...) do
    local text = tostring((select(i, ...)))
    line = (i == 1) and text or (line .. "\\t" .. text)
  end
  buffer[#buffer + 1] = line
end
`;

export function evaluate(api: LuaApi, L: NativePointer, source: string, limits: ReadLimits): Outcome {
    const base = api.top(L);
    if (!api.ensureStack(L, EVALUATION_STACK_SLOTS)) {
        return { kind: "rejected", error: "The interpreter's stack has no room to run a chunk here." };
    }
    try {
        return new Evaluation(api, L, base, limits).run(source);
    } finally {
        api.setTop(L, base);
    }
}

class Evaluation {
    private readonly chunk: number;
    private readonly buffer: number;
    private readonly globals: number;
    private readonly print: number;
    private readonly environment: number;

    constructor(
        private readonly api: LuaApi,
        private readonly L: NativePointer,
        private readonly base: number,
        private readonly limits: ReadLimits,
    ) {
        this.chunk = base + 1;
        this.buffer = base + 2;
        this.globals = base + 3;
        this.print = base + 4;
        this.environment = base + 5;
    }

    run(source: string): Outcome {
        const { api, L } = this;
        const compileError = this.compile(source);
        if (compileError !== null) {
            return { kind: "failed", printed: [], error: compileError };
        }
        api.pushNewTable(L);
        api.pushGlobals(L);
        if (api.typeOf(L, this.globals) !== luaTypes.table) {
            return { kind: "rejected", error: "The interpreter's globals are not a table." };
        }
        const captureError = this.preparePrintCapture();
        if (captureError !== null) {
            return { kind: "rejected", error: `Could not capture print: ${captureError}` };
        }
        this.prepareEnvironment();
        api.pushCopy(L, this.chunk);
        const firstResult = api.top(L);
        const succeeded = api.protectedCall(L, 0);
        const reader = new LuaValueReader(api, L, this.limits);
        const resultCount = api.top(L) - firstResult + 1;
        const results: unknown[] = [];
        for (let offset = 0; offset < Math.min(resultCount, MAX_RESULTS); offset++) {
            results.push(reader.read(firstResult + offset));
        }
        if (resultCount > MAX_RESULTS) {
            results.push(`… ${resultCount - MAX_RESULTS} more values`);
        }
        this.releasePrintCapture();
        const printed = this.printedLines(reader);
        return succeeded
            ? { kind: "returned", printed, values: results }
            : { kind: "failed", printed, error: results[0] ?? null };
    }

    private compile(source: string): unknown {
        const { api, L } = this;
        if (api.load(L, `return ${source}`, CHUNK_NAME)) {
            return null;
        }
        api.setTop(L, this.base);
        if (api.load(L, source, CHUNK_NAME)) {
            return null;
        }
        return new LuaValueReader(api, L, this.limits).read(-1);
    }

    private preparePrintCapture(): string | null {
        const { api, L } = this;
        if (!api.load(L, printCaptureSource, "=print capture")) {
            return new LuaValueReader(api, L, this.limits).text(-1);
        }
        api.pushCopy(L, this.buffer);
        for (const name of ["tostring", "select"]) {
            api.pushString(L, name);
            api.rawGet(L, this.globals);
        }
        if (!api.protectedCall(L, 3)) {
            return new LuaValueReader(api, L, this.limits).text(-1);
        }
        api.setTop(L, this.print);
        return null;
    }

    private prepareEnvironment(): void {
        const { api, L, environment } = this;
        const metatable = environment + 1;
        api.pushNewTable(L);
        api.pushCopy(L, this.print);
        api.setField(L, environment, "print");
        api.pushNewTable(L);
        api.pushCopy(L, this.globals);
        api.setField(L, metatable, "__index");
        api.pushCopy(L, this.globals);
        api.setField(L, metatable, "__newindex");
        api.setMetatable(L, environment);
        api.pushCopy(L, environment);
        if (!api.setEnvironment(L, this.chunk)) {
            api.setTop(L, environment);
        }
    }

    private releasePrintCapture(): void {
        const { api, L } = this;
        api.pushString(L, "print");
        api.pushNil(L);
        api.rawSet(L, this.environment);
    }

    private printedLines(reader: LuaValueReader): string[] {
        const { api, L } = this;
        const lines: string[] = [];
        const count = api.rawLength(L, this.buffer);
        for (let n = 1; n <= count; n++) {
            api.rawGetIndex(L, this.buffer, n);
            lines.push((api.typeOf(L, -1) === luaTypes.string) ? reader.text(-1) : "");
            api.setTop(L, -2);
        }
        return lines;
    }
}
