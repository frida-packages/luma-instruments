export interface JscInternals {
    debuggableVtable: NativePointer | null;
    globalObjectInfo: NativePointer;
    classNames: Map<string, string>;
    config: NativePointer;
    globalObjectInit: NativePointer;
    globalObjectDestructor: NativePointer;
}

const VTABLE_PREFIX_BYTES = 2 * Process.pointerSize;

export function internalsOf(module: Module): JscInternals {
    const globalObjectInfo = module.getExportByName("_ZN3JSC14JSGlobalObject6s_infoE");
    const apiGlobalObjectInfo = module.getExportByName("_ZN3JSC17JSAPIGlobalObject6s_infoE");
    return {
        debuggableVtable: module.findSymbolByName("_ZTVN3JSC24JSGlobalObjectDebuggableE")?.add(VTABLE_PREFIX_BYTES) ?? null,
        globalObjectInfo,
        classNames: new Map([[globalObjectInfo.toString(), "JSGlobalObject"], [apiGlobalObjectInfo.toString(), "JSAPIGlobalObject"]]),
        config: module.getExportByName("g_config"),
        globalObjectInit: module.getExportByName("_ZN3JSC14JSGlobalObject4initERNS_2VME"),
        globalObjectDestructor: module.getExportByName("_ZN3JSC14JSGlobalObjectD2Ev"),
    };
}
