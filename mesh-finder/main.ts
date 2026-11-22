import { backends } from "./backends.js";
import { GraphicsApis } from "./graphics-apis.js";
import { MeshCatalog } from "./mesh-catalog.js";
import { MeshDisplay } from "./mesh-display.js";
import { MeshFinder } from "./mesh-finder.js";
import { MeshTable } from "./mesh-table.js";
import { Settings } from "./settings.js";
import { ViewerCommands } from "./viewer-commands.js";

export const instrument: CustomInstrument = {
    create(ctx, config) {
        const settings = new Settings(config);
        const viewer = ctx.widget("viewer");
        const progress = { note: (text: string) => viewer.appendOutput(text) };
        const table = new MeshTable(ctx.widget("meshes"), settings);
        const catalog = new MeshCatalog(table);
        const display = new MeshDisplay(ctx.widget("mesh"), viewer);
        const finder = new MeshFinder(catalog, settings, progress);
        const apis = new GraphicsApis(backends, finder, settings, progress);
        const commands = new ViewerCommands(catalog, display, apis);
        const viewerReply = { output: (text: string) => viewer.appendOutput(text), error: (text: string) => viewer.appendError(text) };

        return {
            updateConfig(next) {
                settings.apply(next);
                apis.applySettings();
                table.refilter(catalog.all());
            },
            onAction({ action, item }) {
                const mesh = catalog.find(Number(item));
                if (mesh === undefined) {
                    return;
                }
                if (action === "show") {
                    display.showMesh(mesh);
                } else {
                    commands.exportObj(mesh, viewerReply);
                }
            },
            onConsoleInput({ text }, respond) {
                commands.run(text, respond);
            },
            dispose() {
                apis.dispose();
                finder.dispose();
                table.dispose();
            },
        };
    },
};
