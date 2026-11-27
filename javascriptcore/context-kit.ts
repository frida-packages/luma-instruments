export interface KitOptions {
    key: string;
    url: string;
    version: number;
    depth: number;
    entries: number;
    stringLength: number;
}

export interface KitReply {
    kind: "value" | "error" | "pending" | "missing";
    value?: unknown;
    error?: string;
    printed?: string[];
    id?: number;
}

export interface Settlement {
    id: number;
    kind: "value" | "error";
    value?: unknown;
    error?: string;
    printed: string[];
}

export interface ContextFacts {
    globalClass: string;
    location: string | null;
    title: string | null;
    userAgent: string | null;
    globals: number;
}

export type KitMethod = "evaluate" | "drain" | "facts" | "uninstall";

export function kitInstallation(options: KitOptions): string {
    return guarded(`return (${installKit.toString()})(${asciiJson(options)});`);
}

export function kitCall(key: string, method: KitMethod, args: unknown[]): string {
    const kit = `globalThis[${asciiJson(key)}]`;
    const missing = asciiJson(JSON.stringify({ kind: "missing", error: "the kit is not installed in this context" }));
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
    const installed = g[options.key];
    if (typeof installed === "object" && installed !== null && installed.version === options.version) {
        return JSON.stringify({ kind: "value", value: { installed: false } });
    }
    let settled: Settlement[] = [];
    let pendingId = 0;
    const kit = { version: options.version, evaluate, drain, facts, uninstall };
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

    function drain(): string {
        const reply = settled;
        settled = [];
        return JSON.stringify({ kind: "value", value: reply });
    }

    function facts(): string {
        const reply: ContextFacts = {
            globalClass: Object.prototype.toString.call(g),
            location: attempt(() => (typeof g.location === "object" && g.location !== null) ? String(g.location.href) : null, null),
            title: attempt(() => (typeof g.document === "object" && g.document !== null) ? String(g.document.title) : null, null),
            userAgent: attempt(() => (typeof g.navigator === "object" && g.navigator !== null) ? String(g.navigator.userAgent) : null, null),
            globals: Object.getOwnPropertyNames(g).length,
        };
        return JSON.stringify({ kind: "value", value: reply });
    }

    function uninstall(): string {
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
            value => settled.push({ id, kind: "value", value: describe(value, options.depth, []), printed: [] }),
            error => settled.push({ id, kind: "error", error: describeError(error), printed: [] }));
        return { kind: "pending", id };
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
            return `[${attempt(() => Object.prototype.toString.call(object).slice(8, -1), "Object")}]`;
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
        const stack = (typeof error.stack === "string") ? ownFrames(error.stack) : "";
        return (stack.indexOf(error.message) !== -1) ? stack : (stack.length !== 0) ? `${headline}\n${stack}` : headline;
    }

    function ownFrames(stack: string): string {
        const frames = stack.split("\n");
        const kitFrame = frames.findIndex(frame => frame.indexOf(options.url) !== -1);
        const own = (kitFrame === -1) ? frames : frames.slice(0, kitFrame);
        return ((own.length !== 0 && own[own.length - 1] === "eval@[native code]") ? own.slice(0, -1) : own).join("\n");
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
