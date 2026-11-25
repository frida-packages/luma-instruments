import type { RuntimeFacts } from "./runtime-kit.js";
import type { Runtime } from "./runtimes.js";

const missing = "—";

export function engineLabel(runtime: Runtime): string {
    const hermes = runtime.facts?.hermes;
    if (hermes === null || hermes === undefined) {
        return runtime.runtimeClass.engine;
    }
    const release = hermes["OSS Release Version"];
    const bytecode = hermes["Bytecode Version"];
    const flavor = (hermes["Static Hermes"] === true) ? "Hermes V1" : "Hermes";
    return [flavor, release, (bytecode !== undefined) ? `bytecode ${bytecode}` : null].filter(part => part !== null && part !== undefined).join(" ");
}

export function reactNativeLabel(facts: RuntimeFacts | null): string {
    const version = facts?.reactNative;
    if (version === null || version === undefined) {
        return missing;
    }
    const prerelease = (typeof version.prerelease === "string") ? `-${version.prerelease}` : "";
    return `${version.major}.${version.minor}.${version.patch}${prerelease}`;
}

export function architectureLabel(facts: RuntimeFacts | null): string {
    if (facts === null) {
        return missing;
    }
    if (!facts.isReactNative) {
        return "not React Native";
    }
    const renderer = facts.fabric ? ", Fabric" : "";
    if (facts.bridgeless) {
        return `new, bridgeless${renderer}`;
    }
    return facts.turboModules ? `old, bridge with TurboModules${renderer}` : `old, bridge${renderer}`;
}

export function buildLabel(facts: RuntimeFacts | null): string {
    if (facts === null) {
        return missing;
    }
    const bundle = (facts.dev === null) ? null : (facts.dev ? "__DEV__ bundle" : "production bundle");
    const engine = facts.hermes?.["Build"];
    const debuggerPart = (facts.hermes?.["Debugger Enabled"] === true) ? "debugger" : null;
    const parts = [bundle, (typeof engine === "string") ? `${engine.toLowerCase()} engine` : null, debuggerPart];
    const shown = parts.filter(part => part !== null);
    return (shown.length !== 0) ? shown.join(", ") : missing;
}

export function bundleLabel(facts: RuntimeFacts | null): string {
    const url = facts?.bundleURL;
    if (url === null || url === undefined || url.length === 0) {
        return missing;
    }
    return lastPathComponent(url);
}

export function threadLabel(runtime: Runtime): string {
    if (runtime.owner === null) {
        return missing;
    }
    const name = runtime.ownerName ?? String(runtime.owner);
    return (runtime.ownership === "presumed") ? `${name} (presumed)` : name;
}

export function lastPathComponent(url: string): string {
    const path = url.split("?")[0];
    return path.slice(path.lastIndexOf("/") + 1) || path;
}
