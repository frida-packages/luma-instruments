import { type PropertyListValue, readPropertyList } from "./property-list.js";

export type FuseState = "on" | "off" | "removed";

export interface Fuse {
    name: string;
    state: FuseState;
}

export interface DeclaredIntegrity {
    algorithm: string;
    hash: string;
}

export interface ElectronBundle {
    framework: Module;
    appPath: string;
    resourcesPath: string;
    version: string | null;
    identifier: string | null;
    declaredIntegrity: Map<string, DeclaredIntegrity>;
    fuses: Fuse[] | null;
}

const fuseSentinel = "dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX";
const fuseNames = [
    "RunAsNode",
    "EnableCookieEncryption",
    "EnableNodeOptionsEnvironmentVariable",
    "EnableNodeCliInspectArguments",
    "EnableEmbeddedAsarIntegrityValidation",
    "OnlyLoadAppFromAsar",
    "LoadBrowserProcessSpecificV8Snapshot",
    "GrantFileProtocolExtraPrivileges",
    "WasmTrapHandlers",
];
const fuseStates: { [code: number]: FuseState } = { 0x30: "off", 0x31: "on", 0x72: "removed" };
const skippedSections = new Set(["__text", ".text"]);

export function locateBundle(): ElectronBundle | null {
    const framework = Process.enumerateModules().find(module => module.findExportByName("napi_open_handle_scope") !== null);
    if (framework === undefined) {
        return null;
    }
    const fuses = readFuses(framework);
    if (fuses === null) {
        return null;
    }
    return (Process.platform === "darwin") ? darwinBundle(framework, fuses) : linuxBundle(framework, fuses);
}

function readFuses(framework: Module): Fuse[] | null {
    const pattern = [...fuseSentinel].map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");
    for (const section of framework.enumerateSections()) {
        if (skippedSections.has(section.name) || section.size === 0) {
            continue;
        }
        const [match] = Memory.scanSync(section.address, section.size, pattern);
        if (match !== undefined) {
            return decodeFuseWire(match.address.add(fuseSentinel.length));
        }
    }
    return null;
}

function darwinBundle(framework: Module, fuses: Fuse[]): ElectronBundle {
    const appPath = framework.path.slice(0, framework.path.indexOf("/Contents/Frameworks/"));
    const frameworkRoot = framework.path.slice(0, framework.path.indexOf("/Versions/"));
    const info = readPropertyList(`${appPath}/Contents/Info.plist`);
    const frameworkInfo = readPropertyList(`${frameworkRoot}/Resources/Info.plist`);
    return {
        framework,
        appPath,
        resourcesPath: `${appPath}/Contents/Resources`,
        version: stringOf(frameworkInfo?.CFBundleVersion),
        identifier: stringOf(info?.CFBundleIdentifier),
        declaredIntegrity: integrityOf(info?.ElectronAsarIntegrity, `${appPath}/Contents/`),
        fuses,
    };
}

function linuxBundle(framework: Module, fuses: Fuse[]): ElectronBundle {
    const appPath = framework.path.slice(0, framework.path.lastIndexOf("/"));
    return {
        framework,
        appPath,
        resourcesPath: `${appPath}/resources`,
        version: null,
        identifier: null,
        declaredIntegrity: new Map(),
        fuses,
    };
}

function decodeFuseWire(wire: NativePointer): Fuse[] {
    const length = wire.add(1).readU8();
    const codes = new Uint8Array(wire.add(2).readByteArray(length)!);
    return [...codes].map((code, index) => ({
        name: fuseNames[index] ?? `Fuse${index}`,
        state: fuseStates[code] ?? "removed",
    }));
}

function integrityOf(value: PropertyListValue | undefined, base: string): Map<string, DeclaredIntegrity> {
    const declared = new Map<string, DeclaredIntegrity>();
    if (value === undefined || typeof value !== "object" || Array.isArray(value)) {
        return declared;
    }
    for (const [archive, entry] of Object.entries(value)) {
        const { algorithm, hash } = entry as { algorithm: string; hash: string };
        declared.set(base + archive, { algorithm, hash });
    }
    return declared;
}

function stringOf(value: PropertyListValue | undefined): string | null {
    return (typeof value === "string") ? value : null;
}
