export class Settings {
    traceMethods!: RegExp | null;
    mostTraced!: number;
    callsPerSecond!: number;
    charsPerValue!: number;

    constructor(config: CustomInstrumentConfig) {
        this.apply(config);
    }

    apply({ settings }: CustomInstrumentConfig): void {
        const pattern = settings.traceMethods ?? "";
        this.traceMethods = (pattern === "") ? null : new RegExp(pattern);
        this.mostTraced = settings.mostTraced;
        this.callsPerSecond = settings.callsPerSecond;
        this.charsPerValue = settings.charsPerValue;
    }
}
