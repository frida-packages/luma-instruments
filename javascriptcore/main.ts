import { FrameworkWatch } from "./framework-watch.js";
import { Instrumentation } from "./instrumentation.js";
import { StatusLine } from "./status-line.js";

export const instrument: CustomInstrument = {
    create(ctx, config) {
        const status = new StatusLine(ctx.widget("status"));
        let settings = config.settings;
        let instrumentation: Instrumentation | null = null;
        const watch = new FrameworkWatch(framework => {
            instrumentation = new Instrumentation(ctx, framework, status);
            instrumentation.start(settings);
        });
        watch.start();

        return {
            updateConfig(next) {
                settings = next.settings;
                instrumentation?.configure(settings);
            },
            onAction(action, respond) {
                if (instrumentation === null) {
                    return;
                }
                if (action.child !== undefined) {
                    instrumentation.clearConsole(action.child.id);
                    return;
                }
                return instrumentation.act(action, respond);
            },
            onConsoleInput({ child, text }, respond) {
                if (instrumentation === null) {
                    respond.error("JavaScriptCore is not loaded yet.");
                    return;
                }
                return instrumentation.input(child.id, text, respond);
            },
            async dispose() {
                watch.dispose();
                status.dispose();
                await instrumentation?.dispose();
            },
        };
    },
};
