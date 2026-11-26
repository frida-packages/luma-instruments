import { type AnchorRoute, findJsiBase, type JsiBase, readableRangesOf } from "./jsi-vtables.js";
import type { MemorySearch } from "./memory-search.js";
import { primaryVtablesOf, type TypeName, typeNamesEndingWith } from "./rtti.js";

export type Engine = "Hermes" | "JavaScriptCore" | "V8";

export interface RuntimeClass {
    engine: Engine;
    typeName: string;
    vtable: NativePointer;
    base: JsiBase;
}

export interface ClassSearch {
    bases: JsiBase[];
    classes: RuntimeClass[];
    modulesSearched: number;
}

interface Implementation {
    engine: Engine;
    typeName: RegExp;
}

const TYPE_NAME_SUFFIXES = ["RuntimeE", "RuntimeImplE"];

const implementations: Implementation[] = [
    { engine: "Hermes", typeName: /HermesRuntimeImplE$/ },
    { engine: "JavaScriptCore", typeName: /\d+JSCRuntimeE$/ },
    { engine: "V8", typeName: /\d+V8RuntimeE$/ },
];

const systemPrefixes: Record<string, string[]> = {
    darwin: ["/System/", "/usr/lib/", "/Library/Apple/"],
    linux: ["/system/", "/apex/", "/vendor/", "/lib/", "/usr/lib/", "/lib64/"],
    windows: ["C:\\Windows\\"],
};

const FRIDA_MODULE = /^frida-/;

export async function findRuntimeClasses(routes: AnchorRoute[], search: MemorySearch): Promise<ClassSearch> {
    const modules = applicationModules();
    const bases: JsiBase[] = [];
    for (const route of routes) {
        for (const module of modules) {
            if (search.stopReason !== null) {
                break;
            }
            const base = findJsiBase(module, [route], search);
            if (base !== null) {
                bases.push(base);
            }
            await yieldToEventLoop();
        }
        if (bases.length !== 0) {
            break;
        }
    }
    const baseModules = modules.filter(module => bases.some(base => base.module.path === module.path));
    let classes = await classesAmong(baseModules, bases, search);
    if (classes.length === 0 && bases.length !== 0) {
        classes = await classesAmong(modules.filter(module => !baseModules.includes(module)), bases, search);
    }
    return { bases, classes, modulesSearched: modules.length };
}

async function classesAmong(modules: Module[], bases: JsiBase[], search: MemorySearch): Promise<RuntimeClass[]> {
    const classes: RuntimeClass[] = [];
    for (const module of modules) {
        if (search.stopReason !== null) {
            break;
        }
        const names = runtimeTypeNamesIn(module, search);
        classes.push(...classesIn(module, names, baseFor(module, bases), search));
        await yieldToEventLoop();
    }
    return classes;
}

function applicationModules(): Module[] {
    const prefixes = systemPrefixes[Process.platform] ?? [];
    return Process.enumerateModules().filter(module =>
        !prefixes.some(prefix => module.path.startsWith(prefix)) && !FRIDA_MODULE.test(module.name));
}

function runtimeTypeNamesIn(module: Module, search: MemorySearch): TypeName[] {
    const ranges = readableRangesOf(module);
    return TYPE_NAME_SUFFIXES.flatMap(suffix => typeNamesEndingWith(ranges, suffix, search))
        .filter(name => engineOf(name.text) !== null);
}

function baseFor(module: Module, bases: JsiBase[]): JsiBase | null {
    return bases.find(base => base.module.path === module.path) ?? bases[0] ?? null;
}

function classesIn(module: Module, names: TypeName[], base: JsiBase | null, search: MemorySearch): RuntimeClass[] {
    if (base === null) {
        return [];
    }
    const ranges = readableRangesOf(module);
    return names.flatMap(name => primaryVtablesOf(ranges, name, search).map(vtable => ({
        engine: engineOf(name.text)!,
        typeName: name.text,
        vtable,
        base,
    })));
}

export function engineOf(typeName: string): Engine | null {
    return implementations.find(implementation => implementation.typeName.test(typeName))?.engine ?? null;
}

function yieldToEventLoop(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}
