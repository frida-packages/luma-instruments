declare interface CustomInstrumentContext {
    emit(value: unknown): void;
    widget<K extends keyof CustomInstrumentWidgetMap>(id: K): CustomInstrumentWidgetMap[K];
    children<T extends keyof CustomInstrumentChildMap>(template: T): CustomInstrumentChildren<T>;
}

declare interface CustomInstrumentChildMap {
}

declare interface CustomInstrumentChildActionMap {
}

declare interface CustomInstrumentChildRow {
    title: string;
    subtitle?: string;
    badge?: { text: string; tone?: "neutral" | "active" | "waiting" | "ended" | "failed" } | null;
}

declare interface CustomInstrumentChildren<T extends keyof CustomInstrumentChildMap> {
    add(id: string, row: CustomInstrumentChildRow): CustomInstrumentChild<T>;
    get(id: string): CustomInstrumentChild<T> | undefined;
    ids(): string[];
    remove(id: string): void;
}

declare interface CustomInstrumentChild<T extends keyof CustomInstrumentChildMap> {
    readonly template: T;
    readonly id: string;
    update(row: Partial<CustomInstrumentChildRow>): void;
    widget<K extends keyof CustomInstrumentChildMap[T]>(id: K): CustomInstrumentChildMap[T][K];
    remove(): void;
}

declare interface CustomInstrumentCounterWidget {
    setCounter(value: { value: number, unit?: string, delta?: number, fractionDigits?: number }): void;
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

declare interface CustomInstrumentListWidget {
    upsertItem(item: { id: string, title: string, subtitle?: string, accessory?: string }): void;
    removeItem(id: string): void;
    clear(): void;
}

declare interface CustomInstrumentTableWidget<Column extends string> {
    upsertRow(row: { id: string, cells: { [K in Column]: string } }): void;
    removeRow(id: string): void;
    clear(): void;
}

declare interface CustomInstrumentHexWidget {
    setHex(state: { bytes: ArrayBuffer | number[], baseAddress?: number | string | NativePointer }): void;
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

declare type CustomInstrumentViewData = ArrayBuffer | ArrayBufferView | number[];

declare interface CustomInstrumentViewWidget {
    setState(value: unknown, data?: CustomInstrumentViewData | null): void;
    sendEvent(value: unknown, data?: CustomInstrumentViewData | null): void;
    clear(): void;
}

declare interface CustomInstrumentWidgetActions<Action extends string> {
    setActionEnabled(action: Action, enabled: boolean): void;
}

declare interface CustomInstrumentWidgetMap {
}

declare interface CustomInstrumentActionMap {
}

declare type CustomInstrumentAction =
    | CustomInstrumentActionMap[keyof CustomInstrumentActionMap]
    | CustomInstrumentChildActionMap[keyof CustomInstrumentChildActionMap];

declare type CustomInstrumentConsoleInput = {
    [K in keyof CustomInstrumentWidgetMap]:
        CustomInstrumentWidgetMap[K] extends CustomInstrumentConsoleWidget
            ? { widget: K; entryId: string; text: string; child?: undefined }
            : never
}[keyof CustomInstrumentWidgetMap] | {
    [T in keyof CustomInstrumentChildMap]: {
        [K in keyof CustomInstrumentChildMap[T]]:
            CustomInstrumentChildMap[T][K] extends CustomInstrumentConsoleWidget
                ? { child: { template: T; id: string }; widget: K; entryId: string; text: string }
                : never
    }[keyof CustomInstrumentChildMap[T]]
}[keyof CustomInstrumentChildMap];

declare type CustomInstrumentViewMessage = {
    [K in keyof CustomInstrumentWidgetMap]:
        CustomInstrumentWidgetMap[K] extends CustomInstrumentViewWidget
            ? { widget: K; value: unknown; data: ArrayBuffer | null; from?: { id: string; name: string }; child?: undefined }
            : never
}[keyof CustomInstrumentWidgetMap] | {
    [T in keyof CustomInstrumentChildMap]: {
        [K in keyof CustomInstrumentChildMap[T]]:
            CustomInstrumentChildMap[T][K] extends CustomInstrumentViewWidget
                ? { child: { template: T; id: string }; widget: K; value: unknown; data: ArrayBuffer | null; from?: { id: string; name: string } }
                : never
    }[keyof CustomInstrumentChildMap[T]]
}[keyof CustomInstrumentChildMap];

declare interface CustomInstrumentOfferedFileHeader {
    name: string;
    mediaType: string;
}

declare interface CustomInstrumentOfferedFile extends CustomInstrumentOfferedFileHeader {
    bytes: ArrayBuffer | ArrayBufferView | number[];
}

declare interface CustomInstrumentOfferFile {
    (file: CustomInstrumentOfferedFile): void;
    (file: CustomInstrumentOfferedFileHeader): import("stream").Writable;
}

declare interface CustomInstrumentActionResponder {
    file: CustomInstrumentOfferFile;
    show(child: CustomInstrumentChild<keyof CustomInstrumentChildMap> | null): void;
}

declare interface CustomInstrumentConsoleResponder {
    output(text: string): void;
    error(text: string): void;
    value(v: unknown): void;
    image(image: CustomInstrumentConsoleImage): void;
    file: CustomInstrumentOfferFile;
    show(child: CustomInstrumentChild<keyof CustomInstrumentChildMap> | null): void;
}

declare type CustomSettingValue = boolean | number | string | CustomSettingValue[] | { [name: string]: CustomSettingValue };

declare interface CustomInstrumentSettingMap {
}

declare interface CustomInstrumentConfig {
    settings: CustomInstrumentSettingMap;
}

declare interface CustomInstrumentHandle {
    updateConfig?(config: CustomInstrumentConfig): void | Promise<void>;
    onAction?(action: CustomInstrumentAction, respond: CustomInstrumentActionResponder): void | Promise<void>;
    onConsoleInput?(
        input: CustomInstrumentConsoleInput,
        respond: CustomInstrumentConsoleResponder
    ): void | Promise<void>;
    onViewMessage?(message: CustomInstrumentViewMessage): void | Promise<void>;
    dispose?(): void | Promise<void>;
}

declare interface CustomInstrumentCounterSnapshot {
    counter: { value: number; unit?: string; delta?: number; fractionDigits?: number } | null;
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
    hex: { bytes: string; base_address: NativePointer } | null;
}

declare interface CustomInstrumentConsoleSnapshot {
    entries: Array<{ id: string; kind: "input" | "output" | "error"; text: string }>;
}

declare interface CustomInstrumentViewSnapshot {
    state: unknown | null;
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

declare interface CustomInstrumentSettingMap {
    /** Log the scripts the app evaluates */
    logScripts: boolean;
    /** Megabytes of script source kept for Export */
    sourceMegabytes: number;
}

declare interface CustomInstrumentWidgetMap {
    /** status */
    status: CustomInstrumentListWidget;
    /** Contexts */
    contexts: CustomInstrumentTableWidget<"number" | "kind" | "name" | "className" | "vm" | "runsOn" | "inspectable" | "status"> & CustomInstrumentWidgetActions<"scan">;
    /** VMs */
    vms: CustomInstrumentTableWidget<"number" | "contexts" | "heap" | "objects" | "globals" | "profiler" | "samples"> & CustomInstrumentWidgetActions<"refresh">;
    /** Heap objects */
    heap: CustomInstrumentHistogramWidget;
    /** Scripts */
    scripts: CustomInstrumentTableWidget<"number" | "time" | "context" | "via" | "url" | "size" | "lines" | "runs" | "outcome" | "ms"> & CustomInstrumentWidgetActions<"clear">;
    /** Hot functions */
    profile: CustomInstrumentHistogramWidget & CustomInstrumentWidgetActions<"clear">;
}

declare interface CustomInstrumentActionMap {
    contexts: { widget: "contexts"; action: "scan"; item?: undefined; child?: undefined } | { widget: "contexts"; action: "show" | "inspect" | "uninspect"; item: string; child?: undefined };
    vms: { widget: "vms"; action: "refresh"; item?: undefined; child?: undefined } | { widget: "vms"; action: "heap" | "profile" | "unprofile"; item: string; child?: undefined };
    scripts: { widget: "scripts"; action: "clear"; item?: undefined; child?: undefined } | { widget: "scripts"; action: "export"; item: string; child?: undefined };
    profile: { widget: "profile"; action: "clear"; item?: undefined; child?: undefined };
}

declare interface CustomInstrumentChildMap {
    /** Contexts */
    context: {
        console: CustomInstrumentConsoleWidget & CustomInstrumentWidgetActions<"clear">;
    };
}

declare interface CustomInstrumentChildActionMap {
    "context/console": { child: { template: "context"; id: string }; widget: "console"; action: "clear"; item?: undefined };
}