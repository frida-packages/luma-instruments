import { Buffer } from "buffer";
import type { GameThread, Place } from "./game-thread.js";
import { type InspectedComponent, inspectGameObject } from "./object-inspection.js";
import { snapshotScene } from "./scene-snapshot.js";
import type { StatusLine } from "./status-line.js";
import type { SceneFacts, UnityApi } from "./unity-api.js";
import type { ValueText } from "./value-text.js";

type SceneTable = CustomInstrumentWidgetMap["scenes"];
type Pages = CustomInstrumentChildren<"scene">;

export type ScenePage = CustomInstrumentChild<"scene">;

export interface HierarchyState {
    scene: { handle: number; name: string; buildIndex: number };
    objects: number;
    takenAt: number;
    tookMs: number;
    place: Place;
}

export interface Inspection {
    inspected: number;
    components: InspectedComponent[] | null;
    shortened: boolean;
}

const LONGEST_TITLE = 120;
const EVENT_BUDGET = 200 * 1024;

export class ScenePages {
    readonly #table: SceneTable;
    readonly #pages: Pages;
    readonly #thread: GameThread;
    readonly #api: UnityApi;
    readonly #values: ValueText;
    readonly #status: StatusLine;
    readonly #scenes = new Map<string, SceneFacts>();
    readonly #objects = new Map<string, number>();
    readonly #listeners: InvocationListener[] = [];
    #activeHandle = 0;

    constructor(table: SceneTable, pages: Pages, thread: GameThread, api: UnityApi, values: ValueText, status: StatusLine) {
        this.#table = table;
        this.#pages = pages;
        this.#thread = thread;
        this.#api = api;
        this.#values = values;
        this.#status = status;
        table.clear();
    }

    watch(): void {
        for (const address of this.#api.sceneEvents) {
            this.#listeners.push(Interceptor.attach(address, {
                onEnter: () => {
                    setTimeout(() => this.refreshListReporting(), 0);
                },
            }));
        }
        this.refreshListReporting();
    }

    refreshListReporting(): void {
        this.refreshList().catch(error => this.#status.note("scenes", `Could not list the scenes: ${error.message}`, error.stack));
    }

    async refreshList(): Promise<void> {
        const { scenes, active } = await this.#thread.run(() => ({ scenes: this.#api.scenes(), active: this.#api.activeSceneHandle() }));
        this.#activeHandle = active;
        const loaded = scenes.filter(each => each.isLoaded);
        const added = loaded.filter(each => !this.#scenes.has(idOf(each.handle)));
        this.#forgetUnloaded(new Set(loaded.map(each => idOf(each.handle))));
        for (const facts of loaded) {
            this.#scenes.set(idOf(facts.handle), facts);
            this.#showRow(idOf(facts.handle));
        }
        this.#status.note("scenes", `${loaded.length} scene${(loaded.length === 1) ? "" : "s"} loaded`,
            "Each has a page with its GameObjects; Refresh there takes the hierarchy again.");
        for (const facts of added) {
            await this.refresh(idOf(facts.handle));
        }
    }

    async refresh(id: string): Promise<void> {
        const { handle } = this.#scenes.get(id)!;
        const taken = await this.#thread.run(place => ({ place, snapshot: snapshotScene(handle, this.#api) }));
        const page = this.#pages.get(id);
        if (taken.snapshot === null || page === undefined) {
            return this.refreshList();
        }
        const { lines, tookMs } = taken.snapshot;
        const facts = this.#scenes.get(id)!;
        const state: HierarchyState = {
            scene: { handle, name: facts.name, buildIndex: facts.buildIndex },
            objects: lines.length,
            takenAt: Date.now(),
            tookMs,
            place: taken.place,
        };
        page.widget("hierarchy").setState(state, Buffer.from(lines.join("\n"), "utf8"));
        this.#objects.set(id, lines.length);
        this.#showRow(id);
    }

    async inspect(id: string, instanceId: number): Promise<void> {
        const components = await this.#thread.run(() => inspectGameObject(instanceId, this.#api, this.#values));
        const inspection = withinBudget({ inspected: instanceId, components, shortened: false });
        this.#pages.get(id)?.widget("hierarchy").sendEvent(inspection);
    }

    pageOf(id: string): ScenePage | null {
        return this.#pages.get(id) ?? null;
    }

    dispose(): void {
        for (const listener of this.#listeners) {
            listener.detach();
        }
    }

    #forgetUnloaded(loaded: Set<string>): void {
        for (const id of [...this.#scenes.keys()].filter(each => !loaded.has(each))) {
            this.#scenes.delete(id);
            this.#objects.delete(id);
            this.#table.removeRow(id);
            this.#pages.remove(id);
        }
    }

    #showRow(id: string): void {
        const facts = this.#scenes.get(id)!;
        const objects = this.#objects.get(id);
        const isActive = facts.handle === this.#activeHandle;
        this.#table.upsertRow({
            id,
            cells: {
                name: facts.name,
                buildIndex: String(facts.buildIndex),
                roots: String(facts.rootCount),
                objects: (objects === undefined) ? "…" : String(objects),
                state: isActive ? "loaded, active" : "loaded",
            },
        });
        const counted = (objects === undefined) ? "" : ` · ${objects} objects`;
        this.#pages.add(id, {
            title: facts.name.slice(0, LONGEST_TITLE) || "(unnamed scene)",
            subtitle: `build index ${facts.buildIndex} · ${facts.rootCount} roots${counted}`,
            badge: isActive ? { text: "active", tone: "active" } : { text: "loaded", tone: "neutral" },
        });
    }
}

function idOf(handle: number): string {
    return `scene-${handle}`;
}

function withinBudget(inspection: Inspection): Inspection {
    if (inspection.components === null || Buffer.byteLength(JSON.stringify(inspection)) <= EVENT_BUDGET) {
        return inspection;
    }
    let left = EVENT_BUDGET;
    const components = inspection.components.map(component => {
        left -= Buffer.byteLength(component.type) + 32;
        const fields = component.fields.filter(field => {
            left -= Buffer.byteLength(JSON.stringify(field));
            return left > 0;
        });
        return { type: component.type, fields };
    });
    return { inspected: inspection.inspected, components, shortened: true };
}
