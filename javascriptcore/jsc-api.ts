export type Evaluation = { kind: "value"; text: string } | { kind: "exception"; text: string };

type Pointer = NativePointerValue;

export class JscApi {
    readonly #stringCreate: NativeFunction<NativePointer, [Pointer]>;
    readonly #stringRelease: NativeFunction<void, [Pointer]>;
    readonly #stringLength: NativeFunction<UInt64, [Pointer]>;
    readonly #stringCharacters: NativeFunction<NativePointer, [Pointer]>;
    readonly #evaluateScript: NativeFunction<NativePointer, [Pointer, Pointer, Pointer, Pointer, number, Pointer]>;
    readonly #valueToString: NativeFunction<NativePointer, [Pointer, Pointer, Pointer]>;
    readonly #valueToJson: NativeFunction<NativePointer, [Pointer, Pointer, number, Pointer]>;
    readonly #copyName: NativeFunction<NativePointer, [Pointer]>;
    readonly #isInspectable: NativeFunction<number, [Pointer]>;
    readonly #setInspectable: NativeFunction<void, [Pointer, number]>;
    readonly #contextGroup: NativeFunction<NativePointer, [Pointer]>;
    readonly #memoryStatistics: NativeFunction<NativePointer, [Pointer]>;
    readonly #enableProfiler: NativeFunction<number, [Pointer]>;
    readonly #disableProfiler: NativeFunction<void, [Pointer]>;
    readonly #takeSamples: NativeFunction<NativePointer, [Pointer]>;

    constructor(module: Module) {
        const address = (name: string) => module.getExportByName(name);
        this.#stringCreate = new NativeFunction(address("JSStringCreateWithUTF8CString"), "pointer", ["pointer"]);
        this.#stringRelease = new NativeFunction(address("JSStringRelease"), "void", ["pointer"]);
        this.#stringLength = new NativeFunction(address("JSStringGetLength"), "size_t", ["pointer"]);
        this.#stringCharacters = new NativeFunction(address("JSStringGetCharactersPtr"), "pointer", ["pointer"]);
        this.#evaluateScript = new NativeFunction(address("JSEvaluateScript"), "pointer",
            ["pointer", "pointer", "pointer", "pointer", "int", "pointer"]);
        this.#valueToString = new NativeFunction(address("JSValueToStringCopy"), "pointer", ["pointer", "pointer", "pointer"]);
        this.#valueToJson = new NativeFunction(address("JSValueCreateJSONString"), "pointer", ["pointer", "pointer", "uint", "pointer"]);
        this.#copyName = new NativeFunction(address("JSGlobalContextCopyName"), "pointer", ["pointer"]);
        this.#isInspectable = new NativeFunction(address("JSGlobalContextIsInspectable"), "bool", ["pointer"]);
        this.#setInspectable = new NativeFunction(address("JSGlobalContextSetInspectable"), "void", ["pointer", "bool"]);
        this.#contextGroup = new NativeFunction(address("JSContextGetGroup"), "pointer", ["pointer"]);
        this.#memoryStatistics = new NativeFunction(address("JSGetMemoryUsageStatistics"), "pointer", ["pointer"]);
        this.#enableProfiler = new NativeFunction(address("JSContextGroupEnableSamplingProfiler"), "bool", ["pointer"]);
        this.#disableProfiler = new NativeFunction(address("JSContextGroupDisableSamplingProfiler"), "void", ["pointer"]);
        this.#takeSamples = new NativeFunction(address("JSContextGroupTakeSamplesFromSamplingProfiler"), "pointer", ["pointer"]);
    }

    evaluate(context: NativePointer, source: string, sourceURL: string): Evaluation {
        const script = this.#stringCreate(Memory.allocUtf8String(source));
        const url = this.#stringCreate(Memory.allocUtf8String(sourceURL));
        const exception = Memory.alloc(Process.pointerSize);
        const value = this.#evaluateScript(context, script, NULL, url, 1, exception);
        this.#stringRelease(script);
        this.#stringRelease(url);
        if (value.isNull()) {
            return { kind: "exception", text: this.#textOf(context, exception.readPointer()) };
        }
        return { kind: "value", text: this.#textOf(context, value) };
    }

    nameOf(context: NativePointer): string | null {
        const name = this.#copyName(context);
        return name.isNull() ? null : this.takeString(name);
    }

    isInspectable(context: NativePointer): boolean {
        return this.#isInspectable(context) !== 0;
    }

    setInspectable(context: NativePointer, inspectable: boolean): void {
        this.#setInspectable(context, inspectable ? 1 : 0);
    }

    groupOf(context: NativePointer): NativePointer {
        return this.#contextGroup(context);
    }

    memoryStatistics(context: NativePointer): string {
        const statistics = this.#memoryStatistics(context);
        return this.takeString(this.#valueToJson(context, statistics, 0, NULL));
    }

    startProfiler(group: NativePointer): boolean {
        return this.#enableProfiler(group) !== 0;
    }

    stopProfiler(group: NativePointer): void {
        this.#disableProfiler(group);
    }

    takeSamples(group: NativePointer): string | null {
        const samples = this.#takeSamples(group);
        return samples.isNull() ? null : this.takeString(samples);
    }

    readString(string: NativePointer): string {
        const length = this.#stringLength(string).toNumber();
        return (length === 0) ? "" : this.#stringCharacters(string).readUtf16String(length)!;
    }

    takeString(string: NativePointer): string {
        const text = this.readString(string);
        this.#stringRelease(string);
        return text;
    }

    #textOf(context: NativePointer, value: NativePointer): string {
        return this.takeString(this.#valueToString(context, value, NULL));
    }
}
