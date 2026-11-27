import type { KitReply } from "./context-kit.js";
import type { ContextSessions } from "./context-sessions.js";
import type { Context, ContextRegistry } from "./contexts.js";

export interface ConsoleReply {
    output(text: string): void;
    error(text: string): void;
    value(value: unknown): void;
}

const HELP = [
    "JavaScript typed here is evaluated in this context's global scope; the value of the last expression comes back.",
    ":list   lists the contexts, this one marked with ●",
    ":facts  shows what this context says about itself",
    ":help   says all this",
].join("\n");

export class ContextConsole {
    readonly #registry: ContextRegistry;
    readonly #sessions: ContextSessions;

    constructor(registry: ContextRegistry, sessions: ContextSessions) {
        this.#registry = registry;
        this.#sessions = sessions;
    }

    async run(context: Context, text: string, reply: ConsoleReply): Promise<void> {
        switch (text.trim()) {
            case ":help":
                reply.output(HELP);
                return;
            case ":list":
                reply.output(this.#listing(context));
                return;
            case ":facts":
                reply.value(await this.#facts(context));
                return;
        }
        if (context.destroyed) {
            reply.error("This context was destroyed.");
            return;
        }
        if (!context.evaluable) {
            reply.error(`This context is a ${context.className}, whose thread the instrument does not evaluate on.`);
            return;
        }
        show(await this.#sessions.evaluate(context, text), reply);
    }

    #listing(current: Context): string {
        return this.#registry.contexts
            .map(context => `${(context === current) ? "●" : " "} ${context.title}  ${context.className}  VM #${context.vm.serial}`
                + (context.destroyed ? "  destroyed" : ""))
            .join("\n");
    }

    async #facts(context: Context): Promise<Record<string, unknown>> {
        const facts: Record<string, unknown> = {
            address: context.address,
            kind: context.kind,
            classes: context.classChain,
            name: context.name,
            vm: context.vm.serial,
            evaluatesOn: context.runsOn,
            inspectable: context.inspectable,
            found: (context.discovery === "scan") ? "by scanning memory" : "when it was made",
        };
        if (context.evaluable && !context.destroyed) {
            facts.reported = await this.#sessions.facts(context);
        }
        return facts;
    }
}

function show(reply: KitReply, console: ConsoleReply): void {
    for (const line of reply.printed ?? []) {
        console.output(line);
    }
    switch (reply.kind) {
        case "value":
            console.value(reply.value);
            break;
        case "pending":
            console.output(`Promise ${reply.id} is pending; its outcome will be shown here.`);
            break;
        default:
            console.error(reply.error!);
    }
}
