export class Settings {
    classes: RegExp | null = null;
    backtraces = false;
    dataLimit = 0;
    callsPerSecond = 0;

    constructor(config: CustomInstrumentConfig) {
        this.apply(config);
    }

    apply({ settings }: CustomInstrumentConfig): void {
        this.classes = (settings.classes !== undefined) ? new RegExp(settings.classes) : null;
        this.backtraces = settings.backtraces;
        this.dataLimit = settings.dataLimit;
        this.callsPerSecond = settings.callsPerSecond;
    }

    wants(...names: string[]): boolean {
        return this.classes === null || names.some(name => this.classes!.test(name));
    }
}
