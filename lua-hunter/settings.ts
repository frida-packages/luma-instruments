export class Settings {
    scanMemory!: boolean;
    entriesPerTable!: number;

    constructor(config: CustomInstrumentConfig) {
        this.apply(config);
    }

    apply({ features }: CustomInstrumentConfig): void {
        this.scanMemory = features.scanMemory;
        this.entriesPerTable = features.entriesPerTable;
    }
}
