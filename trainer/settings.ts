import type { Alignment } from "./first-scan.js";
import { typesSelectedBy, type ValueType } from "./value-types.js";

export class Settings {
    types: ValueType[] = [];
    alignment: Alignment = "aligned";

    constructor(config: CustomInstrumentConfig) {
        this.apply(config);
    }

    apply({ features }: CustomInstrumentConfig): void {
        this.types = typesSelectedBy(features.types);
        this.alignment = features.unaligned ? "unaligned" : "aligned";
    }
}
