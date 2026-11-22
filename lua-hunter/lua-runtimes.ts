import { recoverApi, type RecoveredApi } from "./api-recovery.js";
import { bindLuaApi, entryPointNames, type SymbolResolver } from "./lua-api.js";
import { ApiExecutor, type LuaExecutor } from "./lua-executor.js";
import { addressesMaterializedBy, functionStartsReferencing } from "./machine-code.js";
import { type Flavor, flavorFromApi, genericRelease, isMoreSpecific, type Release, releaseFromText } from "./lua-flavor.js";
import type { StateLayout } from "./lua-states.js";
import { findLibraryFunctions } from "./library-tables.js";
import { boundedCStringAt, ModuleImage } from "./module-image.js";
import { RecoveredExecutor } from "./wrapped-evaluation.js";

export type Discovery = "exports" | "symbols" | "strings";

export interface EntryPoint {
    name: string;
    address: NativePointer;
}

export interface Lifecycle {
    creators: NativePointer[];
    closer: NativePointer | null;
}

export class LuaRuntime {
    layout: StateLayout | null = null;
    readonly anchors = new Set<string>();

    constructor(
        readonly image: ModuleImage,
        readonly release: Release,
        readonly discovery: Discovery,
        readonly executor: LuaExecutor | null,
        readonly entryPoints: EntryPoint[],
        readonly lifecycle: Lifecycle,
        anchors: NativePointer[],
    ) {
        this.learnAnchors(anchors);
    }

    get flavor(): Flavor {
        return this.release.flavor;
    }

    learnAnchors(candidates: NativePointer[]): boolean {
        const before = this.anchors.size;
        for (const candidate of candidates) {
            this.anchors.add(candidate.strip().toString());
        }
        return this.anchors.size !== before;
    }

    get moduleName(): string {
        return this.image.name;
    }
}

const NEWSTATE_INSTRUCTION_LIMIT = 48;
const PANIC_MESSAGE = "PANIC: unprotected error in call to Lua API (";
const symbolPattern = /^(lua_|luaL_|luaJIT_|l_alloc$|panic$|lj_alloc_f$)/;
const anchorSymbols = ["l_alloc", "panic", "lj_alloc_f"];
const definedSymbolTypes = new Set<ModuleSymbolType>(["section", "function", "object"]);
const creatorNames = ["luaL_newstate", "lua_newstate"];
const releaseMarkers = ["Lua 5.", "LuaJIT 2."];
const identPrefixes = ["$Lua: ", "$LuaVersion: "];
const RELEASE_TEXT_LIMIT = 80;
const systemPrefixes: Partial<Record<Platform, string[]>> = {
    darwin: ["/System/", "/usr/lib/", "/Library/Apple/"],
    linux: ["/lib/", "/lib64/", "/usr/lib/", "/usr/lib64/", "/system/", "/apex/"],
    windows: ["c:\\windows\\"],
};

export function findExportedLuaRuntime(module: Module): LuaRuntime | null {
    const exported: SymbolResolver = name => module.findExportByName(name);
    if (exported("lua_gettop") === null) {
        return null;
    }
    const image = new ModuleImage(module);
    return fromSymbols(image, "exports", exported, releaseFromIdent(exported) ?? releaseFromStrings(image));
}

export function findEmbeddedLuaRuntime(module: Module): LuaRuntime | null {
    if (isSystemModule(module)) {
        return null;
    }
    const image = new ModuleImage(module);
    const release = releaseFromStrings(image);
    if (release === null) {
        return null;
    }
    const symbols = luaSymbolsOf(module);
    if (symbols.has("lua_gettop")) {
        return fromSymbols(image, "symbols", name => symbols.get(name) ?? null, release);
    }
    return fromStrings(image, release);
}

function fromSymbols(image: ModuleImage, discovery: Discovery, resolve: SymbolResolver, knownRelease: Release | null): LuaRuntime | null {
    const flavor = flavorFromApi(resolve);
    if (flavor === null) {
        return null;
    }
    const release = (knownRelease?.flavor === flavor) ? knownRelease : genericRelease(flavor);
    const entryPoints = entryPointNames.flatMap(name => {
        const address = resolve(name);
        return (address !== null) ? [{ name, address }] : [];
    });
    const lifecycle = {
        creators: creatorNames.map(resolve).filter((address): address is NativePointer => address !== null),
        closer: resolve("lua_close"),
    };
    const newState = resolve("luaL_newstate");
    const anchors = [
        ...((newState !== null) ? addressesMaterializedBy(newState, NEWSTATE_INSTRUCTION_LIMIT) : []),
        ...anchorSymbols.map(resolve).filter((address): address is NativePointer => address !== null),
    ].filter(address => image.isCode(address));
    return new LuaRuntime(image, release, discovery, executorFor(flavor, resolve), entryPoints, lifecycle, anchors);
}

function releaseFromIdent(resolve: SymbolResolver): Release | null {
    const ident = resolve("lua_ident");
    return (ident !== null) ? releaseFromText(boundedCStringAt(ident, RELEASE_TEXT_LIMIT)) : null;
}

function releaseFromStrings(image: ModuleImage): Release | null {
    let best: Release | null = null;
    for (const address of releaseMarkers.flatMap(marker => image.findText(marker))) {
        const candidates = [standaloneReleaseAt(address), ...identPrefixes.map(prefix => releaseAt(address.sub(prefix.length)))];
        for (const candidate of candidates) {
            if (candidate !== null && (best === null || isMoreSpecific(candidate, best))) {
                best = candidate;
            }
        }
    }
    return best;
}

function isSystemModule(module: Module): boolean {
    const path = (Process.platform === "windows") ? module.path.toLowerCase() : module.path;
    return (systemPrefixes[Process.platform] ?? []).some(prefix => path.startsWith(prefix));
}

function luaSymbolsOf(module: Module): Map<string, NativePointer> {
    const symbols = new Map<string, NativePointer>();
    for (const { name, address, type } of module.enumerateSymbols()) {
        if (definedSymbolTypes.has(type) && symbolPattern.test(name) && !symbols.has(name)) {
            symbols.set(name, address);
        }
    }
    return symbols;
}

function fromStrings(image: ModuleImage, release: Release): LuaRuntime {
    const library = findLibraryFunctions(image);
    const recovered = recoverApi(release.flavor, library, image);
    const executor = (recovered !== null) ? new RecoveredExecutor(recovered, release.flavor) : null;
    const recoveredEntryPoints = (recovered !== null)
        ? [
            { name: "lua_pcall", address: recovered.pcall },
            { name: "lua_gettop", address: recovered.gettop },
            { name: "lua_settop", address: recovered.settop },
        ]
        : [];
    const anchors = image.findCStrings(PANIC_MESSAGE, "prefix").flatMap(message => functionStartsReferencing(message, image.code));
    const lifecycle = { creators: [], closer: null };
    return new LuaRuntime(image, release, "strings", executor, [...recoveredEntryPoints, ...library], lifecycle, anchors);
}

function executorFor(flavor: Flavor, resolve: SymbolResolver): LuaExecutor | null {
    const api = bindLuaApi(flavor, resolve);
    if (api !== null) {
        return new ApiExecutor(api);
    }
    const minimal = minimalApiFrom(flavor, resolve);
    return (minimal !== null) ? new RecoveredExecutor(minimal, flavor) : null;
}

function minimalApiFrom(flavor: Flavor, resolve: SymbolResolver): RecoveredApi | null {
    const minimal = {
        gettop: resolve("lua_gettop"),
        settop: resolve("lua_settop"),
        tolstring: resolve("lua_tolstring"),
        pcall: resolve((flavor === "5.1" || flavor === "luajit") ? "lua_pcall" : "lua_pcallk"),
        load: resolve("lua_load"),
    };
    return Object.values(minimal).every(address => address !== null) ? minimal as RecoveredApi : null;
}

function standaloneReleaseAt(address: NativePointer): Release | null {
    return startsCString(address) ? releaseAt(address) : null;
}

function releaseAt(address: NativePointer): Release | null {
    return releaseFromText(boundedCStringAt(address, RELEASE_TEXT_LIMIT));
}

function startsCString(address: NativePointer): boolean {
    return boundedCStringAt(address.sub(1), 1) === "";
}
