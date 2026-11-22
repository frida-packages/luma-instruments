import { Catalog, type Discovery, type FoundCertificate, type Strategy } from "./catalog.js";
import type { ScannedMemory } from "./memory-scan.js";
import type { CompletedScan, MemoryScope, ObjectSearch, ScanObserver } from "./scan.js";
import type { CertificateView, StrategyTally } from "./view.js";

const byteStrategies: Strategy[] = ["DER", "PEM"];

export class Inventory implements ScanObserver {
    private readonly ctx: CustomInstrumentContext;
    private readonly view: CertificateView;
    private readonly catalog = new Catalog();
    private searches: ObjectSearch[] = [];

    constructor(ctx: CustomInstrumentContext, view: CertificateView) {
        this.ctx = ctx;
        this.view = view;
    }

    onStarted(scope: MemoryScope): void {
        this.searches = [];
        this.catalog.forgetSightings();
        this.view.showScanStarted(scope, this.catalog.size);
    }

    onDiscovery(discovery: Discovery): void {
        const { recording, entry } = this.catalog.record(discovery);
        if (recording === "known-sighting") {
            return;
        }
        if (recording === "new") {
            this.ctx.emit(eventOf(entry, discovery));
        }
        this.view.showCertificate(entry);
    }

    onObjectsSearched(search: ObjectSearch): void {
        this.searches.push(search);
    }

    onMemoryScanned(memory: ScannedMemory): void {
        this.view.showMemoryProgress(memory, this.seenCount());
    }

    onFinished(scan: CompletedScan): void {
        this.view.removeCertificates(this.catalog.removeUnseen());
        this.view.showScanFinished(scan, this.tallies(), this.catalog.size);
    }

    onFailed(error: Error): void {
        this.view.showScanFailed(error);
    }

    find(sha256: string): FoundCertificate | undefined {
        return this.catalog.get(sha256);
    }

    search(query: string): FoundCertificate[] {
        return this.catalog.search(query);
    }

    private seenCount(): number {
        return this.catalog.all().filter(entry => entry.seen).length;
    }

    private tallies(): StrategyTally[] {
        const entries = this.catalog.all();
        const certificatesFoundBy = (strategy: Strategy, holder: string | null) => entries
            .filter(entry => entry.sightings.some(sighting => sighting.strategy === strategy && sighting.holder === holder))
            .length;
        return [
            ...this.searches.map(search => ({
                search,
                strategy: search.strategy,
                holder: search.holder,
                certificates: certificatesFoundBy(search.strategy, search.holder),
            })),
            ...byteStrategies.map(strategy => ({
                search: null,
                strategy,
                holder: null,
                certificates: certificatesFoundBy(strategy, null),
            })),
        ];
    }
}

function eventOf(entry: FoundCertificate, { der, sighting }: Discovery) {
    const { subject, issuer, notAfter } = entry.certificate;
    return {
        subject: subject.text,
        issuer: issuer.text,
        notAfter,
        sha256: entry.sha256,
        foundBy: sighting.strategy,
        address: sighting.address,
        der,
    };
}
