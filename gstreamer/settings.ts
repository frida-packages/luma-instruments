export type GraphDetail = CustomInstrumentSettingMap["details"];

const showMediaType = 1 << 0;
const showStates = 1 << 3;
const showAll = (1 << 4) - 1;
const showVerbose = 0xffffffff;

const detailFlags: Record<GraphDetail, number> = {
    states: showMediaType | showStates,
    all: showAll,
    verbose: showVerbose,
};

export class Settings {
    details!: GraphDetail;
    detailFlags!: number;
    refreshMilliseconds!: number;

    constructor(config: CustomInstrumentConfig) {
        this.apply(config);
    }

    apply({ settings }: CustomInstrumentConfig): void {
        this.details = settings.details;
        this.detailFlags = detailFlags[settings.details];
        this.refreshMilliseconds = settings.refreshInterval * 1000;
    }
}
