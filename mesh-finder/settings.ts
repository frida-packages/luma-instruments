export class Settings {
    watchDraws!: boolean;
    guessUndrawn!: boolean;
    minimumConfidence!: number;
    minimumVertices!: number;

    constructor(config: CustomInstrumentConfig) {
        this.apply(config);
    }

    apply({ features }: CustomInstrumentConfig): void {
        this.watchDraws = features.watchDraws;
        this.guessUndrawn = features.guessUndrawn;
        this.minimumConfidence = features.minimumConfidence / 100;
        this.minimumVertices = features.minimumVertices;
    }
}
