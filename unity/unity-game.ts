import { AssemblyTable } from "./assembly-table.js";
import { CallLog } from "./call-log.js";
import { GameFacts } from "./game-facts.js";
import { GameThread } from "./game-thread.js";
import { JsConsole } from "./js-console.js";
import { MethodTrace } from "./method-trace.js";
import { ScenePages } from "./scene-pages.js";
import type { Settings } from "./settings.js";
import type { StatusLine } from "./status-line.js";
import { resolveUnityApi } from "./unity-api.js";
import { ValueText } from "./value-text.js";

interface ViewRequest {
    inspect?: number;
}

export class UnityGame {
    readonly #status: StatusLine;
    readonly #thread: GameThread;
    readonly #values: ValueText;
    readonly #facts: GameFacts;
    readonly #assemblies: AssemblyTable;
    readonly #scenes: ScenePages;
    readonly #log: CallLog;
    readonly #trace: MethodTrace;
    readonly #console: JsConsole;

    constructor(ctx: CustomInstrumentContext, settings: Settings, status: StatusLine) {
        const api = resolveUnityApi();
        this.#status = status;
        this.#thread = new GameThread(api);
        this.#values = new ValueText(api, settings.charsPerValue);
        this.#facts = new GameFacts(ctx.widget("facts"), api);
        this.#assemblies = new AssemblyTable(ctx.widget("assemblies"), status);
        this.#scenes = new ScenePages(ctx.widget("scenes"), ctx.children("scene"), this.#thread, api, this.#values, status);
        this.#log = new CallLog(ctx.widget("calls"), ctx.widget("hits"), status);
        this.#trace = new MethodTrace(this.#log, this.#values, status);
        this.#console = new JsConsole(ctx.widget("console"), this.#thread, api, this.#values);
    }

    start(): void {
        this.#facts.show();
        this.#assemblies.show();
        this.#scenes.watch();
        this.#console.announce();
    }

    reconfigure(settings: Settings): void {
        this.#values.limit = settings.charsPerValue;
        this.#trace.apply(settings);
    }

    async onAction(action: CustomInstrumentAction, respond: CustomInstrumentActionResponder): Promise<void> {
        if (action.child !== undefined) {
            await this.#scenes.refresh(action.child.id);
            return;
        }
        switch (action.widget) {
            case "scenes":
                respond.show(this.#scenes.pageOf(action.item));
                break;
            case "assemblies":
                if (action.action === "dump") {
                    this.#assemblies.saveAll(respond.file);
                } else {
                    this.#assemblies.saveOne(action.item, respond.file);
                }
                break;
            case "calls":
                this.#onCallsAction(action.action);
                break;
            case "console":
                this.#console.clear();
                break;
        }
    }

    async onConsoleInput(text: string, respond: CustomInstrumentConsoleResponder): Promise<void> {
        await this.#console.handle(text, respond);
    }

    async onViewMessage(message: CustomInstrumentViewMessage): Promise<void> {
        const { inspect } = message.value as ViewRequest;
        if (message.child !== undefined && inspect !== undefined) {
            await this.#scenes.inspect(message.child.id, inspect).catch(error => {
                this.#status.note("scenes", `Could not read GameObject #${inspect}: ${error.message}`, error.stack);
            });
        }
    }

    dispose(): void {
        this.#trace.dispose();
        this.#log.dispose();
        this.#scenes.dispose();
        this.#facts.dispose();
        this.#thread.dispose();
    }

    #onCallsAction(action: "pause" | "resume" | "clear"): void {
        switch (action) {
            case "pause":
                this.#log.pause();
                break;
            case "resume":
                this.#log.resume();
                break;
            case "clear":
                this.#log.clear();
                break;
        }
    }
}
