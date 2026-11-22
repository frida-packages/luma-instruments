declare interface CustomInstrumentContext {
    emit(value: unknown): void;
    widget<K extends keyof CustomInstrumentWidgetMap>(id: K): CustomInstrumentWidgetMap[K];
}

declare interface CustomInstrumentCounterWidget {
    setCounter(value: { value: number, unit?: string, delta?: number }): void;
    clear(): void;
}

declare interface CustomInstrumentHistogramWidget {
    setHistogram(buckets: Array<{ label: string, count: number }>): void;
    incrementBucket(label: string, by?: number): void;
    clear(): void;
}

declare interface CustomInstrumentGraphWidget<Series extends string> {
    push(point: { series: Series, x: number, y: number }): void;
    clear(): void;
}

declare interface CustomInstrumentListWidget<Action extends string> {
    upsertItem(item: { id: string, title: string, subtitle?: string, accessory?: string }): void;
    removeItem(id: string): void;
    clear(): void;
}

declare interface CustomInstrumentTableWidget<Column extends string, Action extends string> {
    upsertRow(row: { id: string, cells: { [K in Column]: string } }): void;
    removeRow(id: string): void;
    clear(): void;
}

declare interface CustomInstrumentHexWidget {
    setHex(state: { bytes: ArrayBuffer | number[], baseAddress?: number | string }): void;
    clear(): void;
}

declare interface CustomInstrumentConsoleImage {
    bytes: ArrayBuffer | Uint8Array | number[];
    mediaType: string;
    width: number;
    height: number;
    text?: string;
}

declare interface CustomInstrumentConsoleWidget {
    appendOutput(text: string): void;
    appendError(text: string): void;
    appendValue(value: unknown): void;
    appendImage(image: CustomInstrumentConsoleImage): void;
    appendConsole(entry: { id?: string, kind: "input" | "output" | "error", text: string }): void;
    clear(): void;
}

declare interface CustomInstrumentWidgetMap {
}

declare type CustomInstrumentAction = {
    [K in keyof CustomInstrumentWidgetMap]:
        CustomInstrumentWidgetMap[K] extends CustomInstrumentListWidget<infer A>
            ? { widget: K; action: A; item: string }
        : CustomInstrumentWidgetMap[K] extends CustomInstrumentTableWidget<any, infer A>
            ? { widget: K; action: A; item: string }
            : never
}[keyof CustomInstrumentWidgetMap];

declare type CustomInstrumentConsoleInput = {
    [K in keyof CustomInstrumentWidgetMap]:
        CustomInstrumentWidgetMap[K] extends CustomInstrumentConsoleWidget
            ? { widget: K; entryId: string; text: string }
            : never
}[keyof CustomInstrumentWidgetMap];

declare interface CustomInstrumentConsoleResponder {
    output(text: string): void;
    error(text: string): void;
    value(v: unknown): void;
    image(image: CustomInstrumentConsoleImage): void;
}

declare type CustomFeatureValue = boolean | number | string | CustomFeatureValue[] | { [name: string]: CustomFeatureValue };

declare interface CustomInstrumentFeatureMap {
}

declare interface CustomInstrumentConfig {
    features: CustomInstrumentFeatureMap;
}

declare interface CustomInstrumentHandle {
    updateConfig?(config: CustomInstrumentConfig): void | Promise<void>;
    onAction?(action: CustomInstrumentAction): void | Promise<void>;
    onConsoleInput?(
        input: CustomInstrumentConsoleInput,
        respond: CustomInstrumentConsoleResponder
    ): void | Promise<void>;
    dispose?(): void | Promise<void>;
}

declare interface CustomInstrumentCounterSnapshot {
    counter: { value: number; unit?: string; delta?: number } | null;
}

declare interface CustomInstrumentHistogramSnapshot {
    buckets: Array<{ label: string; count: number }>;
}

declare interface CustomInstrumentGraphSnapshot<Series extends string> {
    points: Array<{ series: Series; x: number; y: number }>;
}

declare interface CustomInstrumentListSnapshot {
    items: Array<{ id: string; title: string; subtitle?: string; accessory?: string }>;
}

declare interface CustomInstrumentTableSnapshot<Column extends string> {
    rows: Array<{ id: string; cells: { [K in Column]: string } }>;
}

declare interface CustomInstrumentHexSnapshot {
    hex: { bytes: string; base_address: number } | null;
}

declare interface CustomInstrumentConsoleSnapshot {
    entries: Array<{ id: string; kind: "input" | "output" | "error"; text: string }>;
}

declare interface CustomInstrumentRestoredState {
}

declare interface CustomInstrument {
    create(
        ctx: CustomInstrumentContext,
        config: CustomInstrumentConfig,
        restored: CustomInstrumentRestoredState,
    ): CustomInstrumentHandle | Promise<CustomInstrumentHandle>;
}

declare interface CustomInstrumentFeatureMap {
    /** Memory to scan for encoded certificates */
    scope: "writable" | "readable";
}

declare interface CustomInstrumentWidgetMap {
    /** Scan */
    scan: CustomInstrumentListWidget<"rescan">;
    /** Certificates */
    certificates: CustomInstrumentTableWidget<"subject" | "issuer" | "expires" | "key" | "sha256" | "found", "inspect">;
    /** Details */
    details: CustomInstrumentConsoleWidget;
    /** DER */
    der: CustomInstrumentHexWidget;
}
