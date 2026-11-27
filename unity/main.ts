import "frida-il2cpp-bridge";
import { Settings } from "./settings.js";
import { StatusLine } from "./status-line.js";
import { UnityGame } from "./unity-game.js";

const MONO_MODULES = ["libmonobdwgc-2.0.dylib", "mono-2.0-bdwgc.dll", "libmonobdwgc-2.0.so", "mono.dll", "libmono.so"];

export const instrument: CustomInstrument = {
    create(ctx, config) {
        const settings = new Settings(config);
        const status = new StatusLine(ctx.widget("status"));
        const mono = MONO_MODULES.map(name => Process.findModuleByName(name)).find(module => module !== null);
        if (mono !== undefined) {
            status.note("runtime", `This Unity game runs its scripts on Mono, in ${mono.name}`,
                "The instrument reads IL2CPP builds only, those with a GameAssembly or UnityFramework module.");
            return {};
        }
        let game: UnityGame | null = null;
        let disposed = false;
        status.note("runtime", "Waiting for IL2CPP to start…", "Its module, GameAssembly or UnityFramework, is looked for as it loads.");
        Il2Cpp.perform(() => {
            if (disposed) {
                return;
            }
            game = new UnityGame(ctx, settings, status);
            game.start();
            game.reconfigure(settings);
            status.note("runtime", `Unity ${Il2Cpp.unityVersion}, ${Il2Cpp.application.identifier} ${Il2Cpp.application.version}`,
                `IL2CPP in ${Il2Cpp.module.name}, at ${Il2Cpp.module.base}`);
        }).catch(error => status.note("runtime", `IL2CPP could not be read: ${error.message}`, error.stack));

        return {
            updateConfig(next) {
                settings.apply(next);
                game?.reconfigure(settings);
            },
            async onAction(action, respond) {
                await game?.onAction(action, respond);
            },
            async onConsoleInput(input, respond) {
                if (game === null) {
                    respond.error("IL2CPP has not started in this process yet.");
                    return;
                }
                await game.onConsoleInput(input.text, respond);
            },
            async onViewMessage(message) {
                await game?.onViewMessage(message);
            },
            dispose() {
                disposed = true;
                game?.dispose();
            },
        };
    },
};
