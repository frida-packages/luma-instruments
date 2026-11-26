import type { Evaluation } from "./jsi-evaluator.js";
import type { Errand, Rendezvous, RendezvousObserver } from "./rendezvous.js";
import {
    type Drained,
    kitCall,
    kitInstallation,
    type KitMethod,
    type KitOptions,
    type KitReply,
    type RuntimeFacts,
    type Settlement,
    type WatchReply,
} from "./runtime-kit.js";
import type { Runtime, RuntimeRegistry } from "./runtimes.js";
import type { Settings } from "./settings.js";

export interface WatchPlan {
    moduleNames(): string[];
    loadedModuleNames(): string[] | null;
    bridgeTable(): unknown;
}

export interface SessionObserver {
    onTraffic(runtime: Runtime, drained: Drained): void;
    onSettled(runtime: Runtime, settlement: Settlement): void;
    onWatching(runtime: Runtime, reply: WatchReply | string): void;
}

const KIT_KEY = "__lumaReactNative";
const KIT_VERSION = 1;
const DRAIN_INTERVAL_MS = 400;
const VALUE_DEPTH = 4;
const VALUE_ENTRIES = 64;
const STRING_LENGTH = 4096;
const UNINSTALL_WAIT_MS = 1000;

export class RuntimeSessions implements RendezvousObserver {
    readonly #registry: RuntimeRegistry;
    readonly #rendezvous: Rendezvous;
    readonly #settings: Settings;
    readonly #plan: WatchPlan;
    readonly #observer: SessionObserver;
    readonly #watching = new Set<Runtime>();
    readonly #awaiting = new Map<Runtime, number>();
    readonly #draining = new Set<Runtime>();
    readonly #preparing = new Set<Runtime>();
    readonly #drainTimer = setInterval(() => this.#drainAll(), DRAIN_INTERVAL_MS);

    constructor(registry: RuntimeRegistry, rendezvous: Rendezvous, settings: Settings, plan: WatchPlan,
        observer: SessionObserver) {
        this.#registry = registry;
        this.#rendezvous = rendezvous;
        this.#settings = settings;
        this.#plan = plan;
        this.#observer = observer;
    }

    onOwnerLearned(runtime: Runtime): void {
        if (runtime.facts === null && !this.#preparing.has(runtime)) {
            this.#prepare(runtime);
        }
    }

    onRuntimeClosed(runtime: Runtime): void {
        this.#watching.delete(runtime);
        this.#awaiting.delete(runtime);
        this.#draining.delete(runtime);
    }

    evaluate(runtime: Runtime, source: string): Promise<KitReply> {
        return this.#ensureKit(runtime).then(() => this.#call(runtime, "evaluate", [source])).then(reply => {
            if (reply.kind === "pending") {
                this.#awaiting.set(runtime, (this.#awaiting.get(runtime) ?? 0) + 1);
            }
            return reply;
        });
    }

    applySettings(): void {
        for (const runtime of this.#registry.all) {
            if (runtime.kit === "ready" && runtime.presence !== "closed") {
                this.#watch(runtime);
            }
        }
    }

    async dispose(): Promise<void> {
        clearInterval(this.#drainTimer);
        const installed = this.#registry.all.filter(runtime => runtime.kit === "ready" && runtime.presence !== "closed");
        const uninstalls = installed.map(runtime => this.#call(runtime, "uninstall", []).catch(() => {}));
        await Promise.race([Promise.all(uninstalls), new Promise(resolve => setTimeout(resolve, UNINSTALL_WAIT_MS))]);
        this.#watching.clear();
    }

    #prepare(runtime: Runtime): void {
        const plan = this.#plan;
        this.#preparing.add(runtime);
        this.#ensureKit(runtime)
            .then(() => this.#callPrepared(runtime, "facts", () => [plan.loadedModuleNames()]))
            .then(reply => {
                runtime.facts = reply.value as RuntimeFacts;
                this.#registry.changed(runtime);
                this.#watch(runtime);
            })
            .catch(error => this.#fail(runtime, error))
            .finally(() => this.#preparing.delete(runtime));
    }

    #ensureKit(runtime: Runtime): Promise<void> {
        if (runtime.kit === "ready") {
            return Promise.resolve();
        }
        runtime.kit = "installing";
        const options: KitOptions = {
            key: KIT_KEY,
            version: KIT_VERSION,
            depth: VALUE_DEPTH,
            entries: VALUE_ENTRIES,
            stringLength: STRING_LENGTH,
            recordBytes: this.#settings.bytesPerCall,
            recordsKept: this.#settings.callsKept,
        };
        return this.#send(runtime, kitInstallation(options), false).then(() => {
            runtime.kit = "ready";
            runtime.failure = null;
            this.#registry.changed(runtime);
        }, error => {
            this.#fail(runtime, error);
            throw error;
        });
    }

    #watch(runtime: Runtime): void {
        if (!this.#settings.captureTraffic) {
            this.#watching.delete(runtime);
            this.#call(runtime, "watch", [[], null, false]).catch(() => {});
            return;
        }
        this.#watching.add(runtime);
        const plan = this.#plan;
        this.#callPrepared(runtime, "watch", () => [plan.moduleNames(), plan.bridgeTable(), true])
            .then(reply => this.#observer.onWatching(runtime, reply.value as WatchReply))
            .catch(error => this.#observer.onWatching(runtime, reasonOf(error)));
    }

    #drainAll(): void {
        for (const runtime of this.#registry.all) {
            const wanted = this.#watching.has(runtime) || (this.#awaiting.get(runtime) ?? 0) !== 0;
            if (wanted && runtime.kit === "ready" && runtime.presence !== "closed" && !this.#draining.has(runtime)) {
                this.#drain(runtime);
            }
        }
    }

    #drain(runtime: Runtime): void {
        this.#draining.add(runtime);
        this.#call(runtime, "drain", [])
            .then(reply => this.#deliver(runtime, reply.value as Drained))
            .catch(() => {})
            .finally(() => this.#draining.delete(runtime));
    }

    #deliver(runtime: Runtime, drained: Drained): void {
        for (const settlement of drained.settled) {
            this.#awaiting.set(runtime, Math.max(0, (this.#awaiting.get(runtime) ?? 1) - 1));
            this.#observer.onSettled(runtime, settlement);
        }
        if (drained.records.length !== 0 || drained.updates.length !== 0 || drained.dropped !== 0) {
            this.#observer.onTraffic(runtime, drained);
        }
    }

    #call(runtime: Runtime, method: KitMethod, args: unknown[]): Promise<KitReply> {
        return this.#callPrepared(runtime, method, () => args);
    }

    #callPrepared(runtime: Runtime, method: KitMethod, args: () => unknown[]): Promise<KitReply> {
        return this.#send(runtime, () => kitCall(KIT_KEY, method, args()), method === "evaluate").then(reply => {
            if (reply.kind === "missing") {
                runtime.kit = "absent";
                this.#registry.changed(runtime);
            }
            return reply;
        });
    }

    #send(runtime: Runtime, source: Errand["source"], asked: boolean): Promise<KitReply> {
        const errorsReject = !asked;
        return new Promise((resolve, reject) => {
            const errand: Errand = {
                source,
                asked,
                settle(evaluation: Evaluation) {
                    if (evaluation.kind === "refused") {
                        reject(new Error(evaluation.reason));
                        return;
                    }
                    const reply = JSON.parse(evaluation.text) as KitReply;
                    if (errorsReject && reply.kind === "error") {
                        reject(new Error(reply.error));
                        return;
                    }
                    resolve(reply);
                },
                abandon(reason: string) {
                    reject(new Error(reason));
                },
            };
            this.#rendezvous.send(runtime, errand);
        });
    }

    #fail(runtime: Runtime, error: unknown): void {
        runtime.kit = "failed";
        runtime.failure = reasonOf(error);
        this.#registry.changed(runtime);
    }
}

function reasonOf(error: unknown): string {
    return (error instanceof Error) ? error.message : String(error);
}
