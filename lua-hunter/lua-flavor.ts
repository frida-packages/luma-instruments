import type { SymbolResolver } from "./lua-api.js";

export type Flavor = "5.1" | "5.2" | "5.3" | "5.4" | "luajit";

export interface Release {
    flavor: Flavor;
    name: string;
}

const flavorMarkers: [Flavor, string][] = [
    ["luajit", "luaJIT_setmode"],
    ["5.4", "lua_newuserdatauv"],
    ["5.3", "lua_rotate"],
    ["5.2", "lua_pcallk"],
    ["5.1", "lua_pcall"],
];

export function flavorFromApi(resolve: SymbolResolver): Flavor | null {
    return flavorMarkers.find(([, marker]) => resolve(marker) !== null)?.[0] ?? null;
}

const identPattern = /^\$Lua(?:Version)?: Lua (5\.[1-4])(\.\d+)?\b/;
const versionPattern = /^Lua (5\.[1-4])$/;
const luaJitPattern = /^LuaJIT (2\.\d+\.[0-9A-Za-z_]+)/;

export function releaseFromText(text: string): Release | null {
    const ident = identPattern.exec(text);
    if (ident !== null) {
        return { flavor: ident[1] as Flavor, name: `Lua ${ident[1]}${ident[2] ?? ""}` };
    }
    const version = versionPattern.exec(text);
    if (version !== null) {
        return { flavor: version[1] as Flavor, name: `Lua ${version[1]}` };
    }
    const luaJit = luaJitPattern.exec(text);
    if (luaJit !== null) {
        return { flavor: "luajit", name: `LuaJIT ${luaJit[1]}` };
    }
    return null;
}

export function genericRelease(flavor: Flavor): Release {
    return { flavor, name: (flavor === "luajit") ? "LuaJIT" : `Lua ${flavor}` };
}

export function isMoreSpecific(candidate: Release, known: Release): boolean {
    if (candidate.flavor !== known.flavor) {
        return candidate.flavor === "luajit";
    }
    return candidate.name.length > known.name.length;
}

export interface ThreadTag {
    offset: number;
    value: number;
}

const PUC_THREAD_TAG = 8;
const LUAJIT_THREAD_TAG = 6;

export function threadTagOf(flavor: Flavor): ThreadTag {
    return (flavor === "luajit")
        ? { offset: Process.pointerSize + 1, value: LUAJIT_THREAD_TAG }
        : { offset: Process.pointerSize, value: PUC_THREAD_TAG };
}
