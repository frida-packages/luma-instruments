import { revive, summarize } from "./revived-values.js";
import type { ContentsSnapshot, Drained, Evaluation, RuntimeLink } from "./runtime-link.js";

type ContentsWidget = CustomInstrumentWidgetMap["contents"];
type Pages = CustomInstrumentChildren<"contents">;
type Responder = CustomInstrumentConsoleResponder;
type Badge = NonNullable<CustomInstrumentChildRow["badge"]>;

export type ContentsPage = CustomInstrumentChild<"contents">;

interface Known {
    snapshot: ContentsSnapshot;
    destroyed: boolean;
    shown: string;
    preferencesShown: string;
}

const GONE_PAGE_LINGER_MS = 60000;
const TITLE_CHARS = 120;
const SUBTITLE_CHARS = 200;
const BADGE_CHARS = 32;
const TITLE_SEPARATORS = [" - ", " – ", " — ", " | "];

const helpLines = [
    "JavaScript typed here runs in this page's main world, as the page's own scripts do; promises are awaited.",
    "Variables declared with var, and properties of window, stay for later inputs.",
    ":preload <js>    run in the preload's isolated world (contextIsolation), where contextBridge and, without the sandbox, require live",
    ":help            show this",
];

export class WebContentsView {
    readonly #table: ContentsWidget;
    readonly #pages: Pages;
    readonly #link: RuntimeLink;
    readonly #appName: string;
    readonly #known = new Map<number, Known>();
    readonly #pageRemovals = new Map<number, ReturnType<typeof setTimeout>>();
    readonly #cspNoted = new Set<number>();

    constructor(table: ContentsWidget, pages: Pages, link: RuntimeLink, appName: string) {
        this.#table = table;
        this.#pages = pages;
        this.#link = link;
        this.#appName = appName;
        table.clear();
    }

    take({ contents, gone }: Drained): void {
        if (contents !== null) {
            this.#showAll(contents);
        }
        for (const { id } of gone) {
            this.#markDestroyed(id);
        }
    }

    label(id: number | null): string {
        if (id === null) {
            return "no web contents";
        }
        const known = this.#known.get(id);
        return (known !== undefined) ? `#${id} (${titleOf(known.snapshot)})` : `#${id}`;
    }

    pageOf(id: number): ContentsPage | null {
        return this.#pages.get(String(id)) ?? null;
    }

    async openDevTools(id: number, page: ContentsPage | null): Promise<void> {
        const outcome = await this.#link.openDevTools(id);
        const console = page?.widget("console");
        if (outcome.ok) {
            console?.appendOutput("Opened DevTools in a window of its own.");
        } else {
            console?.appendError(outcome.error!);
        }
    }

    async handle(id: number, text: string, respond: Responder): Promise<void> {
        const trimmed = text.trim();
        if (trimmed === ":help") {
            helpLines.forEach(line => respond.output(line));
            return;
        }
        if (trimmed.startsWith(":preload")) {
            report(await this.#link.evaluateIn(id, "preload", trimmed.slice(":preload".length)), respond);
            return;
        }
        if (trimmed.startsWith(":")) {
            respond.error(`Unknown directive ${trimmed.split(/\s/)[0]}. :help lists them.`);
            return;
        }
        if (this.#known.get(id)?.destroyed) {
            respond.error(`${this.label(id)} was destroyed.`);
            return;
        }
        const outcome = await this.#link.evaluateIn(id, "page", text);
        if (outcome.note === "csp" && !this.#cspNoted.has(id)) {
            this.#cspNoted.add(id);
            respond.output("This page's Content Security Policy forbids eval, so what you type runs as a script of its own, "
                + "and its value is copied out as Electron copies it: var declarations stay, but a DOM node or a function comes back empty.");
        }
        report(outcome, respond);
    }

    clear(id: number): void {
        this.pageOf(id)?.widget("console").clear();
    }

    dispose(): void {
        for (const removal of this.#pageRemovals.values()) {
            clearTimeout(removal);
        }
    }

    #showAll(snapshots: ContentsSnapshot[]): void {
        const present = new Set<number>();
        for (const snapshot of snapshots) {
            present.add(snapshot.id);
            if (snapshot.unreadable !== true) {
                this.#show(snapshot);
            }
        }
        for (const [id, known] of this.#known) {
            if (!present.has(id) && !known.destroyed) {
                this.#markDestroyed(id);
            }
        }
    }

    #show(snapshot: ContentsSnapshot): void {
        const known = this.#known.get(snapshot.id) ?? { snapshot, destroyed: false, shown: "", preferencesShown: "" };
        known.snapshot = snapshot;
        this.#known.set(snapshot.id, known);
        const cells = cellsOf(snapshot, stateOf(known));
        const row = rowOf(known, this.#appName);
        const shown = JSON.stringify([cells, row]);
        if (shown !== known.shown) {
            known.shown = shown;
            this.#table.upsertRow({ id: String(snapshot.id), cells });
            this.#pages.add(String(snapshot.id), row);
        }
        const preferences = JSON.stringify([snapshot.preferences, snapshot.preload, snapshot.sessionPreloads, snapshot.window, snapshot.session]);
        if (preferences !== known.preferencesShown) {
            known.preferencesShown = preferences;
            showPreferences(this.pageOf(snapshot.id)!, snapshot);
        }
    }

    #markDestroyed(id: number): void {
        const known = this.#known.get(id);
        if (known === undefined || known.destroyed) {
            return;
        }
        known.destroyed = true;
        this.#table.upsertRow({ id: String(id), cells: cellsOf(known.snapshot, stateOf(known)) });
        const page = this.pageOf(id);
        if (page !== null) {
            page.update(rowOf(known, this.#appName));
            page.widget("console").appendError(`${this.label(id)} was destroyed. Its page goes away in a minute.`);
        }
        this.#pageRemovals.set(id, setTimeout(() => this.#forget(id), GONE_PAGE_LINGER_MS));
    }

    #forget(id: number): void {
        this.#pageRemovals.delete(id);
        this.#known.delete(id);
        this.#pages.remove(String(id));
        this.#table.removeRow(String(id));
    }
}

function cellsOf(snapshot: ContentsSnapshot, state: Badge) {
    const preferences = revive(snapshot.preferences) ?? {};
    return {
        id: `#${snapshot.id}`,
        type: snapshot.type,
        title: snapshot.title,
        url: snapshot.url,
        pid: (snapshot.pid !== 0) ? String(snapshot.pid) : "—",
        state: state.text,
        node: flag(preferences.nodeIntegration),
        isolation: flag(preferences.contextIsolation),
        sandbox: flag(preferences.sandbox),
        webSecurity: flag(preferences.webSecurity),
        preload: snapshot.preload ?? "none",
        guards: guardsOf(snapshot),
    };
}

function rowOf(known: Known, appName: string): CustomInstrumentChildRow {
    const { snapshot } = known;
    const facts = [`#${snapshot.id} ${snapshot.type}`, (snapshot.pid !== 0) ? `pid ${snapshot.pid}` : null, snapshot.url];
    return {
        title: clip(withoutAppName(titleOf(snapshot), appName), TITLE_CHARS),
        subtitle: clip(facts.filter(fact => fact !== null).join(" · "), SUBTITLE_CHARS),
        badge: stateOf(known),
    };
}

function withoutAppName(title: string, appName: string): string {
    const suffix = TITLE_SEPARATORS.map(separator => separator + appName.toLowerCase())
        .find(candidate => title.toLowerCase().endsWith(candidate) && title.length > candidate.length);
    return (suffix !== undefined) ? title.slice(0, title.length - suffix.length) : title;
}

function stateOf({ snapshot, destroyed }: Known): Badge {
    if (destroyed) {
        return { text: "destroyed", tone: "ended" };
    }
    if (snapshot.crashed || snapshot.goneReason !== null) {
        return { text: clip(`crashed (${snapshot.goneReason ?? "gone"})`, BADGE_CHARS), tone: "failed" };
    }
    if (snapshot.unresponsive) {
        return { text: "unresponsive", tone: "waiting" };
    }
    if (snapshot.loading) {
        return { text: "loading", tone: "waiting" };
    }
    return { text: "ready", tone: "active" };
}

function showPreferences(page: ContentsPage, snapshot: ContentsSnapshot): void {
    const table = page.widget("preferences");
    table.clear();
    const show = (preference: string, value: string) => table.upsertRow({ id: preference, cells: { preference, value } });
    show("preload", snapshot.preload ?? "none");
    show("session preloads", (snapshot.sessionPreloads.length !== 0) ? snapshot.sessionPreloads.join(", ") : "none");
    show("session", snapshot.session);
    show("window", (snapshot.window !== null) ? `#${snapshot.window.id} “${snapshot.window.title}”${snapshot.window.visible ? "" : " (hidden)"}` : "none");
    if (snapshot.host !== null) {
        show("host web contents", `#${snapshot.host}`);
    }
    show("guards", guardsOf(snapshot));
    const preferences = snapshot.preferences;
    if (preferences !== null && typeof preferences === "object" && preferences.$luma === undefined) {
        for (const [name, value] of Object.entries<any>(preferences)) {
            show(name, summarize(value, 200));
        }
    }
}

function guardsOf(snapshot: ContentsSnapshot): string {
    const guards = [
        snapshot.windowOpenHandler ? "window.open handler" : null,
        (snapshot.navigationListeners !== 0) ? `${snapshot.navigationListeners} navigation listener${(snapshot.navigationListeners === 1) ? "" : "s"}` : null,
    ].filter(guard => guard !== null);
    return (guards.length !== 0) ? guards.join(", ") : "none";
}

function titleOf(snapshot: ContentsSnapshot): string {
    return (snapshot.title !== "") ? snapshot.title : ((snapshot.url !== "") ? snapshot.url : `web contents #${snapshot.id}`);
}

function flag(value: unknown): string {
    return (typeof value === "boolean") ? (value ? "yes" : "no") : "—";
}

function clip(text: string, limit: number): string {
    return (text.length > limit) ? `${text.slice(0, limit - 1)}…` : text;
}

export function report(outcome: Evaluation, respond: Responder): void {
    if (outcome.ok) {
        respond.value(revive(outcome.value));
    } else {
        respond.error(outcome.error!);
    }
}
