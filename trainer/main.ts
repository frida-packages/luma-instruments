import { Settings } from "./settings.js";
import { Trainer } from "./trainer.js";
import { TrainerView } from "./trainer-view.js";

export const instrument: CustomInstrument = {
    create(ctx, config) {
        const settings = new Settings(config);
        const trainer = new Trainer(new TrainerView(ctx), settings);

        return {
            updateConfig(next) {
                settings.apply(next);
            },
            onAction(action) {
                trainer.act(action);
            },
            onConsoleInput({ text }, respond) {
                return trainer.input(text, respond);
            },
            dispose() {
                trainer.dispose();
            },
        };
    },
};
