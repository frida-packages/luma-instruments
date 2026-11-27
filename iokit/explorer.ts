import { type IOApi, IOConnection, IOEntry } from "./io-api.js";

type ExplorerWidget = CustomInstrumentWidgetMap["explorer"];
type Evaluate = (...scopeAndSource: unknown[]) => unknown;

interface Output {
    output(text: string): void;
    error(text: string): void;
    value(value: unknown): void;
}

const evaluate = new Function("io", "print", "_", "source", "return eval(source);") as Evaluate;

const helpLines = [
    "JavaScript typed here runs in the process, with io in scope; _ is the last value and print(...) writes a line.",
    "io.find(\"IOSurfaceRoot\")      the services of a class",
    "io.named(\"AppleKeyStore\")     the services of a name",
    "io.entry(\"0x100000123\")       the service with that registry entry ID",
    "io.path(\"IOService:/\")        the entry at a registry path; io.root is the root",
    "io.openable(/HID/)            the services in the table above whose class or user client class matches",
    "io.connections                the connections the instrument has seen, the process's and yours",
    "io.connection(0x1a03)         the connection with that port, also one the process opened",
    "io.replay(12)                 makes call #12 of Recent activity again, with the same input",
    "An entry has className, name, id, path, properties(), property(key), children(), parent() and open(type = 0).",
    "A connection has call(selector, { scalars, struct, outputScalars, outputStruct }), probe(first = 0, last = 63), map(memoryType) and close().",
    "probe calls each selector with no input and groups the results; a method that takes no input runs.",
    "Connections opened here are closed when the instrument is removed or loaded again.",
    ":help            show this",
];

export class Explorer {
    readonly #widget: ExplorerWidget;
    readonly #api: IOApi;
    readonly #output: Output;
    #last: unknown = undefined;

    constructor(widget: ExplorerWidget, api: IOApi) {
        this.#widget = widget;
        this.#api = api;
        this.#output = {
            output: text => widget.appendOutput(text),
            error: text => widget.appendError(text),
            value: value => widget.appendValue(value),
        };
    }

    announce(): void {
        this.#widget.appendOutput("Explore IOKit in JavaScript, with io in scope; :help says what it offers.");
    }

    handle(text: string, respond: Output): void {
        const trimmed = text.trim();
        if (trimmed === ":help") {
            helpLines.forEach(line => respond.output(line));
            return;
        }
        if (trimmed.startsWith(":")) {
            respond.error(`Unknown directive ${trimmed.split(/\s/)[0]}. :help lists them.`);
            return;
        }
        const print = (...parts: unknown[]) => respond.output(parts.map(part => (typeof part === "string") ? part : String(part)).join(" "));
        this.#present(evaluate(this.#api, print, this.#last, text), respond);
    }

    showProperties(entryId: string): void {
        this.#run(`io.entry("${entryId}").properties()`, () => this.#api.entry(entryId).properties());
    }

    open(entryId: string): void {
        this.#run(`io.entry("${entryId}").open()`, () => this.#api.entry(entryId).open());
    }

    clear(): void {
        this.#widget.clear();
    }

    dispose(): void {
        this.#api.closeAll();
    }

    #run(source: string, action: () => unknown): void {
        this.#widget.appendConsole({ kind: "input", text: source });
        try {
            this.#present(action(), this.#output);
        } catch (error) {
            this.#output.error((error as Error).message);
        }
    }

    #present(value: unknown, output: Output): void {
        this.#last = value;
        output.value(presentable(value));
    }
}

function presentable(value: unknown): unknown {
    if (value instanceof IOEntry || value instanceof IOConnection) {
        return value.describe();
    }
    if (Array.isArray(value)) {
        return value.map(presentable);
    }
    return value;
}
