import type { GStreamerApi } from "./gstreamer-api.js";

export type Discovery = "memory scan" | "state change";

export class TrackedBin {
    readonly id: string;
    readonly weakRef = Memory.alloc(Process.pointerSize);
    forgotten = false;

    constructor(readonly address: NativePointer, readonly foundBy: Discovery) {
        this.id = address.toString();
    }
}

export class TrackedBins {
    readonly #api: GStreamerApi;
    readonly #bins = new Map<string, TrackedBin>();

    constructor(api: GStreamerApi) {
        this.#api = api;
    }

    track(object: NativePointer, foundBy: Discovery): TrackedBin {
        const known = this.#bins.get(object.toString());
        if (known !== undefined && this.#isAlive(known)) {
            return known;
        }
        if (known !== undefined) {
            this.forget(known);
        }
        const bin = new TrackedBin(object, foundBy);
        this.#api.initWeakRef(bin.weakRef, object);
        this.#bins.set(bin.id, bin);
        return bin;
    }

    find(id: string): TrackedBin | undefined {
        return this.#bins.get(id);
    }

    all(): TrackedBin[] {
        return [...this.#bins.values()];
    }

    hold<T>(bin: TrackedBin, use: (object: NativePointer) => T): T | null {
        if (bin.forgotten) {
            return null;
        }
        const object = this.#api.strongRefFrom(bin.weakRef);
        if (object.isNull()) {
            return null;
        }
        try {
            return use(object);
        } finally {
            this.#api.unref(object);
        }
    }

    forget(bin: TrackedBin): void {
        if (bin.forgotten) {
            return;
        }
        bin.forgotten = true;
        this.#api.clearWeakRef(bin.weakRef);
        if (this.#bins.get(bin.id) === bin) {
            this.#bins.delete(bin.id);
        }
    }

    dispose(): void {
        for (const bin of this.#bins.values()) {
            this.forget(bin);
        }
        this.#bins.clear();
    }

    #isAlive(bin: TrackedBin): boolean {
        const object = this.#api.strongRefFrom(bin.weakRef);
        if (object.isNull()) {
            return false;
        }
        this.#api.unref(object);
        return true;
    }
}
