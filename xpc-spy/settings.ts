export class Settings {
    services: RegExp | null = null;
    backtraces = false;
    dataLimit = 0;

    constructor(config: CustomInstrumentConfig) {
        this.apply(config);
    }

    apply({ features }: CustomInstrumentConfig): void {
        this.services = (features.services !== undefined) ? new RegExp(features.services) : null;
        this.backtraces = features.backtraces;
        this.dataLimit = features.dataLimit;
    }

    wants(service: string): boolean {
        return this.services?.test(service) ?? true;
    }
}
