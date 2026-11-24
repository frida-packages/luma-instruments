import { Inventory } from "./inventory.js";
import { Scanner } from "./scan.js";
import { CertificateView } from "./view.js";

export const instrument: CustomInstrument = {
    create(ctx, config) {
        const view = new CertificateView(ctx);
        const inventory = new Inventory(ctx, view);
        const scanner = new Scanner(inventory);
        let scope = config.settings.scope;
        scanner.start(scope);

        return {
            updateConfig(next) {
                if (next.settings.scope !== scope) {
                    scope = next.settings.scope;
                    scanner.start(scope);
                }
            },
            onAction({ action, item }) {
                switch (action) {
                    case "rescan":
                        scanner.start(scope);
                        break;
                    case "inspect": {
                        const entry = inventory.find(item);
                        if (entry !== undefined) {
                            view.inspect(entry);
                        }
                        break;
                    }
                    case "clear":
                        view.clearDetails();
                        break;
                }
            },
            onConsoleInput({ text }, respond) {
                view.answer(text, inventory.search(text), respond);
            },
            dispose() {
                scanner.stop();
                view.dispose();
            },
        };
    },
};
