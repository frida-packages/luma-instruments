import Electron, { type JsRef } from "frida-electron-bridge";
import { installShim } from "./target-shim.js";
import { encodeTargetValue } from "./target-values.js";

export interface IpcRecord {
    seq: number;
    time: number;
    kind: string;
    direction: "in" | "out";
    channel: string;
    contents: number | null;
    frame: number[] | null;
    args: any;
    ports: number;
    pending: boolean;
}

export interface IpcOutcome {
    seq: number;
    ok: boolean;
    value?: any;
    error?: string;
    duration: number;
}

export interface ContentsSnapshot {
    id: number;
    unreadable?: true;
    type: string;
    url: string;
    title: string;
    pid: number;
    loading: boolean;
    crashed: boolean;
    unresponsive: boolean;
    goneReason: string | null;
    devTools: boolean;
    window: { id: number; title: string; visible: boolean } | null;
    host: number | null;
    preferences: any;
    preload: string | null;
    sessionPreloads: string[];
    windowOpenHandler: boolean;
    navigationListeners: number;
    session: string;
}

export interface Drained {
    messages: IpcRecord[];
    settled: IpcOutcome[];
    evaluations: Array<Evaluation & { id: number }>;
    gone: Array<{ id: number }>;
    dropped: number;
    faults: string[];
    contents: ContentsSnapshot[] | null;
}

export interface Evaluation {
    ok: boolean;
    value?: any;
    error?: string;
    note?: string;
}

export interface CaptureOptions {
    capture: boolean;
    channels: string | null;
    maxChars: number;
    ratePerSecond: number;
}

export interface LinkObserver {
    onDrained(drained: Drained): void;
    onLinkFailed(error: Error): void;
}

export type RuntimeFacts = { [key: string]: any };

const DRAIN_INTERVAL_MS = 250;
const shimModules = ["electron", "vm", "path", "fs", "module"];
const DRAINS_PER_CONTENTS_SNAPSHOT = 4;

export class RuntimeLink {
    readonly #observer: LinkObserver;
    readonly #pendingEvaluations = new Map<number, (evaluation: Evaluation) => void>();
    #shim: JsRef | null = null;
    #timer: ReturnType<typeof setTimeout> | null = null;
    #draining = false;
    #disposed = false;
    #drains = 0;
    #nextEvaluation = 1;

    static get supported(): boolean {
        return Electron.available;
    }

    static get hasNodeEnvironment(): boolean {
        return Electron.hasNodeEnvironment;
    }

    constructor(observer: LinkObserver) {
        this.#observer = observer;
    }

    async connect(options: CaptureOptions): Promise<RuntimeFacts> {
        const facts = await Electron.perform(realm => {
            const install = realm.evaluate(`(${installShim})`);
            const modules = Object.fromEntries(shimModules.map(name => [name, realm.require(name)]));
            const shim = realm.persist(install(modules, realm.evaluate(`(${encodeTargetValue})`), String(encodeTargetValue)));
            if (this.#disposed) {
                shim.wrap().uninstall();
                shim.free();
                return null;
            }
            this.#shim = shim;
            shim.wrap().configure(JSON.stringify(options));
            return JSON.parse(realm.toJs(shim.wrap().facts()));
        });
        if (facts === null) {
            throw new Error("disposed while connecting");
        }
        this.#schedule(DRAIN_INTERVAL_MS);
        return facts;
    }

    get connected(): boolean {
        return this.#shim !== null;
    }

    configure(options: CaptureOptions): Promise<void> {
        return this.#withShim(shim => {
            shim.configure(JSON.stringify(options));
        });
    }

    evaluate(source: string): Promise<Evaluation> {
        return this.#awaitEvaluation(id => this.#withShim(shim => {
            shim.evaluate(id, source);
        }));
    }

    evaluateIn(contentsId: number, world: "page" | "preload", source: string): Promise<Evaluation> {
        return this.#awaitEvaluation(id => this.#withShim(shim => {
            shim.evaluateIn(id, contentsId, world, source);
        }));
    }

    async openDevTools(contentsId: number): Promise<Evaluation> {
        return JSON.parse(await this.#withShim((shim, realm) => realm.toJs(shim.openDevTools(contentsId))));
    }

    async dispose(): Promise<void> {
        this.#disposed = true;
        if (this.#timer !== null) {
            clearTimeout(this.#timer);
            this.#timer = null;
        }
        for (const resolve of this.#pendingEvaluations.values()) {
            resolve({ ok: false, error: "the instrument was unloaded" });
        }
        this.#pendingEvaluations.clear();
        const shim = this.#shim;
        if (shim === null) {
            return;
        }
        this.#shim = null;
        await Electron.perform(() => {
            shim.wrap().uninstall();
            shim.free();
        });
        await Electron.dispose();
    }

    #awaitEvaluation(start: (id: number) => Promise<void>): Promise<Evaluation> {
        const id = this.#nextEvaluation++;
        const settled = new Promise<Evaluation>(resolve => this.#pendingEvaluations.set(id, resolve));
        return start(id).then(() => {
            this.#schedule(0);
            return settled;
        }, error => {
            this.#pendingEvaluations.delete(id);
            throw error;
        });
    }

    #withShim<T>(operation: (shim: any, realm: any) => T): Promise<T> {
        const shim = this.#shim;
        if (shim === null) {
            return Promise.reject(new Error("JavaScript in this process is not reachable yet"));
        }
        return Electron.perform(realm => operation(shim.wrap(), realm));
    }

    #schedule(delay: number): void {
        if (this.#disposed || this.#draining) {
            return;
        }
        if (this.#timer !== null) {
            clearTimeout(this.#timer);
        }
        this.#timer = setTimeout(() => this.#drain(), delay);
    }

    #drain(): void {
        this.#timer = null;
        this.#draining = true;
        const withContents = (this.#drains++ % DRAINS_PER_CONTENTS_SNAPSHOT) === 0;
        this.#withShim((shim, realm) => realm.toJs(shim.drain(withContents)) as string)
            .then(json => {
                this.#draining = false;
                if (this.#disposed) {
                    return;
                }
                this.#deliver(JSON.parse(json));
                this.#schedule(DRAIN_INTERVAL_MS);
            }, error => {
                this.#draining = false;
                if (!this.#disposed) {
                    this.#observer.onLinkFailed(error);
                }
            });
    }

    #deliver(drained: Drained): void {
        for (const { id, ...evaluation } of drained.evaluations) {
            const resolve = this.#pendingEvaluations.get(id);
            this.#pendingEvaluations.delete(id);
            resolve?.(evaluation);
        }
        this.#observer.onDrained(drained);
    }
}
