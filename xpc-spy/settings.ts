export class Settings {
    services: RegExp | null = null;
    backtraces = false;
    dataLimit = 0;
    messagesPerSecond = 0;

    constructor(config: CustomInstrumentConfig) {
        this.apply(config);
    }

    apply({ settings }: CustomInstrumentConfig): void {
        this.services = (settings.services !== undefined) ? new RegExp(settings.services) : null;
        this.backtraces = settings.backtraces;
        this.dataLimit = settings.dataLimit;
        this.messagesPerSecond = settings.messagesPerSecond;
    }

    wants(service: string): boolean {
        return this.services?.test(service) ?? true;
    }
}
