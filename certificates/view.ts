import type { FoundCertificate, Sighting, Strategy } from "./catalog.js";
import type { ScannedMemory } from "./memory-scan.js";
import { pemOf } from "./pem.js";
import type { CompletedScan, MemoryScope, ObjectSearch } from "./scan.js";
import { commonNameOf, type Authority, type Certificate } from "./x509.js";

export interface StrategyTally {
    search: ObjectSearch | null;
    strategy: Strategy;
    holder: string | null;
    certificates: number;
}

const flushDelay = 250;
const scanItem = "scan";
const fingerprintColumnLength = 16;
const sightingsShown = 50;
const answerLimit = 10;

const scopeNames: Record<MemoryScope, string> = {
    writable: "writable memory",
    readable: "all readable memory",
};

export class CertificateView {
    readonly #status: CustomInstrumentWidgetMap["scan"];
    readonly #table: CustomInstrumentWidgetMap["certificates"];
    readonly #details: CustomInstrumentWidgetMap["details"];
    readonly #derView: CustomInstrumentWidgetMap["der"];
    readonly #changed = new Set<FoundCertificate>();
    #pendingFlush: ReturnType<typeof setTimeout> | null = null;
    #shownPercentage = -1;

    constructor(ctx: CustomInstrumentContext) {
        this.#status = ctx.widget("scan");
        this.#table = ctx.widget("certificates");
        this.#details = ctx.widget("details");
        this.#derView = ctx.widget("der");
    }

    showScanStarted(scope: MemoryScope, known: number): void {
        this.#shownPercentage = -1;
        this.#table.setActionEnabled("rescan", false);
        this.#showStatus("Scanning…", `Looking for live certificate objects, then scanning ${scopeNames[scope]}`, countText(known));
    }

    showCertificate(entry: FoundCertificate): void {
        this.#changed.add(entry);
        if (this.#pendingFlush === null) {
            this.#pendingFlush = setTimeout(() => this.#flush(), flushDelay);
        }
    }

    showMemoryProgress(memory: ScannedMemory, found: number): void {
        const percentage = Math.floor(memory.scanned * 100 / memory.total);
        if (percentage === this.#shownPercentage) {
            return;
        }
        this.#shownPercentage = percentage;
        this.#showStatus("Scanning…", `${percentage}% of ${formattedByteCount(memory.total)} scanned`, countText(found));
    }

    removeCertificates(entries: FoundCertificate[]): void {
        for (const entry of entries) {
            this.#changed.delete(entry);
            this.#table.removeRow(entry.sha256);
        }
    }

    showScanFinished(scan: CompletedScan, tallies: StrategyTally[], found: number): void {
        this.#flush();
        const scanned = formattedByteCount(scan.memory.total);
        const memoryDuration = formattedDuration(scan.memoryMilliseconds);
        const finished = clockTime(Date.now());
        const objectDuration = formattedDuration(scan.objectMilliseconds);
        this.#showStatus(countText(found), `Objects in ${objectDuration} · ${scanned} of memory in ${memoryDuration}`, finished);
        this.#details.appendOutput([
            `Scanned ${scopeNames[scan.scope]} at ${finished}: ${countText(found)}`,
            ...tallies.map(tallyLine),
            `  ${scanned} searched for DER and PEM in ${memoryDuration}`,
        ].join("\n"));
        this.#table.setActionEnabled("rescan", true);
    }

    showScanFailed(error: Error): void {
        this.#showStatus("Scan failed", error.message, "");
        this.#details.appendError(error.stack!);
        this.#table.setActionEnabled("rescan", true);
    }

    inspect(entry: FoundCertificate): void {
        this.#details.appendValue(detailsOf(entry));
        this.#showDer(entry);
    }

    clearDetails(): void {
        this.#details.clear();
    }

    answer(query: string, matches: FoundCertificate[], respond: CustomInstrumentConsoleResponder): void {
        if (matches.length === 0) {
            respond.error(`No certificate matches “${query}”.`);
            return;
        }
        for (const entry of matches.slice(0, answerLimit)) {
            respond.value(detailsOf(entry));
        }
        if (matches.length > answerLimit) {
            respond.output(`Showing ${answerLimit} of ${matches.length} matches.`);
        }
        this.#showDer(matches[0]);
    }

    dispose(): void {
        this.#cancelPendingFlush();
    }

    #showStatus(title: string, subtitle: string, accessory: string): void {
        this.#status.upsertItem({ id: scanItem, title, subtitle, accessory });
    }

    #flush(): void {
        this.#cancelPendingFlush();
        for (const entry of this.#changed) {
            this.#table.upsertRow({ id: entry.sha256, cells: rowCells(entry) });
        }
        this.#changed.clear();
    }

    #cancelPendingFlush(): void {
        if (this.#pendingFlush !== null) {
            clearTimeout(this.#pendingFlush);
            this.#pendingFlush = null;
        }
    }

    #showDer(entry: FoundCertificate): void {
        const derAddress = entry.sightings.map(sighting => sighting.derAddress).find(address => address !== null) ?? null;
        this.#derView.setHex({ bytes: entry.der, baseAddress: (derAddress !== null) ? Number(derAddress.toString()) : 0 });
    }
}

function rowCells(entry: FoundCertificate) {
    const { subject, issuer, notAfter, publicKey } = entry.certificate;
    return {
        subject: commonNameOf(subject) ?? subject.text,
        issuer: commonNameOf(issuer) ?? issuer.text,
        expires: expiryText(notAfter),
        key: publicKey,
        sha256: entry.sha256.slice(0, fingerprintColumnLength),
        found: foundSummary(entry.sightings),
    };
}

function tallyLine({ strategy, holder, certificates, search }: StrategyTally): string {
    const source = (holder !== null) ? `${strategy} in ${holder}` : strategy;
    const effort = (search !== null)
        ? `, ${search.candidates} candidates found in ${formattedDuration(search.searchMilliseconds)} `
            + `and checked in ${formattedDuration(search.checkMilliseconds)}`
        : "";
    return `  ${source}: ${countText(certificates)}${effort}`;
}

function detailsOf(entry: FoundCertificate) {
    const certificate = entry.certificate;
    return {
        subject: certificate.subject.text,
        issuer: certificate.issuer.text,
        serialNumber: certificate.serialNumber,
        validity: validityText(certificate),
        notBefore: certificate.notBefore,
        notAfter: certificate.notAfter,
        signatureAlgorithm: certificate.signatureAlgorithm.name,
        publicKey: certificate.publicKey,
        subjectAltNames: certificate.subjectAltNames,
        basicConstraints: authorityText(certificate.authority),
        keyUsage: certificate.keyUsage,
        extendedKeyUsage: certificate.extendedKeyUsage,
        selfIssued: certificate.selfIssued,
        version: certificate.version,
        sha256: colonSeparated(entry.sha256),
        sha1: colonSeparated(entry.sha1),
        foundAt: sightingLines(entry.sightings),
        pem: pemOf(entry.der),
        der: entry.der,
    };
}

function expiryText(notAfter: Date): string {
    const date = notAfter.toISOString().slice(0, 10);
    return (notAfter.getTime() < Date.now()) ? `${date} (expired)` : date;
}

function foundSummary(sightings: Sighting[]): string {
    const counts = new Map<Strategy, number>();
    for (const { strategy } of sightings) {
        counts.set(strategy, (counts.get(strategy) ?? 0) + 1);
    }
    return Array.from(counts, ([strategy, count]) => (count === 1) ? strategy : `${strategy} ×${count}`).join(", ");
}

function validityText({ notBefore, notAfter }: Certificate): string {
    const now = Date.now();
    if (now < notBefore.getTime()) {
        return "not yet valid";
    }
    return (now > notAfter.getTime()) ? "expired" : "valid";
}

function authorityText(authority: Authority): string {
    switch (authority.kind) {
        case "unstated":
            return "absent";
        case "end-entity":
            return "not a CA";
        case "ca":
            return (authority.pathLength !== null) ? `CA, path length ${authority.pathLength}` : "CA";
    }
}

function sightingLines(sightings: Sighting[]): string[] {
    const lines = sightings.slice(0, sightingsShown).map(sightingText);
    if (sightings.length > sightingsShown) {
        lines.push(`… ${sightings.length - sightingsShown} more`);
    }
    return lines;
}

function sightingText({ strategy, address, derAddress, holder }: Sighting): string {
    const bytes = (derAddress !== null && !derAddress.equals(address)) ? `, DER at ${derAddress}` : "";
    const library = (holder !== null) ? ` (${holder})` : "";
    return `${strategy} at ${address}${bytes}${library}`;
}

function countText(count: number): string {
    return (count === 1) ? "1 certificate" : `${count} certificates`;
}

const byteUnits = ["B", "KiB", "MiB", "GiB", "TiB"];

function formattedByteCount(byteCount: number): string {
    let value = byteCount;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < byteUnits.length - 1) {
        value /= 1024;
        unitIndex++;
    }
    return `${unitIndex === 0 ? value : value.toFixed(1)} ${byteUnits[unitIndex]}`;
}

function formattedDuration(milliseconds: number): string {
    return (milliseconds < 1000) ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

function clockTime(timestamp: number): string {
    return new Date(timestamp).toTimeString().slice(0, 8);
}

function colonSeparated(hex: string): string {
    return hex.match(/../g)!.join(":").toUpperCase();
}
