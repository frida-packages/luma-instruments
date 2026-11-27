const WINDOW_MS = 1000;

export class RateWindow {
    readonly #limit: () => number;
    #start = 0;
    #shown = 0;
    #unshown = 0;
    #unreported = 0;

    constructor(limit: () => number) {
        this.#limit = limit;
    }

    admits(time: number): boolean {
        this.closeIfOver(time);
        if (this.#shown < this.#limit()) {
            this.#shown++;
            return true;
        }
        this.#unshown++;
        return false;
    }

    closeIfOver(time: number): void {
        if (time - this.#start < WINDOW_MS) {
            return;
        }
        this.#unreported += this.#unshown;
        this.#start = time;
        this.#shown = 0;
        this.#unshown = 0;
    }

    takeUnreported(): number {
        const count = this.#unreported;
        this.#unreported = 0;
        return count;
    }

    get pending(): boolean {
        return this.#unshown !== 0;
    }

    get endsAt(): number {
        return this.#start + WINDOW_MS;
    }
}
