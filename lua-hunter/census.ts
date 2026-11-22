import { type LuaApi, luaTypes } from "./lua-api.js";
import { decodeLuaString } from "./lua-values.js";

export interface Census {
    globals: number;
    notable: string[];
}

const CENSUS_STACK_SLOTS = 4;
const MAX_GLOBALS_COUNTED = 100000;

const standardGlobals = new Set([
    "_G", "_VERSION", "_ENV", "assert", "collectgarbage", "dofile", "error", "gcinfo", "getfenv", "getmetatable", "ipairs", "load",
    "loadfile", "loadstring", "module", "newproxy", "next", "pairs", "pcall", "print", "rawequal", "rawget", "rawlen", "rawset",
    "require", "select", "setfenv", "setmetatable", "tonumber", "tostring", "type", "unpack", "warn", "xpcall", "bit", "bit32",
    "coroutine", "debug", "ffi", "io", "jit", "math", "os", "package", "string", "table", "utf8", "arg",
]);

export function takeCensus(api: LuaApi, L: NativePointer): Census | null {
    const base = api.top(L);
    if (!api.ensureStack(L, CENSUS_STACK_SLOTS)) {
        return null;
    }
    try {
        api.pushGlobals(L);
        const globals = base + 1;
        if (api.typeOf(L, globals) !== luaTypes.table) {
            return null;
        }
        return namesOf(api, L, globals);
    } finally {
        api.setTop(L, base);
    }
}

function namesOf(api: LuaApi, L: NativePointer, globals: number): Census {
    let count = 0;
    const names: string[] = [];
    api.pushNil(L);
    while (api.next(L, globals)) {
        count++;
        if (api.typeOf(L, -2) === luaTypes.string) {
            names.push(decodeLuaString(api.toBytes(L, -2)!));
        }
        api.setTop(L, -2);
        if (count === MAX_GLOBALS_COUNTED) {
            break;
        }
    }
    return { globals: count, notable: notableGlobals(names) };
}

export function notableGlobals(names: string[]): string[] {
    return names.filter(name => !standardGlobals.has(name)).sort();
}
