import { Instrumentation } from "./instrumentation.js";
import { StatusLine } from "./status-line.js";

const FRAMEWORK_NAME = "JavaScriptCore";
const LOAD_POLL_MS = 500;

export const instrument: CustomInstrument = {
    create(ctx, config) {
        const status = new StatusLine(ctx.widget("status"));
        let settings = config.settings;
        let instrumentation: Instrumentation | null = null;
        const startWhenLoaded = () => {
            const module = Process.findModuleByName(FRAMEWORK_NAME);
            if (module === null) {
                return false;
            }
            instrumentation = new Instrumentation(ctx, module, status);
            instrumentation.start(settings);
            return true;
        };
        const poll = startWhenLoaded() ? null : setInterval(() => {
            if (startWhenLoaded()) {
                clearInterval(poll!);
            }
        }, LOAD_POLL_MS);

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
                if (poll !== null) {
                    clearInterval(poll);
                }
                status.dispose();
                await instrumentation?.dispose();
            },
        };
    },
};
