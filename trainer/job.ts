export type Phase = "scanning" | "reading";

const pauseInterval = 40;

export class Cancelled extends Error {
    constructor() {
        super("Stopped.");
    }
}

export class Job {
    private state: "running" | "cancelling" = "running";
    private lastPause = Date.now();
    progress = 0;

    constructor(private readonly onProgress: (phase: Phase, fraction: number) => void) {
    }

    cancel(): void {
        this.state = "cancelling";
    }

    async checkpoint(phase: Phase, fraction: number): Promise<void> {
        if (Date.now() - this.lastPause < pauseInterval) {
            return;
        }
        this.progress = fraction;
        this.onProgress(phase, fraction);
        await new Promise(resolve => setImmediate(resolve));
        this.lastPause = Date.now();
        if (this.state === "cancelling") {
            throw new Cancelled();
        }
    }
}
