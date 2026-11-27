import type { Settlement } from "./context-kit.js";
import type { Context, ContextObserver } from "./contexts.js";

type ContextChildren = CustomInstrumentChildren<"context">;
type ContextPage = CustomInstrumentChild<"context">;
type Badge = NonNullable<CustomInstrumentChildRow["badge"]>;

export interface Activity {
    running: number;
    awaiting: number;
}

export class ContextPages implements ContextObserver {
    readonly #children: ContextChildren;
    readonly #contexts = new Map<string, Context>();
    readonly #activity = new Map<Context, Activity>();

    constructor(children: ContextChildren) {
        this.#children = children;
    }

    show(context: Context): ContextPage {
        const id = String(context.serial);
        this.#contexts.set(id, context);
        return this.#children.add(id, this.#rowOf(context));
    }

    contextOf(id: string): Context | undefined {
        return this.#contexts.get(id);
    }

    pageOf(context: Context): ContextPage | undefined {
        return this.#children.get(String(context.serial));
    }

    onContextChanged(context: Context): void {
        this.pageOf(context)?.update(this.#rowOf(context));
    }

    onContextRemoved(context: Context): void {
        this.#contexts.delete(String(context.serial));
        this.#activity.delete(context);
        this.#children.remove(String(context.serial));
    }

    showActivity(context: Context, activity: Activity): void {
        this.#activity.set(context, activity);
        this.onContextChanged(context);
    }

    showSettlement(context: Context, settlement: Settlement): void {
        const console = this.pageOf(context)?.widget("console");
        if (console === undefined) {
            return;
        }
        if (settlement.kind === "value") {
            console.appendOutput(`Promise ${settlement.id} resolved:`);
            console.appendValue(settlement.value);
        } else {
            console.appendError(`Promise ${settlement.id} rejected: ${settlement.error}`);
        }
    }

    #rowOf(context: Context): CustomInstrumentChildRow {
        return {
            title: context.title,
            subtitle: `${context.className} · VM #${context.vm.serial} · evaluates on ${context.runsOn}`,
            badge: badgeOf(context, this.#activity.get(context) ?? { running: 0, awaiting: 0 }),
        };
    }
}

function badgeOf(context: Context, { running, awaiting }: Activity): Badge {
    if (context.destroyed) {
        return { text: "destroyed", tone: "ended" };
    }
    if (!context.evaluable) {
        return { text: "not evaluated", tone: "failed" };
    }
    if (running !== 0) {
        return { text: "evaluating", tone: "waiting" };
    }
    if (awaiting !== 0) {
        return { text: `${awaiting} promise${(awaiting === 1) ? "" : "s"} pending`, tone: "waiting" };
    }
    return { text: "ready", tone: "active" };
}
