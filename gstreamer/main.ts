import { GraphDisplay } from "./graph-display.js";
import { PipelineTable } from "./pipeline-table.js";
import { PipelineWatch } from "./pipeline-watch.js";
import { ScanStatus } from "./scan-status.js";
import { Settings } from "./settings.js";

export const instrument: CustomInstrument = {
    create(ctx, config) {
        const settings = new Settings(config);
        const status = new ScanStatus(ctx.widget("scan"));
        const table = new PipelineTable(ctx.widget("pipelines"), status);
        const graph = new GraphDisplay(ctx.widget("graph"));
        const watch = new PipelineWatch(status, table, graph, settings);
        watch.start();

        return {
            updateConfig(next) {
                const previousDetails = settings.details;
                settings.apply(next);
                watch.applySettings(previousDetails);
            },
            onAction({ action, item }) {
                if (action === "show") {
                    watch.show(item);
                } else {
                    watch.rescan();
                }
            },
            dispose() {
                watch.dispose();
            },
        };
    },
};
