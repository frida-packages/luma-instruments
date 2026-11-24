export class Settings {
    scanMemory!: boolean;
    entriesPerTable!: number;

    constructor(config: CustomInstrumentConfig) {
        this.apply(config);
    }

    apply({ settings }: CustomInstrumentConfig): void {
        this.scanMemory = settings.scanMemory;
        this.entriesPerTable = settings.entriesPerTable;
    }
}
