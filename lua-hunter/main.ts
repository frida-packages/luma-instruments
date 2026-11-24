import { InterpreterTable } from "./interpreter-table.js";
import { LuaConsole } from "./lua-console.js";
import { LuaHunt } from "./lua-hunt.js";
import { Settings } from "./settings.js";

export const instrument: CustomInstrument = {
    create(ctx, config) {
        const settings = new Settings(config);
        const table = new InterpreterTable(ctx.widget("interpreters"));
        const luaConsole = new LuaConsole(ctx.widget("console"), table, settings);
        const hunt = new LuaHunt(settings, luaConsole, table);
        table.attach(luaConsole);
        luaConsole.attach(hunt);
        hunt.registry.observe(table);
        hunt.registry.observe(luaConsole);
        hunt.start().catch(error => luaConsole.fail(error));

        return {
            updateConfig(next) {
                settings.apply(next);
            },
            onAction({ action, item }) {
                switch (action) {
                    case "use":
                        luaConsole.use(hunt.registry.numbered(Number(item))!);
                        break;
                    case "scan":
                        void hunt.rescan();
                        break;
                    case "clear":
                        luaConsole.clear();
                        break;
                }
            },
            async onConsoleInput({ text }, respond) {
                await luaConsole.handle(text, respond);
            },
            dispose() {
                hunt.dispose();
                table.dispose();
            },
        };
    },
};
