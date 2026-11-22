import type { RecoveredApi } from "./api-recovery.js";
import { type Census, notableGlobals } from "./census.js";
import { MAX_RESULTS, type Outcome } from "./evaluation.js";
import type { LuaExecutor } from "./lua-executor.js";
import type { Flavor } from "./lua-flavor.js";
import { decodeLuaString, type ReadLimits, shapeOf } from "./lua-values.js";
import { bytesAt, utf8Length } from "./lua-api.js";

type Run = { kind: "replied"; text: string } | { kind: "failed"; text: string };

type WireValue = null | boolean | number | string | WireNode;
type WireNode = { i: string } | { t: [WireValue, WireValue][]; more: number } | { s: string } | { o: string };

interface WireReply {
    outcome: "returned" | "failed";
    printed: string[];
    values: WireValue[];
}

interface WireCensus {
    globals: number;
    names: string[];
}

const LUA_OK = 0;
const CHUNK_NAME = Memory.allocUtf8String("=lua-hunter");

const prelude = `
local type, tostring, tonumber, next, select, pcall, rawget, rawset = type, tostring, tonumber, next, select, pcall, rawget, rawset
local format, gsub, byte, sub, concat = string.format, string.gsub, string.byte, string.sub, table.concat
local huge, floor, mathtype = math.huge, math.floor, math.type
local function quote(s)
  if #s > 4096 then s = sub(s, 1, 4096) .. "… (" .. #s .. " bytes)" end
  return '"' .. gsub(s, '[%c"\\\\]', function(c) return format("\\\\u%04x", byte(c)) end) .. '"'
end
`;

const serializer = `
local getinfo = type(debug) == "table" and debug.getinfo
local function identity(v)
  local ok, text = pcall(tostring, v)
  text = ok and type(text) == "string" and text or type(v)
  if type(v) == "function" and getinfo and getinfo(v, "S").what == "C" then
    text = gsub(text, "^function: ", "function: builtin ")
  end
  return text
end
local function number(n)
  if n ~= n then return '"nan"' end
  if n == huge then return '"inf"' end
  if n == -huge then return '"-inf"' end
  if mathtype and mathtype(n) == "integer" then
    if n >= -9007199254740991 and n <= 9007199254740991 then return format("%d", n) end
    return '{"i":"' .. format("%d", n) .. '"}'
  end
  local text = format("%.14g", n)
  if tonumber(text) ~= n then text = format("%.17g", n) end
  return text
end
local function summary(t)
  local parts, count = {}, 0
  for k, v in next, t do
    if count == 8 then parts[#parts + 1] = "…" break end
    count = count + 1
    local shown = (type(v) == "table") and "{…}" or (type(v) == "string") and format("%q", v) or identity(v)
    parts[#parts + 1] = (type(k) == "string") and (k .. " = " .. shown) or shown
  end
  local text = "{ " .. concat(parts, ", ") .. " }"
  if #text > 120 then text = sub(text, 1, 119) .. "…" end
  return text
end
local encode
local function encodeTable(t, depth, path)
  if path[t] then return '{"o":' .. quote(identity(t) .. " (already shown)") .. '}' end
  if depth >= 2 then return '{"s":' .. quote(summary(t)) .. '}' end
  path[t] = true
  local parts, count, more = {}, 0, 0
  for k, v in next, t do
    if count == ENTRIES then
      more = more + 1
      if more == 100000 then break end
    else
      count = count + 1
      parts[count] = "[" .. encode(k, depth + 1, path, "key") .. "," .. encode(v, depth + 1, path, "value") .. "]"
    end
  end
  path[t] = nil
  return '{"t":[' .. concat(parts, ",") .. '],"more":' .. more .. '}'
end
function encode(v, depth, path, role)
  local kind = type(v)
  if kind == "nil" then return "null" end
  if kind == "boolean" then return v and "true" or "false" end
  if kind == "number" then return number(v) end
  if kind == "string" then return quote(v) end
  if kind == "table" and role == "value" then return encodeTable(v, depth, path) end
  return '{"o":' .. quote(identity(v)) .. '}'
end
local function encodeAll(list, count)
  local parts = {}
  for i = 1, (count < MAX_RESULTS) and count or MAX_RESULTS do parts[i] = encode(list[i], 0, {}, "value") end
  if count > MAX_RESULTS then parts[#parts + 1] = quote("… " .. (count - MAX_RESULTS) .. " more values") end
  return "[" .. concat(parts, ",") .. "]"
end
`;

const environmentSetup: Record<"5.1" | "5.2", string> = {
    "5.1": `
local G = getfenv and getfenv(1) or _G
local loadstring, setfenv, setmetatable = loadstring, setfenv, setmetatable
local function compile(text, env)
  local chunk, err = loadstring(text, "=console")
  if chunk then setfenv(chunk, env) end
  return chunk, err
end
`,
    "5.2": `
local G = _ENV
local load, setmetatable = load, setmetatable
local function compile(text, env)
  return load(text, "=console", "t", env)
end
`,
};

const evaluationBody = `
local printed = {}
local env = setmetatable({
  print = function(...)
    local parts = {}
    for i = 1, select("#", ...) do parts[i] = tostring((select(i, ...))) end
    printed[#printed + 1] = concat(parts, "\\t")
  end,
}, { __index = G, __newindex = G })
local chunk, err = compile("return " .. SOURCE, env)
if not chunk then chunk, err = compile(SOURCE, env) end
local ok, results = false, { n = 1, err }
if chunk then
  local function collect(succeeded, ...)
    return succeeded, { n = select("#", ...), ... }
  end
  ok, results = collect(pcall(chunk))
end
rawset(env, "print", nil)
local lines = {}
for i = 1, #printed do lines[i] = quote(printed[i]) end
local outcome = ok and "returned" or "failed"
local reply = '{"outcome":"' .. outcome .. '","printed":[' .. concat(lines, ",") .. ']'
return reply .. ',"values":' .. encodeAll(results, results.n) .. '}'
`;

const censusBody = `
local count, names = 0, {}
for k in next, G do
  count = count + 1
  if type(k) == "string" then names[#names + 1] = quote(k) end
  if count == 100000 then break end
end
return '{"globals":' .. count .. ',"names":[' .. concat(names, ",") .. ']}'
`;

export class RecoveredExecutor implements LuaExecutor {
    private readonly gettop: NativeFunction<number, [NativePointerValue]>;
    private readonly settop: NativeFunction<void, [NativePointerValue, number]>;
    private readonly tolstring: NativeFunction<NativePointer, [NativePointerValue, number, NativePointerValue]>;
    private readonly pcall: NativeFunction<number, [NativePointerValue, number, number, number, NativePointerValue, NativePointerValue]>;
    private readonly load: NativeFunction<number, [NativePointerValue, NativePointerValue, NativePointerValue, NativePointerValue,
        NativePointerValue]>;
    private readonly environment: string;

    constructor(api: RecoveredApi, flavor: Flavor) {
        this.gettop = new NativeFunction(api.gettop, "int", ["pointer"]);
        this.settop = new NativeFunction(api.settop, "void", ["pointer", "int"]);
        this.tolstring = new NativeFunction(api.tolstring, "pointer", ["pointer", "int", "pointer"]);
        this.pcall = new NativeFunction(api.pcall, "int", ["pointer", "int", "int", "int", "pointer", "pointer"]);
        this.load = new NativeFunction(api.load, "int", ["pointer", "pointer", "pointer", "pointer", "pointer"]);
        this.environment = environmentSetup[(flavor === "5.1" || flavor === "luajit") ? "5.1" : "5.2"];
    }

    evaluate(L: NativePointer, source: string, limits: ReadLimits): Outcome {
        const program = [
            prelude,
            `local SOURCE = sub(${longString(source)}, 1, -2)`,
            `local ENTRIES, MAX_RESULTS = ${limits.entriesPerTable}, ${MAX_RESULTS}`,
            this.environment,
            serializer,
            evaluationBody,
        ].join("\n");
        const run = this.run(L, program);
        if (run.kind === "failed") {
            return { kind: "rejected", error: `The console's own Lua failed in this interpreter: ${run.text}` };
        }
        const reply = parsed<WireReply>(run.text);
        if (reply === null) {
            return { kind: "rejected", error: "The interpreter's reply could not be read." };
        }
        const values = reply.values.map(fromWire);
        return (reply.outcome === "returned")
            ? { kind: "returned", printed: reply.printed, values }
            : { kind: "failed", printed: reply.printed, error: values[0] ?? null };
    }

    census(L: NativePointer): Census | null {
        const run = this.run(L, [prelude, this.environment, censusBody].join("\n"));
        if (run.kind === "failed") {
            return null;
        }
        const census = parsed<WireCensus>(run.text);
        return (census !== null) ? { globals: census.globals, notable: notableGlobals(census.names) } : null;
    }

    private run(L: NativePointer, program: string): Run {
        const base = this.gettop(L);
        try {
            const chunk = new ChunkReader(program);
            if (this.load(L, chunk.reader, chunk.state, CHUNK_NAME, NULL) !== LUA_OK) {
                return { kind: "failed", text: this.stringAtTop(L) };
            }
            const status = this.pcall(L, 0, 1, 0, NULL, NULL);
            const text = this.stringAtTop(L);
            return (status === LUA_OK) ? { kind: "replied", text } : { kind: "failed", text };
        } finally {
            this.settop(L, base);
        }
    }

    private stringAtTop(L: NativePointer): string {
        const length = Memory.alloc(Process.pointerSize);
        const data = this.tolstring(L, -1, length);
        if (data.isNull()) {
            return "(not a string)";
        }
        return decodeLuaString(bytesAt(data, length), invalidByte => `\\\\x${invalidByte.toString(16).padStart(2, "0")}`);
    }
}

function longString(text: string): string {
    let level = "";
    while (text.includes(`]${level}]`)) {
        level += "=";
    }
    return `[${level}[\n${text}\n]${level}]`;
}

function parsed<T>(text: string): T | null {
    try {
        return JSON.parse(text) as T;
    } catch (e) {
        return null;
    }
}

function fromWire(value: WireValue): unknown {
    if (value === null || typeof value !== "object") {
        return value;
    }
    if ("i" in value) {
        return int64(value.i);
    }
    if ("t" in value) {
        return shapeOf(value.t.map(([key, item]) => [fromWire(key), fromWire(item)]), value.more);
    }
    return ("s" in value) ? value.s : value.o;
}

class ChunkReader {
    readonly state: NativePointer;
    readonly reader = chunkReader;
    private readonly text: NativePointer;

    constructor(program: string) {
        this.text = Memory.allocUtf8String(program);
        this.state = Memory.alloc(2 * Process.pointerSize);
        this.state.writePointer(this.text);
        this.state.add(Process.pointerSize).writePointer(ptr(utf8Length(program)));
    }
}

const chunkReader = new NativeCallback((_L: NativePointer, state: NativePointer, size: NativePointer): NativePointer => {
    const text = state.readPointer();
    const length = state.add(Process.pointerSize).readPointer();
    size.writePointer(length);
    state.add(Process.pointerSize).writePointer(NULL);
    return length.isNull() ? NULL : text;
}, "pointer", ["pointer", "pointer", "pointer"]);
