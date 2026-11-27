import { presentValue } from "./console-values.js";
import type { GameThread, Place } from "./game-thread.js";
import type { UnityApi } from "./unity-api.js";
import type { ValueText } from "./value-text.js";

type ConsoleWidget = CustomInstrumentWidgetMap["console"];
type Responder = CustomInstrumentConsoleResponder;
type Evaluate = (...scopeAndSource: unknown[]) => unknown;

const evaluate = new Function("Il2Cpp", "classNamed", "unityObject", "print", "_", "source", "return eval(source);") as Evaluate;

const helpLines = [
    "JavaScript typed here runs on the game's main thread, between two frames; while the game is paused it runs at once instead.",
    "The value of the last statement is shown; a promise is awaited, and _ is the last value.",
    "In scope: Il2Cpp (frida-il2cpp-bridge), classNamed(\"Namespace.Class\"), unityObject(instanceId), print(...).",
    "An instance id is the # a scene's page shows beside each GameObject.",
    "Example: unityObject(12345).method(\"get_transform\").invoke().method(\"get_position\").invoke()",
    "var declarations last for one input only; keep things on globalThis to use them later.",
    ":help            show this",
];

export class JsConsole {
    readonly #widget: ConsoleWidget;
    readonly #thread: GameThread;
    readonly #api: UnityApi;
    readonly #values: ValueText;
    #last: unknown = undefined;
    #lastPlace: Place = "main-thread";

    constructor(widget: ConsoleWidget, thread: GameThread, api: UnityApi, values: ValueText) {
        this.#widget = widget;
        this.#thread = thread;
        this.#api = api;
        this.#values = values;
    }

    announce(): void {
        this.#widget.appendOutput("Il2Cpp is ready. JavaScript typed here runs on the game's main thread; :help says what is in scope.");
    }

    async handle(text: string, respond: Responder): Promise<void> {
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
        const { place, result } = await this.#thread.run(place => ({
            place,
            result: evaluate(Il2Cpp, classNamed, (instanceId: number) => this.#api.findObject(instanceId), print, this.#last, text),
        }));
        this.#notePlace(place, respond);
        const value = await result;
        this.#last = value;
        presentValue(value, respond, this.#api, this.#values);
    }

    clear(): void {
        this.#widget.clear();
    }

    #notePlace(place: Place, respond: Responder): void {
        if (place !== this.#lastPlace) {
            respond.output((place === "paused")
                ? "The game is paused, so this ran at once, on the instrument's thread."
                : "The game is running again, so this ran on its main thread.");
            this.#lastPlace = place;
        }
    }
}

function classNamed(name: string): Il2Cpp.Class {
    for (const assembly of Il2Cpp.domain.assemblies) {
        const klass = assembly.image.tryClass(name);
        if (klass !== null) {
            return klass;
        }
    }
    throw new Error(`No assembly has a class named ${name}`);
}
