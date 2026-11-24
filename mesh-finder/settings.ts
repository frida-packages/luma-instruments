export class Settings {
    watchDraws!: boolean;
    guessUndrawn!: boolean;
    minimumConfidence!: number;
    minimumVertices!: number;

    constructor(config: CustomInstrumentConfig) {
        this.apply(config);
    }

    apply({ settings }: CustomInstrumentConfig): void {
        this.watchDraws = settings.watchDraws;
        this.guessUndrawn = settings.guessUndrawn;
        this.minimumConfidence = settings.minimumConfidence / 100;
        this.minimumVertices = settings.minimumVertices;
    }
}
