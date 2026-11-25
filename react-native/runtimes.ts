import type { RuntimeFacts } from "./runtime-kit.js";
import type { RuntimeClass } from "./runtime-classes.js";
import { pointerKey } from "./runtime-instances.js";

export type Presence = "unseen" | "seen" | "closed";

export type Ownership = "seen" | "presumed";

export type KitState = "absent" | "installing" | "ready" | "failed";

export interface Runtime {
    readonly number: number;
    readonly address: NativePointer;
    readonly key: string;
    readonly runtimeClass: RuntimeClass;
    presence: Presence;
    owner: ThreadId | null;
    ownership: Ownership | null;
    ownerName: string | null;
    kit: KitState;
    failure: string | null;
    facts: RuntimeFacts | null;
}

export interface RuntimeObserver {
    onRuntimeAdded(runtime: Runtime): void;
    onRuntimeChanged(runtime: Runtime): void;
}

export class RuntimeRegistry {
    readonly #runtimes = new Map<string, Runtime>();
    readonly #observers: RuntimeObserver[] = [];
    #nextNumber = 1;

    get all(): Runtime[] {
        return [...this.#runtimes.values()];
    }

    observe(observer: RuntimeObserver): void {
        this.#observers.push(observer);
    }

    admit(address: NativePointer, runtimeClass: RuntimeClass): Runtime {
        const key = pointerKey(address);
        const known = this.#runtimes.get(key);
        if (known !== undefined && known.presence !== "closed") {
            return known;
        }
        const runtime: Runtime = {
            number: this.#nextNumber++,
            address,
            key,
            runtimeClass,
            presence: "unseen",
            owner: null,
            ownership: null,
            ownerName: null,
            kit: "absent",
            failure: null,
            facts: null,
        };
        this.#runtimes.set(key, runtime);
        this.#observers.forEach(observer => observer.onRuntimeAdded(runtime));
        return runtime;
    }

    byKey(key: string): Runtime | undefined {
        return this.#runtimes.get(key);
    }

    numbered(number: number): Runtime | undefined {
        return this.all.find(runtime => runtime.number === number);
    }

    changed(runtime: Runtime): void {
        this.#observers.forEach(observer => observer.onRuntimeChanged(runtime));
    }

    close(runtime: Runtime): void {
        if (runtime.presence === "closed") {
            return;
        }
        runtime.presence = "closed";
        this.changed(runtime);
    }
}

export function runtimeLabel(runtime: Runtime): string {
    return `#${runtime.number} ${runtime.runtimeClass.engine}`;
}
