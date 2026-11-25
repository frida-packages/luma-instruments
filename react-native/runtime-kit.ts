export interface KitOptions {
    key: string;
    version: number;
    depth: number;
    entries: number;
    stringLength: number;
    recordBytes: number;
    recordsKept: number;
}

export interface KitReply {
    kind: "value" | "error" | "pending" | "missing";
    value?: unknown;
    error?: string;
    printed?: string[];
    id?: number;
}

export interface RuntimeFacts {
    isReactNative: boolean;
    bridge: boolean;
    bridgeless: boolean;
    turboModules: boolean;
    fabric: boolean;
    dev: boolean | null;
    hermes: Record<string, unknown> | null;
    reactNative: { major: number; minor: number; patch: number; prerelease?: string | null } | null;
    bundleURL: string | null;
    globals: number;
}

export type TrafficDirection = "to native" | "to JS" | "event";

export interface TrafficRecord {
    seq: number;
    time: number;
    direction: TrafficDirection;
    module: string;
    method: string;
    args: string;
}

export interface TrafficUpdate {
    seq: number;
    status: "returned" | "resolved" | "rejected" | "called back" | "threw";
    result: string;
    ms: number;
}

export interface Settlement {
    id: number;
    kind: "value" | "error";
    value?: unknown;
    error?: string;
}

export interface Drained {
    records: TrafficRecord[];
    updates: TrafficUpdate[];
    settled: Settlement[];
    dropped: number;
    watched: number;
}

export interface WatchReply {
    modules: number;
    methods: number;
    bridge: boolean;
    events: boolean;
}

export type KitMethod = "evaluate" | "facts" | "watch" | "drain" | "uninstall";

export function kitInstallation(options: KitOptions): string {
    return guarded(`return (${installKit.toString()})(${asciiJson(options)});`);
}

export function kitCall(key: string, method: KitMethod, args: unknown[]): string {
    const kit = `globalThis[${asciiJson(key)}]`;
    const missing = asciiJson(JSON.stringify({ kind: "missing", error: "the kit is not installed in this runtime" }));
    return guarded(`if (typeof ${kit} !== 'object') { return ${missing}; } return ${kit}.${method}(${args.map(asciiJson).join(", ")});`);
}

function guarded(body: string): string {
    return `(function () { try { ${body} } catch (e) { return JSON.stringify({ kind: 'error', error: String(e) }); } })()`;
}

function asciiJson(value: unknown): string {
    return JSON.stringify(value).replace(/[\u007f-￿]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function installKit(options: KitOptions): string {
    const g = globalThis as unknown as Record<string, any>;
    if (typeof g[options.key] === "object") {
        return JSON.stringify({ kind: "value", value: { installed: false } });
    }
    let records: TrafficRecord[] = [];
    let updates: TrafficUpdate[] = [];
    let settled: Settlement[] = [];
    let dropped = 0;
    let sequence = 0;
    let pendingId = 0;
    let current: { module: string; method: string } | null = null;
    let undo: (() => void)[] = [];
    const startedAt: Record<number, number> = {};
    const learnedModules: Record<number, string> = {};
    const learnedMethods: Record<string, string> = {};
    const kit = { evaluate, facts, watch, drain, uninstall };
    Object.defineProperty(g, options.key, { value: kit, configurable: true, enumerable: false, writable: false });
    return JSON.stringify({ kind: "value", value: { installed: true } });

    function evaluate(source: string): string {
        const printed: string[] = [];
        const restore = capturePrinting(printed);
        let reply: KitReply;
        try {
            const value = (0, eval)(source);
            reply = isThenable(value) ? awaitLater(value) : { kind: "value", value: describe(value, options.depth, []) };
        } catch (e) {
            reply = { kind: "error", error: describeError(e) };
        } finally {
            restore();
        }
        reply.printed = printed;
        return JSON.stringify(reply);
    }

    function facts(loaded: string[] | null): string {
        const reachable = (name: string) => loaded === null || loaded.indexOf(name) !== -1;
        const hermes = g.HermesInternal;
        const proxy = g.nativeModuleProxy;
        const reply: RuntimeFacts = {
            isReactNative: typeof g.__fbBatchedBridge === "object" || g.RN$Bridgeless === true || (proxy !== undefined && proxy !== null),
            bridge: typeof g.__fbBatchedBridge === "object" && g.__fbBatchedBridge !== null,
            bridgeless: g.RN$Bridgeless === true,
            turboModules: typeof g.__turboModuleProxy === "function" || g.RN$Bridgeless === true,
            fabric: g.nativeFabricUIManager !== undefined && g.nativeFabricUIManager !== null,
            dev: (typeof g.__DEV__ === "boolean") ? g.__DEV__ : null,
            hermes: (typeof hermes === "object" && hermes !== null && typeof hermes.getRuntimeProperties === "function")
                ? hermes.getRuntimeProperties() : null,
            reactNative: reachable("PlatformConstants")
                ? attempt(() => constantsOf("PlatformConstants").reactNativeVersion, null) : null,
            bundleURL: bundleURL(reachable("SourceCode")),
            globals: Object.getOwnPropertyNames(g).length,
        };
        return JSON.stringify({ kind: "value", value: reply });
    }

    function watch(names: string[], table: { modules: (string | null)[]; methods: string[][] } | null, enabled: boolean): string {
        unwatchAll();
        if (!enabled) {
            return JSON.stringify({ kind: "value", value: { modules: 0, methods: 0, bridge: false, events: false } });
        }
        const bridge = g.__fbBatchedBridge;
        const watchesBridge = typeof bridge === "object" && bridge !== null;
        if (watchesBridge) {
            watchBridge(bridge);
        }
        const events = !watchesBridge && watchDeviceEvents();
        if (table !== null) {
            table.modules.forEach((module, moduleID) => {
                if (module !== null) {
                    learnedModules[moduleID] = module;
                }
                table.methods[moduleID].forEach((method, methodID) => {
                    learnedMethods[`${moduleID}.${methodID}`] = method;
                });
            });
        }
        let modules = 0;
        let methods = 0;
        for (const name of names) {
            const wrapped = watchModule(name);
            if (wrapped !== 0) {
                modules++;
                methods += wrapped;
            }
        }
        const reply: WatchReply = { modules, methods, bridge: watchesBridge, events };
        return JSON.stringify({ kind: "value", value: reply });
    }

    function drain(): string {
        const reply: Drained = { records, updates, settled, dropped, watched: undo.length };
        records = [];
        updates = [];
        settled = [];
        dropped = 0;
        return JSON.stringify({ kind: "value", value: reply });
    }

    function uninstall(): string {
        unwatchAll();
        delete g[options.key];
        return JSON.stringify({ kind: "value", value: true });
    }

    function capturePrinting(printed: string[]): () => void {
        const hadConsole = typeof g.console === "object" && g.console !== null;
        const console = hadConsole ? g.console : {};
        const levels = ["log", "info", "warn", "error", "debug"];
        const originals = levels.map(level => console[level]);
        levels.forEach(level => {
            console[level] = function () {
                printed.push(Array.prototype.map.call(arguments, (part: unknown) =>
                    (typeof part === "string") ? part : JSON.stringify(describe(part, 1, []))).join(" "));
            };
        });
        if (!hadConsole) {
            g.console = console;
        }
        return () => {
            if (!hadConsole) {
                delete g.console;
                return;
            }
            levels.forEach((level, index) => {
                console[level] = originals[index];
            });
        };
    }

    function awaitLater(promise: PromiseLike<unknown>): KitReply {
        const id = ++pendingId;
        promise.then(
            value => settled.push({ id, kind: "value", value: describe(value, options.depth, []) }),
            error => settled.push({ id, kind: "error", error: describeError(error) }));
        return { kind: "pending", id };
    }

    function constantsOf(name: string): Record<string, any> {
        const module = moduleNamed(name);
        return module.getConstants();
    }

    function bundleURL(askSourceCode: boolean): string | null {
        const scriptURL = askSourceCode ? attempt(() => constantsOf("SourceCode").scriptURL, null) : null;
        if (typeof scriptURL === "string" && scriptURL.length !== 0) {
            return scriptURL;
        }
        const location = attempt(() => g.HermesInternal.getFunctionLocation(g.__r), null);
        return (location !== null && typeof location.fileName === "string") ? location.fileName : null;
    }

    function moduleNamed(name: string): any {
        const proxy = g.nativeModuleProxy;
        const fromProxy = (proxy !== undefined && proxy !== null) ? proxy[name] : null;
        if (fromProxy !== undefined && fromProxy !== null) {
            return fromProxy;
        }
        return (typeof g.__turboModuleProxy === "function") ? g.__turboModuleProxy(name) : null;
    }

    function watchBridge(bridge: Record<string, any>): void {
        replace(bridge, "enqueueNativeCall", original => function (this: unknown, moduleID: number, methodID: number,
            params: unknown[], onFail: unknown, onSuccess: unknown) {
            if (current !== null) {
                learnedModules[moduleID] = current.module;
                learnedMethods[`${moduleID}.${methodID}`] = current.method;
                return original.apply(this, arguments as unknown as unknown[]);
            }
            const seq = begin("to native", moduleNameOf(bridge, moduleID), methodNameOf(bridge, moduleID, methodID), params);
            const callbacks = [onFail, onSuccess].map(callback =>
                (typeof callback === "function") ? settleThrough(callback as (...args: unknown[]) => unknown, seq) : callback);
            if (typeof onFail !== "function" && typeof onSuccess !== "function") {
                finish(seq, "returned", undefined);
            }
            return original.call(this, moduleID, methodID, params, callbacks[0], callbacks[1]);
        });
        if (typeof bridge.callNativeSyncHook === "function") {
            replace(bridge, "callNativeSyncHook", original => function (this: unknown, moduleID: number, methodID: number,
                params: unknown[]) {
                if (current !== null) {
                    learnedModules[moduleID] = current.module;
                    learnedMethods[`${moduleID}.${methodID}`] = current.method;
                    return original.apply(this, arguments as unknown as unknown[]);
                }
                const seq = begin("to native", moduleNameOf(bridge, moduleID), methodNameOf(bridge, moduleID, methodID), params);
                return finishReturning(seq, () => original.apply(this, arguments as unknown as unknown[]));
            });
        }
        replace(bridge, "__callFunction", original => function (this: unknown, module: string, method: string, args: unknown[]) {
            const seq = begin("to JS", module, method, args);
            return finishReturning(seq, () => original.apply(this, arguments as unknown as unknown[]));
        });
    }

    function watchDeviceEvents(): boolean {
        const emitter = g.__rctDeviceEventEmitter;
        if (typeof emitter !== "object" || emitter === null || typeof emitter.emit !== "function") {
            return false;
        }
        replace(emitter, "emit", original => function (this: unknown, eventName: string) {
            const seq = begin("event", "RCTDeviceEventEmitter", String(eventName), Array.prototype.slice.call(arguments, 1));
            return finishReturning(seq, () => original.apply(this, arguments as unknown as unknown[]));
        });
        return true;
    }

    function watchModule(name: string): number {
        const module = attempt(() => moduleNamed(name), null);
        if (typeof module !== "object" || module === null) {
            return 0;
        }
        let wrapped = 0;
        for (const method of methodNamesOf(module)) {
            if (attempt(() => typeof module[method] === "function", false)
                    && replace(module, method, original => moduleMethodWrapper(name, method, original))) {
                wrapped++;
            }
        }
        return wrapped;
    }

    function methodNamesOf(module: Record<string, any>): string[] {
        const own = attempt(() => Object.getOwnPropertyNames(module), []);
        const prototype = attempt(() => Object.getPrototypeOf(module), null);
        const inherited = (prototype !== null && prototype !== Object.prototype)
            ? attempt(() => Object.getOwnPropertyNames(prototype), []) : [];
        return own.concat(inherited).filter((method, index, all) => all.indexOf(method) === index && method !== "constructor");
    }

    function moduleMethodWrapper(module: string, method: string, original: (...args: unknown[]) => unknown) {
        return function (this: unknown) {
            const args = Array.prototype.slice.call(arguments);
            const seq = begin("to native", module, method, args);
            const hasCallbacks = args.some(arg => typeof arg === "function");
            const passed = args.map(arg => (typeof arg === "function") ? settleThrough(arg, seq) : arg);
            const outer = current;
            current = { module, method };
            let result: unknown;
            try {
                result = original.apply(this, passed);
            } catch (e) {
                finish(seq, "threw", e);
                throw e;
            } finally {
                current = outer;
            }
            if (isThenable(result)) {
                result.then(value => finish(seq, "resolved", value), error => finish(seq, "rejected", error));
            } else if (!hasCallbacks) {
                finish(seq, "returned", result);
            }
            return result;
        };
    }

    function replace(target: Record<string, any>, name: string,
        wrap: (original: (...args: any[]) => any) => (...args: any[]) => any): boolean {
        const hadOwn = Object.prototype.hasOwnProperty.call(target, name);
        const original = target[name];
        try {
            target[name] = wrap(original);
        } catch (e) {
            return false;
        }
        undo.push(() => {
            if (hadOwn) {
                target[name] = original;
            } else {
                delete target[name];
            }
        });
        return true;
    }

    function unwatchAll(): void {
        for (const step of undo.reverse()) {
            attempt(step, undefined);
        }
        undo = [];
    }

    function settleThrough(callback: (...args: unknown[]) => unknown, seq: number) {
        return function (this: unknown) {
            finish(seq, "called back", Array.prototype.slice.call(arguments));
            return callback.apply(this, arguments as unknown as unknown[]);
        };
    }

    function finishReturning(seq: number, call: () => unknown): unknown {
        let result: unknown;
        try {
            result = call();
        } catch (e) {
            finish(seq, "threw", e);
            throw e;
        }
        finish(seq, "returned", result);
        return result;
    }

    function begin(direction: TrafficDirection, module: string, method: string, args: unknown): number {
        const seq = ++sequence;
        startedAt[seq] = Date.now();
        records.push({ seq, time: startedAt[seq], direction, module, method, args: encoded(args) });
        if (records.length > options.recordsKept) {
            records.shift();
            dropped++;
        }
        return seq;
    }

    function finish(seq: number, status: TrafficUpdate["status"], result: unknown): void {
        const begun = startedAt[seq];
        delete startedAt[seq];
        updates.push({ seq, status, result: encoded(result), ms: (begun !== undefined) ? Date.now() - begun : 0 });
        if (updates.length > options.recordsKept) {
            updates.shift();
        }
    }

    function moduleNameOf(bridge: Record<string, any>, moduleID: number): string {
        const table = bridge._remoteModuleTable;
        const name = (table !== undefined && table !== null) ? table[moduleID] : undefined;
        return (typeof name === "string") ? name : (learnedModules[moduleID] ?? `#${moduleID}`);
    }

    function methodNameOf(bridge: Record<string, any>, moduleID: number, methodID: number): string {
        const table = bridge._remoteMethodTable;
        const methods = (table !== undefined && table !== null) ? table[moduleID] : undefined;
        const name = (methods !== undefined && methods !== null) ? methods[methodID] : undefined;
        return (typeof name === "string") ? name : (learnedMethods[`${moduleID}.${methodID}`] ?? `#${methodID}`);
    }

    function encoded(value: unknown): string {
        const text = attempt(() => JSON.stringify(describe(value, options.depth, [])), "[unreadable]");
        const shown = (text === undefined) ? "undefined" : text;
        return (shown.length > options.recordBytes) ? `${shown.slice(0, options.recordBytes)}...` : shown;
    }

    function describe(value: unknown, depth: number, seen: unknown[]): unknown {
        switch (typeof value) {
            case "undefined":
                return "[undefined]";
            case "string":
                return (value.length > options.stringLength) ? `${value.slice(0, options.stringLength)}...` : value;
            case "number":
                return isFinite(value) ? value : String(value);
            case "boolean":
                return value;
            case "bigint":
                return `${value}n`;
            case "symbol":
                return `[${String(value)}]`;
            case "function":
                return `[Function ${value.name || "anonymous"}]`;
        }
        if (value === null) {
            return null;
        }
        if (seen.indexOf(value) !== -1) {
            return "[Circular]";
        }
        if (value instanceof Error) {
            return { name: value.name, message: value.message, stack: value.stack };
        }
        if (value instanceof Date) {
            return attempt(() => value.toISOString(), "[Date]");
        }
        if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
            return `[${Object.prototype.toString.call(value).slice(8, -1)} ${(value as ArrayBuffer).byteLength} bytes]`;
        }
        if (Array.isArray(value)) {
            return (depth <= 0) ? `[Array(${value.length})]` : describeArray(value, depth, seen.concat([value]));
        }
        return (depth <= 0) ? "[Object]" : describeObject(value as Record<string, unknown>, depth, seen.concat([value]));
    }

    function describeArray(array: unknown[], depth: number, seen: unknown[]): unknown[] {
        const shown = array.slice(0, options.entries).map(item => describe(item, depth - 1, seen));
        if (array.length > options.entries) {
            shown.push(`[+${array.length - options.entries} more]`);
        }
        return shown;
    }

    function describeObject(object: Record<string, unknown>, depth: number, seen: unknown[]): unknown {
        const keys = attempt(() => Object.keys(object), null);
        if (keys === null) {
            return "[HostObject]";
        }
        const shown: Record<string, unknown> = {};
        for (const key of keys.slice(0, options.entries)) {
            shown[key] = attempt(() => describe(object[key], depth - 1, seen), "[unreadable]");
        }
        if (keys.length > options.entries) {
            shown["..."] = `${keys.length - options.entries} more`;
        }
        return shown;
    }

    function describeError(error: unknown): string {
        if (!(error instanceof Error)) {
            return attempt(() => String(error), "[unprintable error]");
        }
        const headline = `${error.name}: ${error.message}`;
        const stack = (typeof error.stack === "string") ? error.stack : "";
        return (stack.indexOf(error.message) !== -1) ? stack : (stack.length !== 0) ? `${headline}\n${stack}` : headline;
    }

    function isThenable(value: unknown): value is PromiseLike<unknown> {
        return typeof value === "object" && value !== null && typeof (value as PromiseLike<unknown>).then === "function";
    }

    function attempt<T>(step: () => T, fallback: T): T {
        try {
            return step();
        } catch (e) {
            return fallback;
        }
    }
}
