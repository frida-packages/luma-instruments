import { InterpreterTable } from "./interpreter-table.js";
import { LuaConsole } from "./lua-console.js";
import { LuaHunt } from "./lua-hunt.js";
import { Settings } from "./settings.js";

export const instrument: CustomInstrument = {
    async create(ctx, config) {
        const settings = new Settings(config);
        const table = new InterpreterTable(ctx.widget("interpreters"));
        const luaConsole = new LuaConsole(ctx.widget("console"), table, settings);
        const hunt = new LuaHunt(settings, luaConsole);
        table.attach(luaConsole);
        luaConsole.attach(hunt);
        hunt.registry.observe(table);
        hunt.registry.observe(luaConsole);
        await hunt.start();

        return {
            updateConfig(next) {
                settings.apply(next);
            },
            onAction({ item }) {
                luaConsole.use(hunt.registry.numbered(Number(item))!);
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
