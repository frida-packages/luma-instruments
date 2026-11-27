import type { UnityApi } from "./unity-api.js";

type FactsWidget = CustomInstrumentWidgetMap["facts"];

const FRAME_WINDOW_MS = 2000;

export class GameFacts {
    readonly #widget: FactsWidget;
    readonly #api: UnityApi;
    #frameTimer: ReturnType<typeof setInterval> | null = null;

    constructor(widget: FactsWidget, api: UnityApi) {
        this.#widget = widget;
        this.#api = api;
        widget.clear();
    }

    show(): void {
        const module = Il2Cpp.module;
        const assemblies = Il2Cpp.domain.assemblies;
        this.#set("unity", "Unity", Il2Cpp.unityVersion);
        this.#set("app", "App", `${Il2Cpp.application.identifier} ${Il2Cpp.application.version}`);
        this.#set("data", "Data path", Il2Cpp.application.dataPath ?? "unknown");
        this.#set("module", "IL2CPP code", `${module.name} at ${module.base}, ${(module.size / (1024 * 1024)).toFixed(1)} MiB`);
        this.#set("assemblies", "Assemblies", `${assemblies.length}, with ${assemblies.reduce((sum, each) => sum + each.image.classCount, 0)} classes`);
        this.#set("frames", "Frames", "counting…");
        this.#watchFrames();
    }

    dispose(): void {
        if (this.#frameTimer !== null) {
            clearInterval(this.#frameTimer);
        }
    }

    #set(id: string, fact: string, value: string): void {
        this.#widget.upsertRow({ id, cells: { fact, value } });
    }

    #watchFrames(): void {
        let last = this.#api.frameCount();
        this.#frameTimer = setInterval(() => {
            const frame = this.#api.frameCount();
            const perSecond = (frame - last) * 1000 / FRAME_WINDOW_MS;
            last = frame;
            this.#set("frames", "Frames", (perSecond === 0)
                ? `paused at frame ${frame}; what is meant for the main thread runs at once instead`
                : `${Math.round(perSecond)} a second, at frame ${frame}`);
        }, FRAME_WINDOW_MS);
    }
}
