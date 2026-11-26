import type { Outcome } from "./evaluation.js";
import type { InterpreterTable } from "./interpreter-table.js";
import type { Interpreter, InterpreterObserver } from "./interpreters.js";
import type { LuaHunt } from "./lua-hunt.js";
import type { Settings } from "./settings.js";

type Pages = CustomInstrumentChildren<"interpreter">;
type Responder = CustomInstrumentConsoleResponder;
type Badge = NonNullable<CustomInstrumentChildRow["badge"]>;

export type InterpreterPage = CustomInstrumentChild<"interpreter">;

const WAITING_NOTICE_DELAY_MS = 300;
const CLOSED_PAGE_LINGER_MS = 60000;

const helpLines = [
    "Lua typed here runs in this interpreter, on the thread that owns it, the next time that thread calls into Lua.",
    "An expression shows its value; print() output is shown too. Globals you set are the interpreter's own.",
    ":list            show the interpreters found",
    ":cancel          drop chunks still waiting for this interpreter",
    ":scan            look through loaded modules and memory again",
    ":now <lua>       run at once on the instrument's own thread; unsafe while the owner is running Lua",
    ":help            show this",
];

export class LuaConsoles implements InterpreterObserver {
    readonly #pages: Pages;
    readonly #table: InterpreterTable;
    readonly #settings: Settings;
    readonly #closedPageRemovals = new Map<Interpreter, ReturnType<typeof setTimeout>>();
    #hunt!: LuaHunt;

    constructor(
        pages: Pages,
        table: InterpreterTable,
        settings: Settings,
    ) {
        this.#pages = pages;
        this.#table = table;
        this.#settings = settings;
    }

    attach(hunt: LuaHunt): void {
        this.#hunt = hunt;
    }

    onInterpreterAdded(interpreter: Interpreter): void {
        const page = this.#pages.add(pageId(interpreter), this.#rowOf(interpreter));
        page.widget("console").appendOutput(`${describe(interpreter)} found ${sightingLabels[interpreter.sighting]}.`);
    }

    onInterpreterChanged(interpreter: Interpreter): void {
        const page = this.pageOf(interpreter);
        if (page === null) {
            return;
        }
        page.update(this.#rowOf(interpreter));
        if (interpreter.presence === "closed" && !this.#closedPageRemovals.has(interpreter)) {
            page.widget("console").appendError(`${interpreter.label} was closed. Its page goes away in a minute.`);
            this.#closedPageRemovals.set(interpreter, setTimeout(() => this.#removePage(interpreter), CLOSED_PAGE_LINGER_MS));
        }
    }

    onStillWaiting(interpreter: Interpreter): void {
        this.pageOf(interpreter)?.widget("console").appendOutput(`${interpreter.label} still has not come by, `
            + "while other interpreters keep calling into Lua. It may be idle; :cancel drops what is waiting for it.");
    }

    pageOf(interpreter: Interpreter): InterpreterPage | null {
        return this.#pages.get(pageId(interpreter)) ?? null;
    }

    statusOf(interpreter: Interpreter): string {
        const pending = this.#hunt.rendezvous.pendingFor(interpreter);
        const parts = [
            (pending !== 0) ? `${pending} waiting` : null,
            presenceLabel(interpreter),
        ];
        return parts.filter(part => part !== null).join(", ");
    }

    clear(interpreter: Interpreter): void {
        this.pageOf(interpreter)?.widget("console").clear();
    }

    async handle(interpreter: Interpreter, text: string, respond: Responder): Promise<void> {
        const trimmed = text.trim();
        if (!trimmed.startsWith(":")) {
            await this.#run(interpreter, trimmed, respond, "owner");
            return;
        }
        const [directive] = trimmed.slice(1).split(/\s+/);
        const argument = trimmed.slice(1 + directive.length).trim();
        switch (directive) {
            case "list":
                this.#list(interpreter, respond);
                break;
            case "cancel":
                this.#cancel(interpreter, respond);
                break;
            case "scan":
                respond.output("Looking again…");
                await this.#hunt.rescan();
                break;
            case "now":
                await this.#run(interpreter, argument, respond, "instrument");
                break;
            case "help":
                helpLines.forEach(line => respond.output(line));
                break;
            default:
                respond.error(`Unknown directive :${directive}. :help lists them.`);
        }
    }

    dispose(): void {
        for (const removal of this.#closedPageRemovals.values()) {
            clearTimeout(removal);
        }
    }

    #rowOf(interpreter: Interpreter): CustomInstrumentChildRow {
        const { runtime, census } = interpreter;
        const facts = [
            runtime.moduleName,
            `state ${interpreter.main}`,
            (interpreter.thread !== null) ? `thread ${interpreter.thread}` : null,
            (census !== null) ? `${census.globals} globals` : null,
        ];
        return {
            title: interpreter.label,
            subtitle: facts.filter(fact => fact !== null).join(" · "),
            badge: this.#badgeOf(interpreter),
        };
    }

    #badgeOf(interpreter: Interpreter): Badge {
        if (interpreter.presence === "closed") {
            return { text: "closed", tone: "ended" };
        }
        if (interpreter.runtime.executor === null) {
            return { text: "cannot run code", tone: "failed" };
        }
        const pending = this.#hunt.rendezvous.pendingFor(interpreter);
        if (pending !== 0) {
            return { text: `${pending} waiting`, tone: "waiting" };
        }
        return (interpreter.presence === "seen") ? { text: "seen", tone: "active" } : { text: "not seen yet", tone: "neutral" };
    }

    #removePage(interpreter: Interpreter): void {
        this.#closedPageRemovals.delete(interpreter);
        this.#pages.remove(pageId(interpreter));
    }

    #run(interpreter: Interpreter, source: string, respond: Responder, thread: "owner" | "instrument"): Promise<void> {
        const executor = interpreter.runtime.executor;
        if (executor === null || !interpreter.canRun) {
            respond.error(cannotRunReason(interpreter));
            return Promise.resolve();
        }
        const limits = { entriesPerTable: this.#settings.entriesPerTable };
        if (thread === "instrument") {
            respond.output(`${interpreter.label} on the instrument's thread, unsafely:`);
            report(executor.evaluate(interpreter.main, source, limits), respond);
            return Promise.resolve();
        }
        return new Promise(resolve => {
            const notice = setTimeout(() => {
                respond.output(`Waiting for ${interpreter.label} to call into Lua on its thread…`);
            }, WAITING_NOTICE_DELAY_MS);
            this.#hunt.rendezvous.send(interpreter, {
                run: (L, threadId) => {
                    clearTimeout(notice);
                    const outcome = executor.evaluate(L, source, limits);
                    this.#hunt.refreshCensus(interpreter, L, threadId);
                    respond.output(`${interpreter.label} on thread ${threadId}:`);
                    report(outcome, respond);
                    this.#showPending(interpreter);
                    resolve();
                },
                abandon: reason => {
                    clearTimeout(notice);
                    respond.error(reason);
                    this.#showPending(interpreter);
                    resolve();
                },
            });
            this.#showPending(interpreter);
        });
    }

    #list(current: Interpreter, respond: Responder): void {
        for (const interpreter of this.#hunt.registry.all) {
            const marker = (interpreter === current) ? "●" : " ";
            const census = interpreter.census;
            const globals = (census !== null) ? `, ${census.globals} globals` : "";
            const thread = (interpreter.thread !== null) ? `, thread ${interpreter.thread}` : "";
            respond.output(`${marker} ${describe(interpreter)}${thread}${globals}, ${this.statusOf(interpreter)}`);
        }
    }

    #cancel(interpreter: Interpreter, respond: Responder): void {
        const dropped = this.#hunt.rendezvous.recall(interpreter, "Canceled.");
        respond.output(`Dropped ${dropped} waiting chunk${(dropped === 1) ? "" : "s"}.`);
        this.#showPending(interpreter);
    }

    #showPending(interpreter: Interpreter): void {
        this.#table.show(interpreter);
        this.pageOf(interpreter)?.update({ badge: this.#badgeOf(interpreter) });
    }
}

const sightingLabels = {
    memory: "in memory",
    creation: "as it was created",
    call: "calling into Lua",
};

function pageId(interpreter: Interpreter): string {
    return String(interpreter.number);
}

function describe(interpreter: Interpreter): string {
    return `${interpreter.label} (${interpreter.runtime.moduleName}, main state ${interpreter.main})`;
}

function presenceLabel(interpreter: Interpreter): string {
    if (interpreter.presence === "closed") {
        return "closed";
    }
    if (interpreter.runtime.executor === null) {
        return "cannot run code";
    }
    return (interpreter.presence === "unseen") ? "not seen running yet" : "seen running";
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
