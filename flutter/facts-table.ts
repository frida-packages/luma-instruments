import type { Findings, ServiceLookup } from "./flutter-inspection.js";
import type { SnapshotStrings } from "./snapshot-strings.js";
import type { IsolateFacts, VmService } from "./vm-service.js";

type FactsWidget = CustomInstrumentWidgetMap["facts"];

interface Fact {
    id: string;
    what: string;
    value: string;
}

const PACKAGES_LISTED = 12;
const CHANNEL_NAMES_LISTED = 6;
const UNKNOWN = "not found";

export class FactsTable {
    readonly #widget: FactsWidget;
    readonly #shown = new Map<string, string>();

    constructor(widget: FactsWidget) {
        this.#widget = widget;
    }

    show(findings: Findings, engines: number): void {
        const facts = factsOf(findings, engines);
        for (const fact of facts) {
            const text = `${fact.what}\n${fact.value}`;
            if (this.#shown.get(fact.id) !== text) {
                this.#shown.set(fact.id, text);
                this.#widget.upsertRow({ id: fact.id, cells: { what: fact.what, value: fact.value } });
            }
        }
        const current = new Set(facts.map(fact => fact.id));
        for (const id of this.#shown.keys()) {
            if (!current.has(id)) {
                this.#shown.delete(id);
                this.#widget.removeRow(id);
            }
        }
    }
}

function factsOf(findings: Findings, engines: number): Fact[] {
    const { platform, engine, engineFacts, snapshot, app } = findings;
    return [
        { id: "engine", what: "Engine", value: `${platform.name}, ${engine.path}` },
        { id: "revision", what: "Engine revision", value: engineFacts.revision ?? UNKNOWN },
        { id: "dart", what: "Dart", value: engineFacts.dartVersion ?? UNKNOWN },
        { id: "build", what: "Build", value: snapshot?.build ?? UNKNOWN },
        { id: "snapshot", what: "Snapshot hash", value: snapshotHashText(findings) },
        { id: "features", what: "Snapshot features", value: snapshot?.features.join(" ") ?? UNKNOWN },
        { id: "arch", what: "Architecture", value: Process.arch },
        { id: "app", what: "App code", value: (app !== null) ? app.path : "not loaded yet" },
        { id: "assets", what: "Flutter assets", value: findings.assets ?? "inside the app package, not on disk" },
        { id: "channels", what: "Channels", value: findings.channels.how },
        { id: "engines", what: "Engines seen", value: (engines === 0) ? "none yet: an engine appears with its first message" : String(engines) },
        { id: "vm-service", what: "VM service", value: serviceText(findings.vmService) },
        ...isolateFacts(findings.vmService),
        ...stringFacts(findings.strings),
    ];
}

function snapshotHashText({ snapshot, engineFacts }: Findings): string {
    if (snapshot === null) {
        return engineFacts.snapshotHash ?? UNKNOWN;
    }
    if (engineFacts.snapshotHash === null || engineFacts.snapshotHash === snapshot.hash) {
        return `${snapshot.hash}, ${snapshot.kind}`;
    }
    return `${snapshot.hash}, ${snapshot.kind}; the engine expects ${engineFacts.snapshotHash}`;
}

function serviceText(lookup: ServiceLookup): string {
    switch (lookup.state) {
        case "unasked":
            return "not asked (see settings)";
        case "asking":
            return "looking…";
        case "none":
            return "none listening; release builds have none";
        case "found":
            return serviceSummary(lookup.service);
        case "failed":
            return `found, but it did not answer: ${lookup.reason}`;
    }
}

function serviceSummary(service: VmService): string {
    if (service.unreachable !== null) {
        return `${service.url}, which the instrument could not reach from inside the app (${service.unreachable}); `
            + "a sandboxed app without the network client entitlement refuses it. DevTools can open it.";
    }
    return `${service.url} (${service.version})`;
}

function isolateFacts(lookup: ServiceLookup): Fact[] {
    if (lookup.state !== "found" || lookup.service.unreachable !== null) {
        return [{ id: "isolates", what: "Isolates", value: "listed only by a VM service that answers" }];
    }
    return lookup.service.isolates.map(isolate => ({ id: `isolate:${isolate.id}`, what: `Isolate ${isolate.name}`, value: isolateText(isolate) }));
}

function isolateText(isolate: IsolateFacts): string {
    if (isolate.system) {
        return `${isolate.id}, a system isolate`;
    }
    return `${isolate.id}, ${isolate.libraries.length} libraries, root ${isolate.rootLibrary ?? "unknown"}`;
}

function stringFacts(strings: SnapshotStrings | null): Fact[] {
    if (strings === null) {
        return [{ id: "packages", what: "Packages", value: "reading the snapshot…" }];
    }
    const packages = [...strings.packages].slice(0, PACKAGES_LISTED).map(([name, libraries]) => `${name} (${libraries})`);
    const more = (strings.packages.size > PACKAGES_LISTED) ? `, and ${strings.packages.size - PACKAGES_LISTED} more` : "";
    const names = strings.channelNames.slice(0, CHANNEL_NAMES_LISTED).join(", ");
    const moreNames = (strings.channelNames.length > CHANNEL_NAMES_LISTED) ? `, and ${strings.channelNames.length - CHANNEL_NAMES_LISTED} more` : "";
    return [
        { id: "packages", what: "Packages", value: `${strings.packages.size}: ${packages.join(", ")}${more}` },
        { id: "channel-names", what: "Channel names in the snapshot", value: `${strings.channelNames.length}: ${names}${moreNames}` },
    ];
}
