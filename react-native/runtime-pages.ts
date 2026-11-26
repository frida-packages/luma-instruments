import type { Rendezvous } from "./rendezvous.js";
import { architectureLabel, engineLabel, reactNativeLabel, threadLabel } from "./runtime-descriptions.js";
import type { KitReply, Settlement } from "./runtime-kit.js";
import type { RuntimeSessions } from "./runtime-sessions.js";
import type { RuntimeTable } from "./runtime-table.js";
import { readableTypeName } from "./rtti.js";
import { type Runtime, runtimeLabel, type RuntimeObserver, type RuntimeRegistry } from "./runtimes.js";

type Pages = CustomInstrumentChildren<"runtime">;
type Responder = CustomInstrumentConsoleResponder;
type Badge = NonNullable<CustomInstrumentChildRow["badge"]>;

export type RuntimePage = CustomInstrumentChild<"runtime">;

export interface Rescanner {
    rescan(): Promise<void>;
}

const WAITING_NOTICE_DELAY_MS = 300;
const LONGEST_SUBTITLE = 200;

const helpLines = [
    "JavaScript typed here is evaluated in this runtime's global scope, on the thread that owns it.",
    "An expression shows its value; console.log output is shown too. A promise is shown when it settles.",
    ":list            show the runtimes found",
    ":facts           show what this runtime says about itself",
    ":cancel          drop what is still waiting for this runtime",
    ":scan            look through memory for runtimes again",
    ":help            show this",
];

export class RuntimePages implements RuntimeObserver {
    readonly #pages: Pages;
    readonly #table: RuntimeTable;
    readonly #registry: RuntimeRegistry;
    readonly #failuresTold = new Set<Runtime>();
    #rendezvous!: Rendezvous;
    #sessions!: RuntimeSessions;
    #rescanner!: Rescanner;

    constructor(pages: Pages, table: RuntimeTable, registry: RuntimeRegistry) {
        this.#pages = pages;
        this.#table = table;
        this.#registry = registry;
    }

    attach(rendezvous: Rendezvous, sessions: RuntimeSessions, rescanner: Rescanner): void {
        this.#rendezvous = rendezvous;
        this.#sessions = sessions;
        this.#rescanner = rescanner;
    }

    onRuntimeAdded(runtime: Runtime): void {
        const page = this.#pages.add(pageId(runtime), this.#rowOf(runtime));
        const { typeName, base } = runtime.runtimeClass;
        page.widget("console").appendOutput(`${describe(runtime)} found: a ${readableTypeName(typeName)} in ${base.module.name}, `
            + `its JSI entry points found through ${base.route}.`);
    }

    onRuntimeChanged(runtime: Runtime): void {
        const page = this.pageOf(runtime);
        if (page === null) {
            return;
        }
        page.update(this.#rowOf(runtime));
        if (runtime.presence === "closed") {
            page.widget("console").appendError(`${runtimeLabel(runtime)} was destroyed.`);
        }
        if (runtime.kit === "failed" && !this.#failuresTold.has(runtime)) {
            this.#failuresTold.add(runtime);
            page.widget("console").appendError(`${runtimeLabel(runtime)} cannot evaluate: ${runtime.failure}`);
        }
    }

    onSettled(runtime: Runtime, settlement: Settlement): void {
        const console = this.pageOf(runtime)?.widget("console");
        if (console === undefined) {
            return;
        }
        if (settlement.kind === "error") {
            console.appendError(`Promise ${settlement.id} was rejected: ${settlement.error}`);
        } else {
            console.appendOutput(`Promise ${settlement.id} was fulfilled with:`);
            console.appendValue(settlement.value);
        }
    }

    pageOf(runtime: Runtime): RuntimePage | null {
        return this.#pages.get(pageId(runtime)) ?? null;
    }

    statusOf(runtime: Runtime): string {
        return this.#badgeOf(runtime).text;
    }

    clear(runtime: Runtime): void {
        this.pageOf(runtime)?.widget("console").clear();
    }

    async handle(runtime: Runtime, text: string, respond: Responder): Promise<void> {
        const trimmed = text.trim();
        if (!trimmed.startsWith(":")) {
            await this.#evaluate(runtime, trimmed, respond);
            return;
        }
        const [directive] = trimmed.slice(1).split(/\s+/);
        switch (directive) {
            case "list":
                this.#list(runtime, respond);
                break;
            case "facts":
                respond.value(runtime.facts ?? "This runtime has not said anything about itself yet.");
                break;
            case "cancel":
                this.#cancel(runtime, respond);
                break;
            case "scan":
                respond.output("Looking again…");
                await this.#rescanner.rescan();
                break;
            case "help":
                helpLines.forEach(line => respond.output(line));
                break;
            default:
                respond.error(`Unknown directive :${directive}. :help lists them.`);
        }
    }

    #rowOf(runtime: Runtime): CustomInstrumentChildRow {
        const facts = [
            engineLabel(runtime),
            (runtime.facts?.reactNative != null) ? `React Native ${reactNativeLabel(runtime.facts)}` : null,
            (runtime.facts !== null) ? architectureLabel(runtime.facts) : null,
            (runtime.owner !== null) ? `thread ${threadLabel(runtime)}` : null,
            runtime.address.toString(),
        ];
        return {
            title: runtimeLabel(runtime),
            subtitle: facts.filter(fact => fact !== null).join(" · ").slice(0, LONGEST_SUBTITLE),
            badge: this.#badgeOf(runtime),
        };
    }

    #badgeOf(runtime: Runtime): Badge {
        if (runtime.presence === "closed") {
            return { text: "destroyed", tone: "ended" };
        }
        if (runtime.kit === "failed") {
            return { text: "cannot evaluate", tone: "failed" };
        }
        const pending = this.#rendezvous.waitingFor(runtime);
        if (pending !== 0) {
            return { text: `${pending} waiting`, tone: "waiting" };
        }
        if (runtime.presence === "seen") {
            return { text: "seen", tone: "active" };
        }
        return { text: (runtime.ownership === "presumed") ? "thread presumed" : "not seen yet", tone: "neutral" };
    }

    async #evaluate(runtime: Runtime, source: string, respond: Responder): Promise<void> {
        if (runtime.presence === "closed") {
            respond.error(`${runtimeLabel(runtime)} was destroyed.`);
            return;
        }
        const notice = setTimeout(() => {
            respond.output(`Waiting for ${runtimeLabel(runtime)} to come by on its thread…`);
        }, WAITING_NOTICE_DELAY_MS);
        this.#showPending(runtime);
        try {
            report(runtime, await this.#sessions.evaluate(runtime, source), respond);
        } catch (e) {
            respond.error((e instanceof Error) ? e.message : String(e));
        } finally {
            clearTimeout(notice);
            this.#showPending(runtime);
        }
    }

    #list(current: Runtime, respond: Responder): void {
        for (const runtime of this.#registry.all) {
            const marker = (runtime === current) ? "●" : " ";
            respond.output(`${marker} ${describe(runtime)}, ${this.statusOf(runtime)}`);
        }
    }

    #cancel(runtime: Runtime, respond: Responder): void {
        const dropped = this.#rendezvous.recall(runtime, "Canceled.");
        respond.output(`Dropped ${dropped} waiting evaluation${(dropped === 1) ? "" : "s"}.`);
        this.#showPending(runtime);
    }

    #showPending(runtime: Runtime): void {
        this.#table.show(runtime);
        this.pageOf(runtime)?.update({ badge: this.#badgeOf(runtime) });
    }
}

function pageId(runtime: Runtime): string {
    return String(runtime.number);
}

function describe(runtime: Runtime): string {
    return `${runtimeLabel(runtime)} (${runtime.runtimeClass.base.module.name}, ${runtime.address})`;
}


function report(runtime: Runtime, reply: KitReply, respond: Responder): void {
    for (const line of reply.printed ?? []) {
        respond.output(line);
    }
    switch (reply.kind) {
        case "value":
            respond.value(reply.value);
            break;
        case "pending":
            respond.output(`A promise (${reply.id}); its outcome is shown here when it settles.`);
            break;
        case "missing":
            respond.error(`${runtimeLabel(runtime)} lost the instrument's helpers, as when its JavaScript is reloaded. Try again.`);
            break;
        case "error":
            respond.error(reply.error ?? "unknown error");
            break;
    }
}
