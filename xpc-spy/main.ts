import { Recorder } from "./recorder.js";
import { ServiceBoard } from "./services.js";
import { Settings } from "./settings.js";
import { XpcTap } from "./traffic.js";

export const instrument: CustomInstrument = {
    create(ctx, config, restored) {
        const settings = new Settings(config);
        const services = new ServiceBoard(ctx.widget("services"), restored.services);
        const recorder = new Recorder(ctx, settings, services);
        const tap = new XpcTap(settings, capture => recorder.record(capture));
        tap.start();

        return {
            updateConfig(next) {
                settings.apply(next);
            },
            onConsoleInput({ text }, respond) {
                const number = text.replace(/^#/, "");
                const event = recorder.recall(Number(number));
                if (event !== undefined) {
                    respond.value(event);
                } else {
                    respond.error(`Message #${number} is not among the most recent ones.`);
                }
            },
            dispose() {
                tap.stop();
                recorder.discard();
            }
        };
    }
};
