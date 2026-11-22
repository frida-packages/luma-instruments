import type { Discovery } from "./catalog.js";
import { declaredLength } from "./der.js";
import { decodeBase64Body } from "./pem.js";
import type { ScanRun } from "./scan.js";
import { parseCertificate } from "./x509.js";

export interface ScannedMemory {
    scanned: number;
    total: number;
}

const chunkSize = 16 * 1024 * 1024;
const versionAndSerialTag = "a0 03 02 01 02 02";
const pemLabelEnd = "43 45 52 54 49 46 49 43 41 54 45 2d 2d 2d 2d 2d";
const longestPattern = 16;

export async function scanMemory(ranges: MemoryRange[], run: ScanRun, onProgress: (memory: ScannedMemory) => void): Promise<ScannedMemory> {
    const memory = { scanned: 0, total: ranges.reduce((total, range) => total + range.size, 0) };
    for (const range of ranges) {
        const rangeEnd = range.base.add(range.size);
        for (let offset = 0; offset < range.size; offset += chunkSize) {
            const start = range.base.add(offset);
            const size = Math.min(chunkSize + longestPattern - 1, range.size - offset);
            const [tags, labels] = await Promise.all([matchesIn(start, size, versionAndSerialTag), matchesIn(start, size, pemLabelEnd)]);
            await run.checkpoint();
            for (const tag of tags) {
                run.consider(() => derCertificateAround(tag, range.base, rangeEnd));
            }
            for (const label of labels) {
                run.consider(() => pemCertificateAt(label, range.base, rangeEnd));
            }
            memory.scanned += Math.min(chunkSize, range.size - offset);
            onProgress(memory);
        }
    }
    return memory;
}

function matchesIn(start: NativePointer, size: number, pattern: string): Promise<NativePointer[]> {
    const matches: NativePointer[] = [];
    const matchesBeforeAnyUnreadableMemory = () => matches;
    const scan = Memory.scan(start, size, pattern, {
        onMatch(address) {
            matches.push(address);
        },
    });
    return scan.then(matchesBeforeAnyUnreadableMemory, matchesBeforeAnyUnreadableMemory);
}

const sequence = 0x30;
const oneLengthOctet = 0x81;
const twoLengthOctets = 0x82;
const headerLayouts = [
    { outer: twoLengthOctets, tbs: twoLengthOctets },
    { outer: twoLengthOctets, tbs: oneLengthOctet },
    { outer: oneLengthOctet, tbs: oneLengthOctet },
];
const longestHeaders = 8;

function derCertificateAround(tag: NativePointer, rangeStart: NativePointer, rangeEnd: NativePointer): Discovery | null {
    const available = bytesBetween(rangeStart, tag, longestHeaders);
    const before = new Uint8Array(tag.sub(available).readByteArray(available)!);
    for (const { outer, tbs } of headerLayouts) {
        const tbsStart = available - headerSize(tbs);
        const outerStart = tbsStart - headerSize(outer);
        if (outerStart >= 0 && before[outerStart] === sequence && before[outerStart + 1] === outer
            && before[tbsStart] === sequence && before[tbsStart + 1] === tbs) {
            const start = tag.sub(available - outerStart);
            const length = declaredLength(before.subarray(outerStart));
            return (start.add(length).compare(rangeEnd) <= 0) ? derCertificateAt(start, length) : null;
        }
    }
    return null;
}

function derCertificateAt(start: NativePointer, length: number): Discovery {
    const der = start.readByteArray(length)!;
    return {
        der,
        certificate: parseCertificate(new Uint8Array(der)),
        sighting: { strategy: "DER", address: start, derAddress: start, holder: null },
    };
}

const beginMarkers = ["-----BEGIN ", "-----BEGIN X509 ", "-----BEGIN TRUSTED "].map(asciiBytes);
const endMarker = asciiBytes("-----END");
const labelEndLength = 16;
const shortPemLimit = 8 * 1024;
const longPemLimit = 96 * 1024;

function pemCertificateAt(labelEnd: NativePointer, rangeStart: NativePointer, rangeEnd: NativePointer): Discovery | null {
    const begin = beginningOf(labelEnd, rangeStart);
    if (begin === null) {
        return null;
    }
    const bodyStart = labelEnd.add(labelEndLength);
    const body = pemBody(bodyStart, bytesBetween(bodyStart, rangeEnd, shortPemLimit))
        ?? pemBody(bodyStart, bytesBetween(bodyStart, rangeEnd, longPemLimit));
    if (body === null) {
        return null;
    }
    const decoded = decodeBase64Body(body);
    const der = decoded.slice(0, declaredLength(decoded)).buffer as ArrayBuffer;
    return {
        der,
        certificate: parseCertificate(new Uint8Array(der)),
        sighting: { strategy: "PEM", address: begin, derAddress: null, holder: null },
    };
}

function beginningOf(labelEnd: NativePointer, rangeStart: NativePointer): NativePointer | null {
    for (const marker of beginMarkers) {
        const start = labelEnd.sub(marker.length);
        if (start.compare(rangeStart) >= 0 && sameBytes(new Uint8Array(start.readByteArray(marker.length)!), marker)) {
            return start;
        }
    }
    return null;
}

function pemBody(start: NativePointer, limit: number): Uint8Array | null {
    const text = new Uint8Array(start.readByteArray(limit)!);
    const end = indexOf(text, endMarker);
    return (end !== -1) ? text.subarray(0, end) : null;
}

function bytesBetween(start: NativePointer, end: NativePointer, limit: number): number {
    return (start.add(limit).compare(end) <= 0) ? limit : end.sub(start).toUInt32();
}

function headerSize(lengthForm: number): number {
    return 2 + (lengthForm & 0x7f);
}

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
    const first = needle[0];
    for (let i = haystack.indexOf(first); i !== -1 && i + needle.length <= haystack.length; i = haystack.indexOf(first, i + 1)) {
        if (sameBytes(haystack.subarray(i, i + needle.length), needle)) {
            return i;
        }
    }
    return -1;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function asciiBytes(text: string): Uint8Array {
    return Uint8Array.from(text, character => character.charCodeAt(0));
}
