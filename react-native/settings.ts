export class Settings {
    captureTraffic!: boolean;
    watchEveryModule!: boolean;
    trafficPattern!: RegExp | null;
    bytesPerCall!: number;
    callsKept!: number;

    constructor(config: CustomInstrumentConfig) {
        this.apply(config);
    }

    apply({ settings }: CustomInstrumentConfig): void {
        this.captureTraffic = settings.captureTraffic;
        this.watchEveryModule = settings.watchEveryModule;
        this.trafficPattern = (settings.trafficPattern !== undefined) ? new RegExp(settings.trafficPattern) : null;
        this.bytesPerCall = settings.bytesPerCall;
        this.callsKept = settings.callsKept;
    }
}
