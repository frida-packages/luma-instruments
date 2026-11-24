import type { Certificate } from "./x509.js";

export type Strategy = "SecCertificate" | "OpenSSL X509" | "DER" | "PEM";

export interface Sighting {
    strategy: Strategy;
    address: NativePointer;
    derAddress: NativePointer | null;
    holder: string | null;
}

export interface Discovery {
    der: ArrayBuffer;
    certificate: Certificate;
    sighting: Sighting;
}

export type Recording = "new" | "rediscovered" | "another-sighting" | "known-sighting";

export class Catalog {
    readonly #entries = new Map<string, FoundCertificate>();

    forgetSightings(): void {
        for (const entry of this.#entries.values()) {
            entry.forgetSightings();
        }
    }

    get size(): number {
        return this.#entries.size;
    }

    record({ der, certificate, sighting }: Discovery): { recording: Recording; entry: FoundCertificate } {
        const sha256 = Checksum.compute("sha256", der);
        const known = this.#entries.get(sha256);
        if (known === undefined) {
            const entry = new FoundCertificate(sha256, der, certificate);
            entry.add(sighting);
            this.#entries.set(sha256, entry);
            return { recording: "new", entry };
        }
        if (known.has(sighting)) {
            return { recording: "known-sighting", entry: known };
        }
        const recording = known.seen ? "another-sighting" : "rediscovered";
        known.add(sighting);
        return { recording, entry: known };
    }

    removeUnseen(): FoundCertificate[] {
        const unseen = this.all().filter(entry => !entry.seen);
        for (const entry of unseen) {
            this.#entries.delete(entry.sha256);
        }
        return unseen;
    }

    get(sha256: string): FoundCertificate | undefined {
        return this.#entries.get(sha256);
    }

    search(query: string): FoundCertificate[] {
        const needle = query.trim().toLowerCase();
        const fingerprint = needle.replace(/[:\s]/g, "");
        return this.all().filter(entry => {
            const { subject, issuer, subjectAltNames } = entry.certificate;
            return (fingerprint.length !== 0 && (entry.sha256.startsWith(fingerprint) || entry.sha1.startsWith(fingerprint)))
                || [subject.text, issuer.text, ...subjectAltNames].some(text => text.toLowerCase().includes(needle));
        });
    }

    all(): FoundCertificate[] {
        return Array.from(this.#entries.values());
    }
}

export class FoundCertificate {
    readonly sha256: string;
    readonly sha1: string;
    readonly der: ArrayBuffer;
    readonly certificate: Certificate;
    readonly sightings: Sighting[] = [];
    readonly #sightingKeys = new Set<string>();

    constructor(sha256: string, der: ArrayBuffer, certificate: Certificate) {
        this.sha256 = sha256;
        this.sha1 = Checksum.compute("sha1", der);
        this.der = der;
        this.certificate = certificate;
    }

    forgetSightings(): void {
        this.sightings.length = 0;
        this.#sightingKeys.clear();
    }

    add(sighting: Sighting): void {
        this.#sightingKeys.add(keyOf(sighting));
        this.sightings.push(sighting);
    }

    has(sighting: Sighting): boolean {
        return this.#sightingKeys.has(keyOf(sighting));
    }

    get seen(): boolean {
        return this.sightings.length !== 0;
    }
}

function keyOf({ strategy, address }: Sighting): string {
    return `${strategy}@${address}`;
}
