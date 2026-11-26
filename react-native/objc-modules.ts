import type { MemorySearch } from "./memory-search.js";
import { type ObjCRuntime, objCRuntime } from "./objc-runtime.js";
import type { BridgeTable, ModuleKind, NativeModuleInfo } from "./platforms.js";
import { searchHeap } from "./runtime-instances.js";

interface RegistryMarkers {
    bridgeModule: NativePointer;
    turboModule: NativePointer;
    componentView: NativePointer;
    viewManager: NativePointer;
}

interface ModuleClass {
    cls: NativePointer;
    info: NativeModuleInfo;
}

const EXPORTED_METHOD_PREFIX = "__rct_export__";
const COMPONENT_VIEW_SUFFIX = "ComponentView";
const STRIPPED_NAME_PREFIXES = ["RCT", "RK"];
const MODULE_HOLDER_CLASSES = ["RCTTurboModuleManager", "RCTCxxBridge"];

export class ObjCModuleRegistry {
    readonly #objc: ObjCRuntime | null = objCRuntime();
    #classes: ModuleClass[] = [];
    #holders: NativePointer[] = [];

    async list(search: MemorySearch): Promise<NativeModuleInfo[]> {
        const objc = this.#objc;
        const markers = (objc !== null) ? markersOf(objc) : null;
        if (objc === null || markers === null) {
            return [];
        }
        const classes = objc.classes().flatMap(cls => {
            const kind = kindOf(objc, markers, cls);
            return (kind === null) ? [] : [{ cls, info: describeClass(objc, cls, kind) }];
        });
        for (const moduleClass of classes) {
            moduleClass.info.base = classes.some(other => other !== moduleClass && descendsFrom(objc, other.cls, moduleClass.cls));
        }
        this.#classes = classes;
        this.#holders = await instancesOf(objc, MODULE_HOLDER_CLASSES.map(name => objc.getClass(name)).filter(cls => !cls.isNull()),
            search);
        return classes.map(moduleClass => moduleClass.info);
    }

    loadedNames(): Set<string> {
        const objc = this.#objc;
        const loaded = new Set<string>();
        if (objc === null) {
            return loaded;
        }
        for (const holder of this.#holders) {
            const turbo = objc.nameOf(objc.classOf(holder)) === "RCTTurboModuleManager";
            for (const { cls, info } of this.#classes.filter(({ info }) => info.kind !== "Fabric component")) {
                const argument = turbo ? Memory.allocUtf8String(info.name) : cls;
                if (objc.sendForBoolean(holder, "moduleIsInitialized:", argument)) {
                    loaded.add(info.name);
                }
            }
        }
        return loaded;
    }

    bridgeTable(): BridgeTable | null {
        const objc = this.#objc;
        if (objc === null) {
            return null;
        }
        const bridgeClass = objc.getClass("RCTCxxBridge");
        const moduleLists = this.#holders
            .filter(holder => objc.classOf(holder).equals(bridgeClass))
            .map(bridge => objc.instanceVariable(bridge, bridgeClass, "_moduleDataByID"))
            .filter(modules => modules !== null && !modules.isNull());
        return (moduleLists.length !== 0) ? tableOf(objc, moduleLists[0]!) : null;
    }
}

function tableOf(objc: ObjCRuntime, modules: NativePointer): BridgeTable {
    const table: BridgeTable = { modules: [], methods: [] };
    for (let id = 0; id !== objc.sendForCount(modules, "count"); id++) {
        const moduleData = objc.sendForObjectAt(modules, "objectAtIndex:", id);
        table.modules.push(objc.stringOf(objc.sendForObject(moduleData, "name")));
        const methods = objc.sendForObject(moduleData, "methods");
        const count = methods.isNull() ? 0 : objc.sendForCount(methods, "count");
        table.methods.push(Array.from({ length: count }, (_, index) =>
            objc.sendForObject(objc.sendForObjectAt(methods, "objectAtIndex:", index), "JSMethodName").readUtf8String() ?? `#${index}`));
    }
    return table;
}

function markersOf(objc: ObjCRuntime): RegistryMarkers | null {
    const bridgeModule = objc.getProtocol("RCTBridgeModule");
    if (bridgeModule.isNull()) {
        return null;
    }
    return {
        bridgeModule,
        turboModule: objc.getProtocol("RCTTurboModule"),
        componentView: objc.getProtocol("RCTComponentViewProtocol"),
        viewManager: objc.getClass("RCTViewManager"),
    };
}

function kindOf(objc: ObjCRuntime, markers: RegistryMarkers, cls: NativePointer): ModuleKind | null {
    if (!markers.componentView.isNull() && conforms(objc, cls, markers.componentView)
            && objc.nameOf(cls).endsWith(COMPONENT_VIEW_SUFFIX)) {
        return "Fabric component";
    }
    if (!conforms(objc, cls, markers.bridgeModule)) {
        return null;
    }
    if (!markers.viewManager.isNull() && descendsFrom(objc, cls, markers.viewManager)) {
        return "view manager";
    }
    if (!markers.turboModule.isNull() && conforms(objc, cls, markers.turboModule)) {
        return "TurboModule";
    }
    return "native module";
}

function describeClass(objc: ObjCRuntime, cls: NativePointer, kind: ModuleKind): NativeModuleInfo {
    const className = objc.nameOf(cls);
    const name = (kind === "Fabric component") ? className : strippedName(moduleNameOf(objc, cls) ?? className);
    const methods = objc.classMethodNames(cls).filter(method => method.startsWith(EXPORTED_METHOD_PREFIX)).length;
    return { name, kind, className, methods, base: false };
}

function conforms(objc: ObjCRuntime, cls: NativePointer, protocol: NativePointer): boolean {
    for (let current = cls; !current.isNull(); current = objc.superclassOf(current)) {
        if (objc.conformsToProtocol(current, protocol)) {
            return true;
        }
    }
    return false;
}

function descendsFrom(objc: ObjCRuntime, cls: NativePointer, ancestor: NativePointer): boolean {
    for (let current = objc.superclassOf(cls); !current.isNull(); current = objc.superclassOf(current)) {
        if (current.equals(ancestor)) {
            return true;
        }
    }
    return false;
}

function moduleNameOf(objc: ObjCRuntime, cls: NativePointer): string | null {
    if (!objc.respondsToClassMethod(cls, "moduleName")) {
        return null;
    }
    const name = objc.stringOf(objc.sendForObject(cls, "moduleName"));
    return (name === null || name.length === 0) ? null : name;
}

function strippedName(name: string): string {
    const prefix = STRIPPED_NAME_PREFIXES.find(candidate => name.startsWith(candidate));
    return (prefix !== undefined) ? name.slice(prefix.length) : name;
}

async function instancesOf(objc: ObjCRuntime, classes: NativePointer[], search: MemorySearch): Promise<NativePointer[]> {
    if (classes.length === 0) {
        return [];
    }
    return (await searchHeap(search, classes, objc.isaClassMask))
        .filter(({ value }) => value.and(objc.isaMagicMask).equals(objc.isaMagicValue))
        .map(({ address }) => address);
}
