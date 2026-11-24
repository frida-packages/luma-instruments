import type { Flavor } from "./lua-flavor.js";

export type SymbolResolver = (name: string) => NativePointer | null;

export const luaTypes = {
    nil: 0,
    boolean: 1,
    lightUserdata: 2,
    number: 3,
    string: 4,
    table: 5,
    function: 6,
    userdata: 7,
    thread: 8,
    cdata: 10,
} as const;

export const luaTypeNames = new Map<number, string>([
    [luaTypes.nil, "nil"],
    [luaTypes.boolean, "boolean"],
    [luaTypes.lightUserdata, "userdata"],
    [luaTypes.number, "number"],
    [luaTypes.string, "string"],
    [luaTypes.table, "table"],
    [luaTypes.function, "function"],
    [luaTypes.userdata, "userdata"],
    [luaTypes.thread, "thread"],
    [luaTypes.cdata, "cdata"],
]);

const LUA_MULTRET = -1;
const LUA_OK = 0;
const LUA51_GLOBALSINDEX = -10002;
const LUA52_REGISTRYINDEX = -1001000;
const LUA_RIDX_GLOBALS = 2;
const TEXT_MODE = Memory.allocUtf8String("t");

type Generation = "5.1" | "5.2" | "5.3";

const generations: Record<Flavor, Generation> = {
    "5.1": "5.1",
    "luajit": "5.1",
    "5.2": "5.2",
    "5.3": "5.3",
    "5.4": "5.3",
};

export const entryPointNames = [
    "lua_pcall",
    "lua_pcallk",
    "lua_call",
    "lua_callk",
    "lua_getglobal",
    "lua_getfield",
    "lua_gettop",
    "lua_settop",
    "lua_rawgeti",
    "lua_pushstring",
    "lua_pushnumber",
    "lua_pushinteger",
    "luaL_checkinteger",
    "luaL_checknumber",
    "luaL_checklstring",
    "luaL_optinteger",
];

export function bindLuaApi(flavor: Flavor, resolve: SymbolResolver): LuaApi | null {
    const generation = generations[flavor];
    const binder = new Binder(resolve);
    const core = bindCore(binder);
    const flavored = (generation === "5.1") ? bindGeneration51(binder, core) : bindGeneration52(binder, generation);
    return (binder.missing.length === 0) ? new LuaApi(core, flavored) : null;
}

type CoreFunctions = ReturnType<typeof bindCore>;
type FlavoredFunctions = ReturnType<typeof bindGeneration51> | ReturnType<typeof bindGeneration52>;

function bindCore(binder: Binder) {
    return {
        gettop: binder.bind("lua_gettop", "int", ["pointer"]),
        settop: binder.bind("lua_settop", "void", ["pointer", "int"]),
        checkstack: binder.bind("lua_checkstack", "int", ["pointer", "int"]),
        type: binder.bind("lua_type", "int", ["pointer", "int"]),
        toboolean: binder.bind("lua_toboolean", "int", ["pointer", "int"]),
        tolstring: binder.bind("lua_tolstring", "pointer", ["pointer", "int", "pointer"]),
        topointer: binder.bind("lua_topointer", "pointer", ["pointer", "int"]),
        iscfunction: binder.bind("lua_iscfunction", "int", ["pointer", "int"]),
        tocfunction: binder.bind("lua_tocfunction", "pointer", ["pointer", "int"]),
        next: binder.bind("lua_next", "int", ["pointer", "int"]),
        pushnil: binder.bind("lua_pushnil", "void", ["pointer"]),
        pushvalue: binder.bind("lua_pushvalue", "void", ["pointer", "int"]),
        pushlstring: binder.bind("lua_pushlstring", "pointer", ["pointer", "pointer", "size_t"]),
        rawget: binder.bind("lua_rawget", "int", ["pointer", "int"]),
        rawset: binder.bind("lua_rawset", "void", ["pointer", "int"]),
        createtable: binder.bind("lua_createtable", "void", ["pointer", "int", "int"]),
        setmetatable: binder.bind("lua_setmetatable", "int", ["pointer", "int"]),
        setfield: binder.bind("lua_setfield", "void", ["pointer", "int", "pointer"]),
    };
}

function bindGeneration51(binder: Binder, core: CoreFunctions) {
    const loadbuffer = binder.bind("luaL_loadbuffer", "int", ["pointer", "pointer", "size_t", "pointer"]);
    const pcall = binder.bind("lua_pcall", "int", ["pointer", "int", "int", "int"]);
    const tonumber = binder.bind("lua_tonumber", "double", ["pointer", "int"]);
    const objlen = binder.bind("lua_objlen", "size_t", ["pointer", "int"]);
    const rawgeti = binder.bind("lua_rawgeti", "void", ["pointer", "int", "int"]);
    const setfenv = binder.bind("lua_setfenv", "int", ["pointer", "int"]);
    return {
        load: (L: NativePointer, buffer: NativePointer, size: number, name: NativePointer) => loadbuffer(L, buffer, size, name),
        pcall: (L: NativePointer, nargs: number, nresults: number) => pcall(L, nargs, nresults, 0),
        toNumber: (L: NativePointer, index: number) => tonumber(L, index),
        isInteger: (_L: NativePointer, _index: number) => false,
        toInteger: (_L: NativePointer, _index: number) => int64(0),
        rawLength: (L: NativePointer, index: number) => Number(objlen(L, index)),
        rawGetIndex: (L: NativePointer, index: number, n: number) => rawgeti(L, index, n),
        pushGlobals: (L: NativePointer) => core.pushvalue(L, LUA51_GLOBALSINDEX),
        setEnvironment: (L: NativePointer, functionIndex: number) => setfenv(L, functionIndex) !== 0,
    };
}

function bindGeneration52(binder: Binder, generation: Generation) {
    const loadbufferx = binder.bind("luaL_loadbufferx", "int", ["pointer", "pointer", "size_t", "pointer", "pointer"]);
    const pcallk = binder.bind("lua_pcallk", "int", ["pointer", "int", "int", "int", "pointer", "pointer"]);
    const tonumberx = binder.bind("lua_tonumberx", "double", ["pointer", "int", "pointer"]);
    const setupvalue = binder.bind("lua_setupvalue", "pointer", ["pointer", "int", "int"]);
    const hasIntegers = generation === "5.3";
    const rawlen = hasIntegers
        ? binder.bind("lua_rawlen", "uint64", ["pointer", "int"])
        : binder.bind("lua_rawlen", "size_t", ["pointer", "int"]);
    const rawgeti = hasIntegers
        ? binder.bind("lua_rawgeti", "int", ["pointer", "int", "int64"])
        : binder.bind("lua_rawgeti", "void", ["pointer", "int", "int"]);
    const isinteger = hasIntegers ? binder.bind("lua_isinteger", "int", ["pointer", "int"]) : null;
    const tointegerx = hasIntegers ? binder.bind("lua_tointegerx", "int64", ["pointer", "int", "pointer"]) : null;
    return {
        load: (L: NativePointer, buffer: NativePointer, size: number, name: NativePointer) => loadbufferx(L, buffer, size, name, TEXT_MODE),
        pcall: (L: NativePointer, nargs: number, nresults: number) => pcallk(L, nargs, nresults, 0, NULL, NULL),
        toNumber: (L: NativePointer, index: number) => tonumberx(L, index, NULL),
        isInteger: (L: NativePointer, index: number) => isinteger !== null && isinteger(L, index) !== 0,
        toInteger: (L: NativePointer, index: number) => tointegerx!(L, index, NULL),
        rawLength: (L: NativePointer, index: number) => Number(rawlen(L, index)),
        rawGetIndex: (L: NativePointer, index: number, n: number) => {
            rawgeti(L, index, n);
        },
        pushGlobals: (L: NativePointer) => {
            rawgeti(L, LUA52_REGISTRYINDEX, LUA_RIDX_GLOBALS);
        },
        setEnvironment: (L: NativePointer, functionIndex: number) => !setupvalue(L, functionIndex, 1).isNull(),
    };
}

export class LuaApi {
    readonly #core: CoreFunctions;
    readonly #flavored: FlavoredFunctions;

    constructor(
        core: CoreFunctions,
        flavored: FlavoredFunctions,
    ) {
        this.#core = core;
        this.#flavored = flavored;
    }

    top(L: NativePointer): number {
        return this.#core.gettop(L);
    }

    setTop(L: NativePointer, index: number): void {
        this.#core.settop(L, index);
    }

    ensureStack(L: NativePointer, slots: number): boolean {
        return this.#core.checkstack(L, slots) !== 0;
    }

    load(L: NativePointer, source: string, chunkName: string): boolean {
        const buffer = Memory.allocUtf8String(source);
        return this.#flavored.load(L, buffer, utf8Length(source), Memory.allocUtf8String(chunkName)) === LUA_OK;
    }

    protectedCall(L: NativePointer, argumentCount: number): boolean {
        return this.#flavored.pcall(L, argumentCount, LUA_MULTRET) === LUA_OK;
    }

    typeOf(L: NativePointer, index: number): number {
        return this.#core.type(L, index);
    }

    toBoolean(L: NativePointer, index: number): boolean {
        return this.#core.toboolean(L, index) !== 0;
    }

    toNumber(L: NativePointer, index: number): number {
        return this.#flavored.toNumber(L, index);
    }

    isInteger(L: NativePointer, index: number): boolean {
        return this.#flavored.isInteger(L, index);
    }

    toInteger(L: NativePointer, index: number): Int64 {
        return this.#flavored.toInteger(L, index);
    }

    toBytes(L: NativePointer, index: number): Uint8Array | null {
        const length = Memory.alloc(Process.pointerSize);
        const data = this.#core.tolstring(L, index, length);
        if (data.isNull()) {
            return null;
        }
        return bytesAt(data, length);
    }

    toPointer(L: NativePointer, index: number): NativePointer {
        return this.#core.topointer(L, index);
    }

    cFunctionAt(L: NativePointer, index: number): NativePointer | null {
        return (this.#core.iscfunction(L, index) !== 0) ? this.#core.tocfunction(L, index) : null;
    }

    rawLength(L: NativePointer, index: number): number {
        return this.#flavored.rawLength(L, index);
    }

    next(L: NativePointer, tableIndex: number): boolean {
        return this.#core.next(L, tableIndex) !== 0;
    }

    pushNil(L: NativePointer): void {
        this.#core.pushnil(L);
    }

    pushCopy(L: NativePointer, index: number): void {
        this.#core.pushvalue(L, index);
    }

    pushString(L: NativePointer, text: string): void {
        this.#core.pushlstring(L, Memory.allocUtf8String(text), utf8Length(text));
    }

    pushGlobals(L: NativePointer): void {
        this.#flavored.pushGlobals(L);
    }

    pushNewTable(L: NativePointer): void {
        this.#core.createtable(L, 0, 0);
    }

    rawGet(L: NativePointer, tableIndex: number): number {
        this.#core.rawget(L, tableIndex);
        return this.#core.type(L, -1);
    }

    rawGetIndex(L: NativePointer, tableIndex: number, n: number): void {
        this.#flavored.rawGetIndex(L, tableIndex, n);
    }

    rawSet(L: NativePointer, tableIndex: number): void {
        this.#core.rawset(L, tableIndex);
    }

    setField(L: NativePointer, tableIndex: number, name: string): void {
        this.#core.setfield(L, tableIndex, Memory.allocUtf8String(name));
    }

    setMetatable(L: NativePointer, index: number): void {
        this.#core.setmetatable(L, index);
    }

    setEnvironment(L: NativePointer, functionIndex: number): boolean {
        return this.#flavored.setEnvironment(L, functionIndex);
    }
}

class Binder {
    readonly missing: string[] = [];
    readonly #resolve: SymbolResolver;

    constructor(resolve: SymbolResolver) {
        this.#resolve = resolve;
    }

    bind<R extends NativeFunctionReturnType, A extends NativeFunctionArgumentType[] | []>(name: string, returnType: R, argumentTypes: A) {
        const address = this.#resolve(name);
        if (address === null) {
            this.missing.push(name);
        }
        return new NativeFunction(address ?? NULL, returnType, argumentTypes);
    }
}

export function bytesAt(data: NativePointer, length: NativePointer): Uint8Array {
    const size = Number(length.readULong());
    return (size === 0) ? new Uint8Array(0) : new Uint8Array(data.readByteArray(size)!);
}

export function utf8Length(text: string): number {
    let length = 0;
    for (const character of text) {
        const codePoint = character.codePointAt(0)!;
        length += (codePoint < 0x80) ? 1 : (codePoint < 0x800) ? 2 : (codePoint < 0x10000) ? 3 : 4;
    }
    return length;
}
