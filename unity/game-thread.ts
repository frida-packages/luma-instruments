import type { UnityApi } from "./unity-api.js";

export type Place = "main-thread" | "paused";

type Work = (place: Place) => void;

const IDLE_CHECK_MS = 150;

export class GameThread {
    readonly #api: UnityApi;
    readonly #pending: Work[] = [];
    #listener: InvocationListener | null = null;

    constructor(api: UnityApi) {
        this.#api = api;
    }

    run<T>(block: (place: Place) => T): Promise<T> {
        return new Promise((resolve, reject) => {
            this.#pending.push(place => {
                try {
                    resolve(block(place));
                } catch (e) {
                    reject(e);
                }
            });
            this.#listen();
            this.#runHereIfIdle(this.#api.frameCount());
        });
    }

    dispose(): void {
        this.#pending.length = 0;
        this.#stopListening();
    }

    #listen(): void {
        if (this.#listener === null) {
            this.#listener = Interceptor.attach(this.#api.pump, {
                onEnter: () => this.#drain("main-thread"),
            });
        }
    }

    #runHereIfIdle(frame: number): void {
        setTimeout(() => {
            if (this.#pending.length !== 0 && this.#api.frameCount() === frame) {
                this.#drain("paused");
            }
        }, IDLE_CHECK_MS);
    }

    #drain(place: Place): void {
        const work = this.#pending.splice(0);
        this.#stopListening();
        for (const each of work) {
            each(place);
        }
    }

    #stopListening(): void {
        this.#listener?.detach();
        this.#listener = null;
    }
}
