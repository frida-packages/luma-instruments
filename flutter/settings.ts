export class Settings {
    bytesKept!: number;
    messagesPerSecond!: number;
    emitMessages!: boolean;
    askVmService!: boolean;
    #hidden: RegExp | null = null;

    constructor(config: CustomInstrumentConfig) {
        this.apply(config);
    }

    apply({ settings }: CustomInstrumentConfig): void {
        this.bytesKept = settings.bytesKept;
        this.messagesPerSecond = settings.messagesPerSecond;
        this.emitMessages = settings.emitMessages;
        this.askVmService = settings.askVmService;
        this.#hidden = (settings.hideChannels !== undefined) ? new RegExp(settings.hideChannels) : null;
    }

    hides(channel: string): boolean {
        return this.#hidden?.test(channel) ?? false;
    }
}
