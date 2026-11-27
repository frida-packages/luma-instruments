import { backends } from "./backends.js";
import { GraphicsApis } from "./graphics-apis.js";
import { MeshCatalog } from "./mesh-catalog.js";
import { MeshDisplay } from "./mesh-display.js";
import { MeshFinder } from "./mesh-finder.js";
import { MeshTable } from "./mesh-table.js";
import { offerObj } from "./obj-export.js";
import { Settings } from "./settings.js";
import { TextureCatalog } from "./texture-catalog.js";
import { ViewerCommands } from "./viewer-commands.js";

export const instrument: CustomInstrument = {
    create(ctx, config) {
        const settings = new Settings(config);
        const viewer = ctx.widget("viewer");
        const progress = { note: (text: string) => viewer.appendOutput(text) };
        const table = new MeshTable(ctx.widget("meshes"), settings);
        const catalog = new MeshCatalog(table);
        const display = new MeshDisplay(ctx.widget("mesh"));
        const finder = new MeshFinder(catalog, new TextureCatalog(), settings, progress);
        const apis = new GraphicsApis(backends, finder, settings, progress, table);
        const commands = new ViewerCommands(catalog, display, apis);
        const viewerReply = { output: (text: string) => viewer.appendOutput(text), error: (text: string) => viewer.appendError(text) };

        return {
            updateConfig(next) {
                settings.apply(next);
                apis.applySettings();
                table.refilter(catalog.all());
            },
            onAction({ action, item }, respond) {
                if (action === "clear") {
                    viewer.clear();
                    return;
                }
                if (action === "scan") {
                    apis.scan();
                    return;
                }
                if (action === "obj") {
                    const selected = display.selected;
                    if (selected !== null) {
                        offerObj(selected, { ...viewerReply, file: respond.file });
                    }
                    return;
                }
                const mesh = catalog.find(Number(item));
                if (mesh !== undefined) {
                    display.showMesh(mesh);
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
