export function installShim(modules: any, encodeTargetValue: any, encoderSource: string): any {
    const host: any = globalThis;
    const key = Symbol.for("re.frida.luma.electron");
    host[key]?.uninstall();

    const process = host.process;
    const { electron, vm, path, fs, module } = modules;
    const mode = (process.type === "browser") ? "main" : "realm";
    const isolatedWorldId = 999;
    const outboxLimit = 2000;
    const options = { capture: true, channels: null as RegExp | null, maxChars: 4096, consoleChars: 65536, ratePerSecond: 200 };
    const outbox = { messages: [] as any[], settled: [] as any[], evaluations: [] as any[], gone: [] as any[], dropped: 0, faults: [] as string[] };
    const undo: Array<() => void> = [];
    const tappedContents = new WeakSet<any>();
    const tappedMaps = new WeakSet<any>();
    const originalHandlers = new WeakMap<any, any>();
    const syncEvents = new WeakSet<any>();
    const contentsStates = new Map<number, any>();
    const rate = { windowStart: 0, count: 0 };
    let active = true;
    let sequence = 0;
    let outgoingDepth = 0;
    const evaluator = makeEvaluator();

    if (mode === "main") {
        tapIncoming();
        tapOutgoing();
        tapAllContents();
    }

    const shim = { mode, configure, drain, evaluate, evaluateIn, openDevTools, facts, uninstall };
    Object.defineProperty(host, key, { value: shim, configurable: true });
    return shim;

    function makeEvaluator(): any {
        const names = ["require", "electron"];
        const values = [appRequire(), electron];
        if (mode === "main") {
            for (const name of ["app", "BrowserWindow", "webContents", "webFrameMain", "ipcMain", "session", "protocol", "dialog", "shell"]) {
                names.push(name);
                values.push(electron[name]);
            }
        }
        const factory = vm.runInThisContext(
            `(function (${names.join(", ")}) { let _; return { run(source) { return eval(source); }, keep(value) { _ = value; } }; })`,
            { filename: "luma-console" });
        const scope = factory(...values);
        return {
            run: (source: string) => scope.run(objectLiteralAware(source)),
            keep: (value: any) => scope.keep(value),
        };
    }

    function tapIncoming(): void {
        const { ipcMain } = electron;
        patchValue(ipcMain, "emit", (original: any) => function (this: any, channel: any, event: any, ...args: any[]) {
            if (typeof channel === "string" && isFrameEvent(event) && !syncEvents.has(event)) {
                const ports = Array.isArray(event.ports) ? event.ports.length : 0;
                observe({ kind: (ports !== 0) ? "postMessage" : "send", direction: "in", channel, event, args, ports });
            }
            return original.apply(this, arguments);
        });
        tapHandlers(ipcMain);
    }

    function tapOutgoing(): void {
        const { WebContents } = process._linkedBinding("electron_browser_web_contents");
        const { WebFrameMain } = process._linkedBinding("electron_browser_web_frame_main");
        tapSender(WebContents.prototype, "send", "webContents.send", (self, args) => ({ contents: self.id, channel: args[0], args: args.slice(1) }));
        tapSender(WebContents.prototype, "sendToFrame", "sendToFrame", (self, args) => ({ contents: self.id, frame: args[0], channel: args[1], args: args.slice(2) }));
        tapSender(WebContents.prototype, "postMessage", "webContents.postMessage", (self, args) => ({ contents: self.id, channel: args[0], args: [args[1]], ports: args[2]?.length ?? 0 }));
        tapSender(WebFrameMain.prototype, "send", "frame.send", (self, args) => ({ ...frameTarget(self), channel: args[0], args: args.slice(1) }));
        tapSender(WebFrameMain.prototype, "postMessage", "frame.postMessage", (self, args) => ({ ...frameTarget(self), channel: args[0], args: [args[1]], ports: args[2]?.length ?? 0 }));
    }

    function tapAllContents(): void {
        for (const contents of electron.webContents.getAllWebContents()) {
            if (!tappedContents.has(contents)) {
                tapContents(contents);
            }
            tapFrames(contents);
        }
    }

    function configure(json: string): void {
        const next = JSON.parse(json);
        options.capture = next.capture;
        options.channels = (next.channels !== null) ? new RegExp(next.channels) : null;
        options.maxChars = next.maxChars;
        options.ratePerSecond = next.ratePerSecond;
    }

    function drain(withContents: boolean): string {
        if (mode === "main") {
            tapAllContents();
        }
        const drained = {
            messages: outbox.messages,
            settled: outbox.settled,
            evaluations: outbox.evaluations,
            gone: outbox.gone,
            dropped: outbox.dropped,
            faults: outbox.faults,
            contents: (withContents && mode === "main") ? electron.webContents.getAllWebContents().map(describeReadably) : null,
        };
        outbox.messages = [];
        outbox.settled = [];
        outbox.evaluations = [];
        outbox.gone = [];
        outbox.dropped = 0;
        outbox.faults = [];
        return JSON.stringify(drained);
    }

    function evaluate(id: number, source: string): void {
        let value;
        try {
            value = evaluator.run(source);
        } catch (e) {
            reportFailure(id, e);
            return;
        }
        if (isThenable(value)) {
            value.then((settled: any) => reportEvaluation(id, settled), (e: any) => reportFailure(id, e));
        } else {
            reportEvaluation(id, value);
        }
    }

    function evaluateIn(id: number, contentsId: number, world: string, source: string): void {
        const contents = electron.webContents.fromId(contentsId);
        if (contents === undefined || contents === null || contents.isDestroyed()) {
            outbox.evaluations.push({ id, ok: false, error: `web contents #${contentsId} is gone` });
            return;
        }
        const code = pageEvaluation(source);
        const running = (world === "preload")
            ? contents.executeJavaScriptInIsolatedWorld(isolatedWorldId, [{ code }])
            : contents.executeJavaScript(code);
        running.then((json: string) => {
            const outcome = JSON.parse(json);
            if (outcome.blockedEval) {
                evaluateWithoutEval(id, contents, source);
            } else {
                outbox.evaluations.push({ id, ...outcome });
            }
        }, (e: any) => {
            outbox.evaluations.push({ id, ok: false, error: describeError(e) });
        });
    }

    function openDevTools(contentsId: number): string {
        const contents = electron.webContents.fromId(contentsId);
        if (contents === undefined || contents === null || contents.isDestroyed()) {
            return JSON.stringify({ ok: false, error: `web contents #${contentsId} is gone` });
        }
        contents.openDevTools({ mode: "detach", activate: false });
        return JSON.stringify({ ok: true });
    }

    function facts(): string {
        return JSON.stringify((mode === "main") ? mainFacts() : realmFacts());
    }

    function uninstall(): void {
        active = false;
        for (const step of undo.reverse()) {
            step();
        }
        undo.length = 0;
        delete host[key];
    }

    function appRequire(): any {
        if (mode !== "main") {
            return (typeof host.require === "function") ? host.require : module.createRequire(process.execPath);
        }
        const entry = appEntryModule();
        if (entry !== null) {
            return entry.require.bind(entry);
        }
        return module.createRequire(path.join(electron.app.getAppPath(), "package.json"));
    }

    function appEntryModule(): any {
        const entry = process.mainModule;
        return (entry !== undefined && path.isAbsolute(entry.filename)) ? entry : null;
    }

    function objectLiteralAware(source: string): string {
        const trimmed = source.trim();
        return (trimmed.startsWith("{") && trimmed.endsWith("}")) ? `(${trimmed})` : source;
    }

    function tapHandlers(ipc: any): void {
        const handlers = ipc._invokeHandlers;
        if (!(handlers instanceof Map) || tappedMaps.has(handlers)) {
            return;
        }
        tappedMaps.add(handlers);
        for (const [channel, handler] of handlers) {
            Map.prototype.set.call(handlers, channel, wrapHandler(channel, handler));
        }
        patchValue(handlers, "set", (original: any) => function (this: any, channel: any, handler: any) {
            return original.call(this, channel, (typeof handler === "function") ? wrapHandler(channel, handler) : handler);
        });
        undo.push(() => {
            for (const [channel, handler] of handlers) {
                if (originalHandlers.has(handler)) {
                    Map.prototype.set.call(handlers, channel, originalHandlers.get(handler));
                }
            }
        });
    }

    function wrapHandler(channel: string, handler: any): any {
        const wrapper = function (this: any, event: any, ...args: any[]) {
            const entry = observe({ kind: "invoke", direction: "in", channel, event, args, pending: true });
            let result;
            try {
                result = handler.apply(this, arguments);
            } catch (e) {
                settle(entry, false, e);
                throw e;
            }
            if (isThenable(result)) {
                result.then((value: any) => settle(entry, true, value), (e: any) => settle(entry, false, e));
            } else {
                settle(entry, true, result);
            }
            return result;
        };
        originalHandlers.set(wrapper, handler);
        return wrapper;
    }

    function tapSender(prototype: any, method: string, kind: string, describe: (self: any, args: any[]) => any): void {
        patchValue(prototype, method, (original: any) => function (this: any, ...args: any[]) {
            if (outgoingDepth === 0) {
                const self = this;
                observe(() => ({ kind, direction: "out", ...describe(self, args) }));
            }
            outgoingDepth++;
            try {
                return original.apply(this, args);
            } finally {
                outgoingDepth--;
            }
        });
    }

    function frameTarget(frame: any): any {
        const contents = electron.webContents.fromFrame?.(frame);
        return { contents: contents?.id ?? null, frame: [frame.processId, frame.routingId] };
    }

    function tapContents(contents: any): void {
        tappedContents.add(contents);
        const id = contents.id;
        const state = { unresponsive: false, goneReason: null as string | null, exitCode: null as number | null };
        contentsStates.set(id, state);
        const listeners: Record<string, (...args: any[]) => void> = {
            "ipc-message-sync": (event: any, channel: string, ...args: any[]) => {
                syncEvents.add(event);
                const entry = observe({ kind: "sendSync", direction: "in", channel, event, args, pending: true });
                if (entry !== null) {
                    captureReturnValue(event, entry);
                }
            },
            "render-process-gone": (_event: any, details: any) => {
                state.goneReason = details.reason;
                state.exitCode = details.exitCode;
            },
            "unresponsive": () => {
                state.unresponsive = true;
            },
            "responsive": () => {
                state.unresponsive = false;
            },
            "did-start-loading": () => {
                state.goneReason = null;
            },
            "destroyed": () => {
                outbox.gone.push({ id });
                contentsStates.delete(id);
            },
        };
        for (const [name, listener] of Object.entries(listeners)) {
            contents.prependListener(name, listener);
        }
        undo.push(() => {
            for (const [name, listener] of Object.entries(listeners)) {
                contents.removeListener(name, listener);
            }
        });
        if (contents.ipc !== undefined) {
            tapHandlers(contents.ipc);
        }
    }

    function captureReturnValue(event: any, entry: any): void {
        const descriptor = Object.getOwnPropertyDescriptor(event, "returnValue");
        if (descriptor?.configurable) {
            Object.defineProperty(event, "returnValue", {
                configurable: true,
                enumerable: false,
                get: () => undefined,
                set: (value: any) => {
                    settle(entry, true, value);
                    event._replyChannel.sendReply(value);
                },
            });
            return;
        }
        const replyChannel = event._replyChannel;
        const sendReply = replyChannel.sendReply;
        replyChannel.sendReply = function (this: any, value: any) {
            settle(entry, true, value);
            return sendReply.apply(this, arguments);
        };
    }

    function tapFrames(contents: any): void {
        for (const frame of framesOf(contents)) {
            const ipc = Object.getOwnPropertyDescriptor(frame, "ipc")?.value;
            if (ipc !== undefined) {
                tapHandlers(ipc);
            }
        }
    }

    function framesOf(contents: any): any[] {
        if (contents.isDestroyed() || contents.isCrashed()) {
            return [];
        }
        try {
            return contents.mainFrame?.framesInSubtree ?? [];
        } catch (e) {
            return [];
        }
    }

    function describeReadably(contents: any): any {
        try {
            return describeContents(contents);
        } catch (e) {
            outbox.faults.push(describeError(e));
            return { id: contents.id, unreadable: true };
        }
    }

    function describeContents(contents: any): any {
        const state = contentsStates.get(contents.id);
        const window = electron.BrowserWindow.fromWebContents(contents);
        return {
            id: contents.id,
            type: contents.getType(),
            url: contents.getURL(),
            title: contents.getTitle(),
            pid: contents.getOSProcessId(),
            loading: contents.isLoading(),
            crashed: contents.isCrashed(),
            unresponsive: state?.unresponsive ?? false,
            goneReason: state?.goneReason ?? null,
            devTools: contents.isDevToolsOpened(),
            window: (window !== null && window !== undefined) ? { id: window.id, title: window.getTitle(), visible: window.isVisible() } : null,
            host: contents.hostWebContents?.id ?? null,
            preferences: encodeTargetValue(contents.getLastWebPreferences?.() ?? null, 3, 8192),
            preload: preloadOf(contents),
            sessionPreloads: sessionPreloadsOf(contents.session),
            windowOpenHandler: typeof contents._windowOpenHandler === "function",
            navigationListeners: contents.listenerCount("will-navigate") + contents.listenerCount("will-frame-navigate"),
            session: (contents.session === electron.session.defaultSession) ? "default" : (contents.session.storagePath ?? "in memory"),
        };
    }

    function preloadOf(contents: any): string | null {
        if (typeof contents._getPreloadScript === "function") {
            return contents._getPreloadScript()?.filePath ?? null;
        }
        const paths = contents._getPreloadPaths();
        return (paths.length !== 0) ? paths.join(", ") : null;
    }

    function sessionPreloadsOf(session: any): string[] {
        if (typeof session.getPreloadScripts === "function") {
            return session.getPreloadScripts().map((script: any) => `${script.filePath} (${script.type})`);
        }
        return session.getPreloads();
    }

    function reportEvaluation(id: number, value: any): void {
        evaluator.keep(value);
        outbox.evaluations.push({ id, ok: true, value: encodeTargetValue(value, 6, options.consoleChars) });
    }

    function reportFailure(id: number, error: any): void {
        const lines = describeError(error).split("\n");
        const internal = lines.findIndex(line => line.trim().startsWith("at Object.run (luma-console:"));
        outbox.evaluations.push({ id, ok: false, error: lines.slice(0, (internal !== -1) ? internal : lines.length).join("\n") });
    }

    function pageEvaluation(source: string): string {
        return `(async () => {
            const encode = ${encoderSource};
            let value;
            try {
                value = await (0, eval)(${JSON.stringify(objectLiteralAware(source))});
            } catch (e) {
                if (e instanceof EvalError) {
                    return JSON.stringify({ blockedEval: true });
                }
                return JSON.stringify({ ok: false, error: (e && e.stack) ? String(e.stack) : String(e) });
            }
            return JSON.stringify({ ok: true, value: encode(value, 6, ${options.consoleChars}) });
        })()`;
    }

    function evaluateWithoutEval(id: number, contents: any, source: string): void {
        contents.executeJavaScript(source).then((value: any) => {
            outbox.evaluations.push({ id, ok: true, value: encodeTargetValue(value, 6, options.consoleChars), note: "csp" });
        }, (e: any) => {
            outbox.evaluations.push({ id, ok: false, error: describeError(e), note: "csp" });
        });
    }

    function mainFacts(): any {
        const { app } = electron;
        return {
            mode,
            versions: process.versions,
            pid: process.pid,
            execPath: process.execPath,
            argv: process.argv,
            execArgv: process.execArgv,
            resourcesPath: process.resourcesPath,
            mas: process.mas === true,
            windowsStore: process.windowsStore === true,
            defaultApp: process.defaultApp === true,
            esmEntry: appEntryModule() === null,
            app: {
                name: app.getName(),
                version: app.getVersion(),
                path: app.getAppPath(),
                packaged: app.isPackaged,
                userData: app.getPath("userData"),
            },
            entry: entryScript(app.getAppPath()),
            switches: interestingSwitches(app.commandLine),
        };
    }

    function entryScript(appPath: string): string | null {
        const entry = appEntryModule();
        if (entry !== null) {
            return entry.filename;
        }
        const manifest = JSON.parse(fs.readFileSync(path.join(appPath, "package.json"), "utf8"));
        return path.join(appPath, manifest.main ?? "index.js");
    }

    function interestingSwitches(commandLine: any): Record<string, string> {
        const switches: Record<string, string> = {};
        for (const name of ["remote-debugging-port", "inspect", "inspect-brk", "js-flags", "no-sandbox", "disable-web-security",
            "ignore-certificate-errors", "proxy-server", "host-rules", "disable-site-isolation-trials", "enable-logging", "lang"]) {
            if (commandLine.hasSwitch(name)) {
                switches[name] = commandLine.getSwitchValue(name);
            }
        }
        return switches;
    }

    function realmFacts(): any {
        return {
            mode,
            versions: process.versions,
            pid: process.pid,
            processType: process.type,
            location: host.location?.href ?? null,
            title: host.document?.title ?? null,
            contextIsolated: process.contextIsolated ?? null,
            sandboxed: process.sandboxed === true,
        };
    }

    function observe(fields: any): any {
        if (!active || !options.capture) {
            return null;
        }
        try {
            const described = (typeof fields === "function") ? fields() : fields;
            if (typeof described.channel !== "string" || (options.channels !== null && !options.channels.test(described.channel))) {
                return null;
            }
            if (!takeToken()) {
                outbox.dropped++;
                return null;
            }
            const entry = {
                seq: ++sequence,
                time: Date.now(),
                kind: described.kind,
                direction: described.direction,
                channel: described.channel,
                contents: described.contents ?? described.event?.sender?.id ?? null,
                frame: described.frame ?? frameOfEvent(described.event),
                args: encodeTargetValue(described.args, 6, options.maxChars),
                ports: described.ports ?? 0,
                pending: described.pending ?? false,
            };
            enqueue(outbox.messages, entry);
            return entry;
        } catch (e) {
            outbox.faults.push(describeError(e));
            return null;
        }
    }

    function settle(entry: any, ok: boolean, value: any): void {
        if (entry === null || !active) {
            return;
        }
        try {
            const outcome = ok
                ? { seq: entry.seq, ok, value: encodeTargetValue(value, 6, options.maxChars) }
                : { seq: entry.seq, ok, error: describeError(value) };
            enqueue(outbox.settled, { ...outcome, duration: Date.now() - entry.time });
        } catch (e) {
            outbox.faults.push(describeError(e));
        }
    }

    function takeToken(): boolean {
        const now = Date.now();
        if (now - rate.windowStart >= 1000) {
            rate.windowStart = now;
            rate.count = 0;
        }
        if (rate.count >= options.ratePerSecond) {
            return false;
        }
        rate.count++;
        return true;
    }

    function enqueue(queue: any[], item: any): void {
        queue.push(item);
        if (queue.length > outboxLimit) {
            queue.shift();
            outbox.dropped++;
        }
    }

    function patchValue(target: any, name: string, makeReplacement: (original: any) => any): void {
        const own = Object.getOwnPropertyDescriptor(target, name);
        const original = target[name];
        Object.defineProperty(target, name, { configurable: true, writable: true, enumerable: own?.enumerable ?? false, value: makeReplacement(original) });
        undo.push(() => restore(target, name, own));
    }

    function restore(target: any, name: string, own: PropertyDescriptor | undefined): void {
        if (own !== undefined) {
            Object.defineProperty(target, name, own);
        } else {
            delete target[name];
        }
    }

    function isFrameEvent(event: any): boolean {
        return event !== null && typeof event === "object" && typeof event.sender === "object" && "frameId" in event;
    }

    function frameOfEvent(event: any): number[] | null {
        return (event !== undefined && typeof event.frameId === "number") ? [event.processId, event.frameId] : null;
    }

    function isThenable(value: any): boolean {
        return value !== null && (typeof value === "object" || typeof value === "function") && typeof value.then === "function";
    }

    function describeError(error: any): string {
        return (error !== null && typeof error === "object" && typeof error.stack === "string") ? error.stack : String(error);
    }
}
