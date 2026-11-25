import { RunLoopWaker } from "./apple-run-loops.js";
import { ObjCModuleRegistry } from "./objc-modules.js";

export type ModuleKind = "native module" | "TurboModule" | "view manager" | "Fabric component";

export interface NativeModuleInfo {
    name: string;
    kind: ModuleKind;
    className: string;
    methods: number;
    base: boolean;
}

export interface BridgeTable {
    modules: (string | null)[];
    methods: string[][];
}

export interface Platform {
    readonly wakes: boolean;
    readonly knowsLoadedModules: boolean;
    wake(thread: ThreadId, task: () => void): boolean;
    nativeModules(): NativeModuleInfo[];
    loadedModuleNames(): Set<string>;
    bridgeTable(): BridgeTable | null;
    dispose(): void;
}

export const javaScriptThreadNames = new Set([
    "com.facebook.react.JavaScript",
    "com.facebook.react.runtime.JavaScript",
    "mqt_js",
    "mqt_v_js",
]);

export function currentPlatform(): Platform {
    return (Process.platform === "darwin") ? new ApplePlatform() : new GenericPlatform();
}

class ApplePlatform implements Platform {
    readonly wakes = true;
    readonly knowsLoadedModules = true;
    readonly #waker = new RunLoopWaker();
    readonly #modules = new ObjCModuleRegistry();

    wake(thread: ThreadId, task: () => void): boolean {
        return this.#waker.wake(thread, task);
    }

    nativeModules(): NativeModuleInfo[] {
        return this.#modules.list();
    }

    loadedModuleNames(): Set<string> {
        return this.#modules.loadedNames();
    }

    bridgeTable(): BridgeTable | null {
        return this.#modules.bridgeTable();
    }

    dispose(): void {
        this.#waker.dispose();
    }
}

class GenericPlatform implements Platform {
    readonly wakes = false;
    readonly knowsLoadedModules = false;

    wake(): boolean {
        return false;
    }

    nativeModules(): NativeModuleInfo[] {
        return [];
    }

    loadedModuleNames(): Set<string> {
        return new Set();
    }

    bridgeTable(): BridgeTable | null {
        return null;
    }

    dispose(): void {
    }
}
