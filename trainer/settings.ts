import type { Alignment } from "./first-scan.js";
import { typesSelectedBy, type ValueType } from "./value-types.js";

export class Settings {
    types: ValueType[] = [];
    alignment: Alignment = "aligned";

    constructor(config: CustomInstrumentConfig) {
        this.apply(config);
    }

    apply({ settings }: CustomInstrumentConfig): void {
        this.types = typesSelectedBy(settings.types);
        this.alignment = settings.unaligned ? "unaligned" : "aligned";
    }
}
