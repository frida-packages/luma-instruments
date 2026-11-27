import { type ContextFacts, kitCall, kitInstallation, type KitMethod, type KitOptions, type KitReply, type Settlement } from "./context-kit.js";
import type { Context } from "./contexts.js";
import type { JscApi } from "./jsc-api.js";

export interface SessionObserver {
    onSettled(context: Context, settlement: Settlement): void;
    onBusyChanged(context: Context): void;
}

export const KIT_URL = "luma-javascriptcore://kit";

const KIT_OPTIONS: KitOptions = { key: "__lumaJavaScriptCore", url: KIT_URL, version: 1, depth: 4, entries: 64, stringLength: 4096 };
const DRAIN_INTERVAL_MS = 500;
const UNINSTALL_WAIT_MS = 1000;

export class ContextSessions {
    readonly #api: JscApi;
    readonly #observer: SessionObserver;
    readonly #installed = new Set<Context>();
    readonly #running = new Map<Context, number>();
    readonly #awaiting = new Map<Context, number>();
    readonly #draining = new Set<Context>();
    readonly #drainTimer = setInterval(() => this.#drainAll(), DRAIN_INTERVAL_MS);

    constructor(api: JscApi, observer: SessionObserver) {
        this.#api = api;
        this.#observer = observer;
    }

    evaluate(context: Context, source: string): Promise<KitReply> {
        return this.#tracked(context, "evaluate", [source]).then(reply => {
            if (reply.kind === "pending") {
                this.#adjust(this.#awaiting, context, 1);
            }
            return reply;
        });
    }

    facts(context: Context): Promise<ContextFacts | string> {
        return this.#tracked(context, "facts", []).then(reply => (reply.kind === "value") ? reply.value as ContextFacts : reply.error!);
    }

    running(context: Context): number {
        return this.#running.get(context) ?? 0;
    }

    awaiting(context: Context): number {
        return this.#awaiting.get(context) ?? 0;
    }

    async dispose(): Promise<void> {
        clearInterval(this.#drainTimer);
        const uninstalls = [...this.#installed].filter(context => !context.destroyed)
            .map(context => this.#call(context, "uninstall", []));
        await Promise.race([Promise.allSettled(uninstalls), new Promise(resolve => setTimeout(resolve, UNINSTALL_WAIT_MS))]);
    }

    #tracked(context: Context, method: KitMethod, args: unknown[]): Promise<KitReply> {
        this.#adjust(this.#running, context, 1);
        return this.#call(context, method, args).finally(() => this.#adjust(this.#running, context, -1));
    }

    #call(context: Context, method: KitMethod, args: unknown[]): Promise<KitReply> {
        return context.lane.run(() => this.#callOnLane(context, method, args));
    }

    #callOnLane(context: Context, method: KitMethod, args: unknown[]): KitReply {
        if (context.destroyed) {
            return { kind: "error", error: "this context was destroyed" };
        }
        if (!this.#installed.has(context)) {
            this.#evaluateOnLane(context, kitInstallation(KIT_OPTIONS));
            this.#installed.add(context);
        }
        const reply = this.#evaluateOnLane(context, kitCall(KIT_OPTIONS.key, method, args));
        if (reply.kind !== "missing") {
            return reply;
        }
        this.#evaluateOnLane(context, kitInstallation(KIT_OPTIONS));
        return this.#evaluateOnLane(context, kitCall(KIT_OPTIONS.key, method, args));
    }

    #evaluateOnLane(context: Context, source: string): KitReply {
        const evaluation = this.#api.evaluate(context.address, source, KIT_URL);
        return (evaluation.kind === "value") ? JSON.parse(evaluation.text) as KitReply : { kind: "error", error: evaluation.text };
    }

    #drainAll(): void {
        for (const context of this.#awaiting.keys()) {
            if (context.destroyed) {
                this.#awaiting.delete(context);
                this.#observer.onBusyChanged(context);
            } else if (!this.#draining.has(context)) {
                this.#drain(context);
            }
        }
    }

    #drain(context: Context): void {
        this.#draining.add(context);
        void this.#call(context, "drain", []).then(reply => {
            for (const settlement of (reply.kind === "value") ? reply.value as Settlement[] : []) {
                this.#adjust(this.#awaiting, context, -1);
                this.#observer.onSettled(context, settlement);
            }
        }).finally(() => this.#draining.delete(context));
    }

    #adjust(counts: Map<Context, number>, context: Context, by: number): void {
        const count = (counts.get(context) ?? 0) + by;
        if (count === 0) {
            counts.delete(context);
        } else {
            counts.set(context, count);
        }
        this.#observer.onBusyChanged(context);
    }
}
