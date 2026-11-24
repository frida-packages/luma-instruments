import type { Discovery } from "./catalog.js";
import { encodeElement, objectIdentifier, tags } from "./der.js";
import type { Candidate, ObjectSource } from "./scan.js";
import { parseCertificate, signatureAlgorithmIdentifierOf } from "./x509.js";

const signatureAlgorithms = [
    { nid: 8, oid: "1.2.840.113549.1.1.4" },
    { nid: 65, oid: "1.2.840.113549.1.1.5" },
    { nid: 671, oid: "1.2.840.113549.1.1.14" },
    { nid: 668, oid: "1.2.840.113549.1.1.11" },
    { nid: 669, oid: "1.2.840.113549.1.1.12" },
    { nid: 670, oid: "1.2.840.113549.1.1.13" },
    { nid: 912, oid: "1.2.840.113549.1.1.10" },
    { nid: 113, oid: "1.2.840.10040.4.3" },
    { nid: 803, oid: "2.16.840.1.101.3.4.3.2" },
    { nid: 416, oid: "1.2.840.10045.4.1" },
    { nid: 793, oid: "1.2.840.10045.4.3.1" },
    { nid: 794, oid: "1.2.840.10045.4.3.2" },
    { nid: 795, oid: "1.2.840.10045.4.3.3" },
    { nid: 796, oid: "1.2.840.10045.4.3.4" },
    { nid: 1087, oid: "1.3.101.112" },
    { nid: 1088, oid: "1.3.101.113" },
];

const postQuantumSignatureAlgorithms = [
    { nid: 1457, oid: "2.16.840.1.101.3.4.3.17" },
    { nid: 1458, oid: "2.16.840.1.101.3.4.3.18" },
    { nid: 1459, oid: "2.16.840.1.101.3.4.3.19" },
];

const oldestSupportedVersion = 0x10101000;
const firstVersionWithPostQuantumSignatures = 0x30500000;
const versionTextPattern = /^OpenSSL (\S+)/;

const pointerSize = Process.pointerSize;
const longSize = (Process.platform === "windows") ? 4 : pointerSize;
const asn1Object = {
    nid: 2 * pointerSize,
    length: 2 * pointerSize + 4,
    data: 2 * pointerSize + 8,
};

const asn1StringSize = alignedToPointer(8 + pointerSize + longSize);
const asn1String = {
    length: 0,
    type: 4,
    data: 8,
    flags: 8 + pointerSize,
};
const encodingSize = alignedToPointer(pointerSize + longSize + 4);
const encoding = {
    bytes: 0,
    length: pointerSize,
    modified: pointerSize + longSize,
};
const x509 = (() => {
    const serialNumber = pointerSize;
    const tbsSignatureAlgorithm = serialNumber + asn1StringSize;
    const tbsEncoding = tbsSignatureAlgorithm + 10 * pointerSize;
    const signatureAlgorithm = tbsEncoding + encodingSize;
    const signature = signatureAlgorithm + 2 * pointerSize;
    return { serialNumber, tbsSignatureAlgorithm, tbsEncoding, signatureAlgorithm, signature };
})();
const algorithmPointerDistance = x509.signatureAlgorithm - x509.tbsSignatureAlgorithm;

const integerType = 2;
const negativeIntegerType = 0x102;
const bitStringType = 3;
const bitsLeftFlag = 0x08;
const bitsLeftMask = 0x07;
const largestPlausibleSerialNumber = 64;
const largestPlausibleTbs = 1 << 20;
const largestPlausibleSignature = 1 << 16;

export function findOpenSslLibraries(): ObjectSource[] {
    return Process.enumerateModules().flatMap(module => {
        const library = openLibrary(module);
        return (library !== null) ? [library] : [];
    });
}

function openLibrary(module: Module): OpenSslLibrary | null {
    const versionText = module.findExportByName("OpenSSL_version");
    const versionNumber = module.findExportByName("OpenSSL_version_num");
    const nidToObject = module.findExportByName("OBJ_nid2obj");
    if (versionText === null || versionNumber === null || nidToObject === null) {
        return null;
    }
    const version = versionTextPattern.exec(new NativeFunction(versionText, "pointer", ["int"])(0).readCString()!);
    const number = new NativeFunction(versionNumber, "uint32", [])();
    if (version === null || number < oldestSupportedVersion) {
        return null;
    }
    const algorithms = (number >= firstVersionWithPostQuantumSignatures)
        ? [...signatureAlgorithms, ...postQuantumSignatureAlgorithms]
        : signatureAlgorithms;
    const objects = sharedObjects(new NativeFunction(nidToObject, "pointer", ["int"]), algorithms);
    return new OpenSslLibrary(`${module.name}, OpenSSL ${version[1]}`, objects);
}

function sharedObjects(nidToObject: NativeFunction<NativePointer, [number]>, algorithms: typeof signatureAlgorithms): Map<string, string> {
    const objects = new Map<string, string>();
    for (const { nid, oid } of algorithms) {
        const object = nidToObject(nid);
        if (!object.isNull() && object.add(asn1Object.nid).readS32() === nid && oidOf(object) === oid) {
            objects.set(object.toString(), oid);
        }
    }
    return objects;
}

class OpenSslLibrary implements ObjectSource {
    readonly strategy = "OpenSSL X509" as const;
    readonly holder: string;
    readonly #objects: Map<string, string>;

    constructor(holder: string, objects: Map<string, string>) {
        this.holder = holder;
        this.#objects = objects;
    }

    findCandidates(ranges: MemoryRange[]): Candidate[] {
        const references = Memory.findPointers(ranges, Array.from(this.#objects.keys(), key => ptr(key)));
        const referenceAt = new Map(references.map(({ address, value }) => [address.toString(), value.toString()]));
        return references
            .filter(({ address, value }) => referenceAt.get(address.add(algorithmPointerDistance).toString()) === value.toString())
            .map(({ address, value }) => () => this.#examine(address.sub(x509.tbsSignatureAlgorithm), this.#objects.get(value.toString())!));
    }

    #examine(candidate: NativePointer, signatureAlgorithm: string): Discovery | null {
        if (!hasPlausibleSerialNumber(candidate.add(x509.serialNumber))) {
            return null;
        }
        const tbs = readTbsEncoding(candidate.add(x509.tbsEncoding));
        const signature = readSignature(candidate.add(x509.signature));
        if (tbs === null || signature === null) {
            return null;
        }
        const der = encodeElement(tags.sequence, tbs, signatureAlgorithmIdentifierOf(tbs), encodeElement(tags.bitString, signature));
        const certificate = parseCertificate(der);
        if (certificate.signatureAlgorithm.oid !== signatureAlgorithm) {
            return null;
        }
        return {
            der: der.buffer as ArrayBuffer,
            certificate,
            sighting: { strategy: this.strategy, address: candidate, derAddress: null, holder: this.holder },
        };
    }
}

function oidOf(object: NativePointer): string {
    const length = object.add(asn1Object.length).readS32();
    return objectIdentifier(new Uint8Array(object.add(asn1Object.data).readPointer().readByteArray(length)!));
}

function hasPlausibleSerialNumber(serialNumber: NativePointer): boolean {
    const length = serialNumber.add(asn1String.length).readS32();
    const type = serialNumber.add(asn1String.type).readS32();
    return (type === integerType || type === negativeIntegerType) && length > 0 && length <= largestPlausibleSerialNumber;
}

function readTbsEncoding(tbsEncoding: NativePointer): Uint8Array | null {
    const length = readLong(tbsEncoding.add(encoding.length));
    if (tbsEncoding.add(encoding.modified).readS32() !== 0 || length <= 0 || length > largestPlausibleTbs) {
        return null;
    }
    return new Uint8Array(tbsEncoding.add(encoding.bytes).readPointer().readByteArray(length)!);
}

function readSignature(bitString: NativePointer): Uint8Array | null {
    const length = bitString.add(asn1String.length).readS32();
    if (bitString.add(asn1String.type).readS32() !== bitStringType || length <= 0 || length > largestPlausibleSignature) {
        return null;
    }
    const flags = readLong(bitString.add(asn1String.flags));
    const unusedBits = ((flags & bitsLeftFlag) !== 0) ? flags & bitsLeftMask : 0;
    const signature = new Uint8Array(1 + length);
    signature[0] = unusedBits;
    signature.set(new Uint8Array(bitString.add(asn1String.data).readPointer().readByteArray(length)!), 1);
    return signature;
}

function readLong(address: NativePointer): number {
    return (longSize === 8) ? address.readS64().toNumber() : address.readS32();
}

function alignedToPointer(size: number): number {
    return Math.ceil(size / pointerSize) * pointerSize;
}
