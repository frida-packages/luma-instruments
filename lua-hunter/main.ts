import { HuntStatus } from "./hunt-status.js";
import { InterpreterTable } from "./interpreter-table.js";
import { LuaConsoles } from "./lua-consoles.js";
import { type HuntLog, LuaHunt } from "./lua-hunt.js";
import { Settings } from "./settings.js";

export const instrument: CustomInstrument = {
    create(ctx, config) {
        const settings = new Settings(config);
        const status = new HuntStatus(ctx.widget("status"));
        const table = new InterpreterTable(ctx.widget("interpreters"));
        const consoles = new LuaConsoles(ctx.children("interpreter"), table, settings);
        const log: HuntLog = { note: text => status.note(text), onStillWaiting: interpreter => consoles.onStillWaiting(interpreter) };
        const hunt = new LuaHunt(settings, log, table);
        table.attach(consoles);
        consoles.attach(hunt);
        hunt.registry.observe(table);
        hunt.registry.observe(consoles);
        hunt.start().catch(error => status.fail(error));

        return {
            updateConfig(next) {
                settings.apply(next);
            },
            onAction(action, respond) {
                if (action.child !== undefined) {
                    consoles.clear(interpreterOf(action.child.id));
                } else if (action.action === "show") {
                    respond.show(consoles.pageOf(interpreterOf(action.item)));
                } else {
                    void hunt.rescan();
                }
            },
            async onConsoleInput({ child, text }, respond) {
                await consoles.handle(interpreterOf(child.id), text, respond);
            },
            dispose() {
                hunt.dispose();
                consoles.dispose();
                table.dispose();
            },
        };

        function interpreterOf(id: string) {
            return hunt.registry.numbered(Number(id))!;
        }
    },
};
