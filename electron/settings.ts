import type { CaptureOptions } from "./runtime-link.js";

export class Settings {
    channels!: string | null;
    ratePerSecond!: number;
    maxChars!: number;
    archivePaths!: string | null;

    constructor(config: CustomInstrumentConfig) {
        this.apply(config);
    }

    apply({ settings }: CustomInstrumentConfig): void {
        this.channels = settings.channels ?? null;
        this.ratePerSecond = settings.ratePerSecond;
        this.maxChars = settings.maxChars;
        this.archivePaths = settings.archivePaths ?? null;
    }

    captureOptions(capture: boolean): CaptureOptions {
        return { capture, channels: this.channels, maxChars: this.maxChars, ratePerSecond: this.ratePerSecond };
    }
}
