import { ServiceCatalog } from "./catalog.js";
import { ConnectionBook } from "./connections.js";
import { Explorer } from "./explorer.js";
import { IOApi } from "./io-api.js";
import { RateWindow } from "./rate-window.js";
import { Recorder } from "./recorder.js";
import { Settings } from "./settings.js";
import { IOKitTap } from "./tap.js";

export const instrument: CustomInstrument = {
    create(ctx, config, restored) {
        const settings = new Settings(config);
        const rate = new RateWindow(() => settings.callsPerSecond);
        const catalog = new ServiceCatalog(ctx.widget("services"));
        const connections = new ConnectionBook(ctx.widget("connections"), id => catalog.providerOf(id));
        const recorder = new Recorder(ctx, settings, rate, connections, restored);
        const tap = new IOKitTap(settings, rate, connections, observation => recorder.record(observation));
        const api = new IOApi(connections, catalog, seq => recorder.recall(seq), () => recorder.publishSoon());
        const explorer = new Explorer(ctx.widget("explorer"), api);
        catalog.scan();
        tap.start();
        recorder.announce(connections.adoptExisting());
        explorer.announce();

        return {
            updateConfig(next) {
                settings.apply(next);
            },
            onAction(action) {
                switch (action.widget) {
                    case "methods":
                    case "lookups":
                    case "properties":
                        recorder.clear(action.widget);
                        break;
                    case "log":
                        recorder.clearLog();
                        break;
                    case "explorer":
                        explorer.clear();
                        break;
                    case "services":
                        chooseService(action, catalog, explorer);
                        break;
                }
            },
            onConsoleInput({ widget, text }, respond) {
                if (widget === "explorer") {
                    explorer.handle(text, respond);
                } else {
                    inspect(text, recorder, respond);
                }
            },
            dispose() {
                tap.stop();
                recorder.discard();
                explorer.dispose();
            }
        };
    }
};

function chooseService(action: CustomInstrumentActionMap["services"], catalog: ServiceCatalog, explorer: Explorer): void {
    switch (action.action) {
        case "rescan":
            catalog.scan();
            break;
        case "showProperties":
            explorer.showProperties(action.item);
            break;
        case "open":
            explorer.open(action.item);
            break;
    }
}

function inspect(text: string, recorder: Recorder, respond: CustomInstrumentConsoleResponder): void {
    const number = text.trim().replace(/^#/, "");
    const event = recorder.recall(Number(number));
    if (event !== undefined) {
        respond.value(event);
    } else {
        respond.error(`#${number} is not among the most recent ones.`);
    }
}
