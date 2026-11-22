import type { Outcome } from "./evaluation.js";
import type { InterpreterTable } from "./interpreter-table.js";
import type { Interpreter, InterpreterObserver } from "./interpreters.js";
import type { HuntLog, LuaHunt } from "./lua-hunt.js";
import type { Settings } from "./settings.js";

type ConsoleWidget = CustomInstrumentWidgetMap["console"];
type Responder = CustomInstrumentConsoleResponder;

const WAITING_NOTICE_DELAY_MS = 300;

const helpLines = [
    "Lua typed here runs in the current interpreter, on the thread that owns it, the next time that thread calls into Lua.",
    "An expression shows its value; print() output is shown too. Globals you set are the interpreter's own.",
    ":list            show the interpreters found",
    ":use <number>    run what follows in that interpreter (or use the table's Use action)",
    ":cancel          drop chunks still waiting for the current interpreter",
    ":scan            look through loaded modules and memory again",
    ":now <lua>       run at once on the instrument's own thread; unsafe while the owner is running Lua",
    ":help            show this",
];

export class LuaConsole implements InterpreterObserver, HuntLog {
    private current: Interpreter | null = null;
    private hunt!: LuaHunt;

    constructor(
        private readonly widget: ConsoleWidget,
        private readonly table: InterpreterTable,
        private readonly settings: Settings,
    ) {
    }

    attach(hunt: LuaHunt): void {
        this.hunt = hunt;
    }

    note(text: string): void {
        this.widget.appendOutput(text);
    }

    onStillWaiting(interpreter: Interpreter): void {
        this.widget.appendOutput(`${interpreter.label} still has not come by, while other interpreters keep calling into Lua. `
            + "It may be idle; :cancel drops what is waiting for it.");
    }

    onInterpreterAdded(interpreter: Interpreter): void {
        this.widget.appendOutput(`${describe(interpreter)} found ${sightingLabels[interpreter.sighting]}.`);
        if (this.current === null && interpreter.canRun) {
            this.use(interpreter);
        }
    }

    onInterpreterChanged(interpreter: Interpreter): void {
        if (interpreter === this.current && interpreter.presence === "closed") {
            this.widget.appendError(`${interpreter.label} was closed. :use another one.`);
        }
    }

    statusOf(interpreter: Interpreter): string {
        const pending = this.hunt.rendezvous.pendingFor(interpreter);
        const parts = [
            (interpreter === this.current) ? "● in use" : null,
            (pending !== 0) ? `${pending} waiting` : null,
            presenceLabel(interpreter),
        ];
        return parts.filter(part => part !== null).join(", ");
    }

    use(interpreter: Interpreter): void {
        const previous = this.current;
        this.current = interpreter;
        if (previous !== null) {
            this.table.show(previous);
        }
        this.table.show(interpreter);
        this.widget.appendOutput(`Console now runs in ${describe(interpreter)}.`);
    }

    async handle(text: string, respond: Responder): Promise<void> {
        const trimmed = text.trim();
        if (!trimmed.startsWith(":")) {
            await this.run(trimmed, respond, "owner");
            return;
        }
        const [directive, ...rest] = trimmed.slice(1).split(/\s+/);
        const argument = trimmed.slice(1 + directive.length).trim();
        switch (directive) {
            case "list":
                this.list(respond);
                break;
            case "use":
                this.useNumber(rest[0] ?? "", respond);
                break;
            case "cancel":
                this.cancel(respond);
                break;
            case "scan":
                respond.output("Looking again…");
                await this.hunt.rescan();
                break;
            case "now":
                await this.run(argument, respond, "instrument");
                break;
            case "help":
                helpLines.forEach(line => respond.output(line));
                break;
            default:
                respond.error(`Unknown directive :${directive}. :help lists them.`);
        }
    }

    private run(source: string, respond: Responder, thread: "owner" | "instrument"): Promise<void> {
        const interpreter = this.current;
        if (interpreter === null) {
            respond.error("No interpreter to run in yet. :list shows what was found.");
            return Promise.resolve();
        }
        const executor = interpreter.runtime.executor;
        if (executor === null || !interpreter.canRun) {
            respond.error(cannotRunReason(interpreter));
            return Promise.resolve();
        }
        const limits = { entriesPerTable: this.settings.entriesPerTable };
        if (thread === "instrument") {
            respond.output(`${interpreter.label} on the instrument's thread, unsafely:`);
            report(executor.evaluate(interpreter.main, source, limits), respond);
            return Promise.resolve();
        }
        return new Promise(resolve => {
            const notice = setTimeout(() => {
                respond.output(`Waiting for ${interpreter.label} to call into Lua on its thread…`);
            }, WAITING_NOTICE_DELAY_MS);
            this.hunt.rendezvous.send(interpreter, {
                run: (L, threadId) => {
                    clearTimeout(notice);
                    const outcome = executor.evaluate(L, source, limits);
                    this.hunt.refreshCensus(interpreter, L, threadId);
                    respond.output(`${interpreter.label} on thread ${threadId}:`);
                    report(outcome, respond);
                    this.table.show(interpreter);
                    resolve();
                },
                abandon: reason => {
                    clearTimeout(notice);
                    respond.error(reason);
                    this.table.show(interpreter);
                    resolve();
                },
            });
            this.table.show(interpreter);
        });
    }

    private list(respond: Responder): void {
        const interpreters = this.hunt.registry.all;
        if (interpreters.length === 0) {
            respond.output("No interpreters found yet.");
        }
        for (const interpreter of interpreters) {
            const marker = (interpreter === this.current) ? "●" : " ";
            const census = interpreter.census;
            const globals = (census !== null) ? `, ${census.globals} globals` : "";
            const thread = (interpreter.thread !== null) ? `, thread ${interpreter.thread}` : "";
            respond.output(`${marker} ${describe(interpreter)}${thread}${globals}, ${this.statusOf(interpreter)}`);
        }
    }

    private useNumber(text: string, respond: Responder): void {
        const interpreter = this.hunt.registry.numbered(Number(text.replace(/^#/, "")));
        if (interpreter === undefined) {
            respond.error(`There is no interpreter ${text}. :list shows them.`);
            return;
        }
        this.use(interpreter);
        if (!interpreter.canRun) {
            respond.error(cannotRunReason(interpreter));
        }
    }

    private cancel(respond: Responder): void {
        const interpreter = this.current;
        const dropped = (interpreter !== null) ? this.hunt.rendezvous.recall(interpreter, "Canceled.") : 0;
        respond.output(`Dropped ${dropped} waiting chunk${(dropped === 1) ? "" : "s"}.`);
        if (interpreter !== null) {
            this.table.show(interpreter);
        }
    }
}

const sightingLabels = {
    memory: "in memory",
    creation: "as it was created",
    call: "calling into Lua",
};

function describe(interpreter: Interpreter): string {
    return `${interpreter.label} (${interpreter.runtime.moduleName}, main state ${interpreter.main})`;
}

function presenceLabel(interpreter: Interpreter): string | null {
    if (interpreter.presence === "closed") {
        return "closed";
    }
    if (interpreter.runtime.executor === null) {
        return "cannot run code";
    }
    return (interpreter.presence === "unseen") ? "not seen running yet" : null;
}

function cannotRunReason(interpreter: Interpreter): string {
    if (interpreter.presence === "closed") {
        return `${interpreter.label} was closed.`;
    }
    return `${interpreter.label} is linked into ${interpreter.runtime.moduleName} without symbols, `
        + "and its API functions could not be recovered, so no code can be run in it.";
}

function report(outcome: Outcome, respond: Responder): void {
    if (outcome.kind === "rejected") {
        respond.error(outcome.error);
        return;
    }
    for (const line of outcome.printed) {
        respond.output(line);
    }
    if (outcome.kind === "failed") {
        respond.error((typeof outcome.error === "string") ? outcome.error : `error object: ${JSON.stringify(outcome.error)}`);
        return;
    }
    for (const value of outcome.values) {
        respond.value(value);
    }
}
