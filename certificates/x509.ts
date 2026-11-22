import { DerReader, MalformedDer, objectIdentifier, tags, type DerElement } from "./der.js";
import {
    attributeTypeNames,
    curveNames,
    extendedKeyUsageNames,
    extensions,
    keyAlgorithmNames,
    keyAlgorithms,
    keyUsageNames,
    signatureAlgorithmNames,
} from "./object-names.js";

export interface Certificate {
    version: number;
    serialNumber: string;
    signatureAlgorithm: Algorithm;
    issuer: DistinguishedName;
    notBefore: Date;
    notAfter: Date;
    subject: DistinguishedName;
    publicKey: string;
    subjectAltNames: string[];
    authority: Authority;
    keyUsage: string[];
    extendedKeyUsage: string[];
    selfIssued: boolean;
}

export interface Algorithm {
    oid: string;
    name: string;
}

export interface DistinguishedName {
    text: string;
    attributes: [string, string][];
}

export type Authority =
    | { kind: "unstated" }
    | { kind: "end-entity" }
    | { kind: "ca"; pathLength: number | null };

const explicitVersion = 0xa0;
const explicitExtensions = 0xa3;
const issuerUniqueId = 0x81;
const subjectUniqueId = 0x82;
const v1 = 0;

export function parseCertificate(der: Uint8Array): Certificate {
    const outer = new DerReader(der);
    const certificate = outer.enterTagged(tags.sequence);
    outer.expectEnd();

    const tbs = certificate.enterTagged(tags.sequence);
    const signatureAlgorithm = readAlgorithm(certificate.enterTagged(tags.sequence));
    certificate.readTagged(tags.bitString);
    certificate.expectEnd();

    const versionField = tbs.readOptional(explicitVersion);
    const version = (versionField !== null) ? smallInteger(tbs.enter(versionField)) : v1;
    const serialNumber = colonHex(tbs.content(tbs.readTagged(tags.integer)));
    const innerAlgorithm = readAlgorithm(tbs.enterTagged(tags.sequence));
    if (innerAlgorithm.oid !== signatureAlgorithm.oid) {
        throw new MalformedDer("signature algorithms disagree");
    }
    const issuer = readName(tbs.enterTagged(tags.sequence));
    const validity = tbs.enterTagged(tags.sequence);
    const notBefore = readTime(validity);
    const notAfter = readTime(validity);
    validity.expectEnd();
    const subject = readName(tbs.enterTagged(tags.sequence));
    const publicKey = describePublicKey(tbs.enterTagged(tags.sequence));
    tbs.readOptional(issuerUniqueId);
    tbs.readOptional(subjectUniqueId);
    const extensionsField = tbs.readOptional(explicitExtensions);
    tbs.expectEnd();

    const parsed: Certificate = {
        version: version + 1,
        serialNumber,
        signatureAlgorithm,
        issuer,
        notBefore,
        notAfter,
        subject,
        publicKey,
        subjectAltNames: [],
        authority: { kind: "unstated" },
        keyUsage: [],
        extendedKeyUsage: [],
        selfIssued: issuer.text === subject.text,
    };
    if (extensionsField !== null) {
        applyExtensions(parsed, tbs.enter(extensionsField).enterTagged(tags.sequence));
    }
    return parsed;
}

export function signatureAlgorithmIdentifierOf(tbsCertificate: Uint8Array): Uint8Array {
    const outer = new DerReader(tbsCertificate);
    const tbs = outer.enterTagged(tags.sequence);
    outer.expectEnd();
    tbs.readOptional(explicitVersion);
    tbs.readTagged(tags.integer);
    return tbs.whole(tbs.readTagged(tags.sequence));
}

export function commonNameOf(name: DistinguishedName): string | null {
    const match = name.attributes.find(([type]) => type === "CN") ?? name.attributes.find(([type]) => type === "O");
    return match?.[1] ?? null;
}

function readAlgorithm(identifier: DerReader): Algorithm {
    const oid = readObjectIdentifier(identifier);
    return { oid, name: signatureAlgorithmNames.get(oid) ?? oid };
}

function readName(rdnSequence: DerReader): DistinguishedName {
    const attributes: [string, string][] = [];
    while (!rdnSequence.atEnd) {
        const relativeName = rdnSequence.enterTagged(tags.set);
        while (!relativeName.atEnd) {
            const attribute = relativeName.enterTagged(tags.sequence);
            const type = readObjectIdentifier(attribute);
            const value = attribute.read();
            attributes.push([attributeTypeNames.get(type) ?? type, decodeString(value.tag, attribute.content(value))]);
        }
    }
    const text = attributes.slice().reverse().map(([type, value]) => `${type}=${value}`).join(", ");
    return { text, attributes };
}

function readTime(reader: DerReader): Date {
    const element = reader.read();
    const text = latin1(reader.content(element));
    const match = (element.tag === tags.utcTime)
        ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(text)
        : (element.tag === tags.generalizedTime) ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\.\d+)?Z$/.exec(text) : null;
    if (match === null) {
        throw new MalformedDer(`unsupported time ${JSON.stringify(text)}`);
    }
    const [yearText, month, day, hour, minute, second] = match.slice(1).map(part => parseInt(part ?? "0", 10));
    const year = (element.tag === tags.utcTime) ? ((yearText < 50) ? 2000 + yearText : 1900 + yearText) : yearText;
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

function describePublicKey(info: DerReader): string {
    const identifier = info.enterTagged(tags.sequence);
    const algorithm = readObjectIdentifier(identifier);
    const key = info.content(info.readTagged(tags.bitString)).subarray(1);
    switch (algorithm) {
        case keyAlgorithms.rsa:
        case keyAlgorithms.rsaPss:
            return `RSA ${bitLength(new DerReader(key).enterTagged(tags.sequence))}`;
        case keyAlgorithms.ec: {
            const curve = identifier.peekTag() === tags.objectIdentifier ? readObjectIdentifier(identifier) : "explicit parameters";
            return `EC ${curveNames.get(curve) ?? curve}`;
        }
        case keyAlgorithms.dsa:
            return identifier.atEnd ? "DSA" : `DSA ${bitLength(identifier.enterTagged(tags.sequence))}`;
        default:
            return keyAlgorithmNames.get(algorithm) ?? algorithm;
    }
}

function applyExtensions(certificate: Certificate, list: DerReader): void {
    while (!list.atEnd) {
        const extension = list.enterTagged(tags.sequence);
        const id = readObjectIdentifier(extension);
        extension.readOptional(tags.boolean);
        const value = extension.content(extension.readTagged(tags.octetString));
        const reader = new DerReader(value);
        switch (id) {
            case extensions.subjectAltName:
                certificate.subjectAltNames = readGeneralNames(reader.enterTagged(tags.sequence));
                break;
            case extensions.basicConstraints:
                certificate.authority = readBasicConstraints(reader.enterTagged(tags.sequence));
                break;
            case extensions.keyUsage:
                certificate.keyUsage = readKeyUsage(reader.content(reader.readTagged(tags.bitString)));
                break;
            case extensions.extendedKeyUsage:
                certificate.extendedKeyUsage = readExtendedKeyUsage(reader.enterTagged(tags.sequence));
                break;
        }
    }
}

function decodeString(tag: number, bytes: Uint8Array): string {
    switch (tag) {
        case tags.utf8String:
            return utf8(bytes);
        case tags.bmpString:
            return codeUnits(bytes, 2);
        case tags.universalString:
            return codeUnits(bytes, 4);
        default:
            return latin1(bytes);
    }
}

function bitLength(integers: DerReader): number {
    const magnitude = withoutLeadingZeros(integers.content(integers.readTagged(tags.integer)));
    return (magnitude.length === 0) ? 0 : (magnitude.length - 1) * 8 + (32 - Math.clz32(magnitude[0]));
}

const generalNameKinds = new Map<number, (reader: DerReader, element: DerElement) => string>([
    [0xa0, (reader, element) => `othername:${readObjectIdentifier(reader.enter(element))}`],
    [0x81, (reader, element) => `email:${latin1(reader.content(element))}`],
    [0x82, (reader, element) => `DNS:${latin1(reader.content(element))}`],
    [0xa4, (reader, element) => `DirName:${readName(reader.enter(element).enterTagged(tags.sequence)).text}`],
    [0x86, (reader, element) => `URI:${latin1(reader.content(element))}`],
    [0x87, (reader, element) => `IP:${ipAddress(reader.content(element))}`],
    [0x88, (reader, element) => `RID:${objectIdentifier(reader.content(element))}`],
]);

function readGeneralNames(names: DerReader): string[] {
    const result: string[] = [];
    while (!names.atEnd) {
        const element = names.read();
        const describe = generalNameKinds.get(element.tag);
        if (describe !== undefined) {
            result.push(describe(names, element));
        }
    }
    return result;
}

function readBasicConstraints(constraints: DerReader): Authority {
    const isCa = constraints.readOptional(tags.boolean);
    if (isCa === null || constraints.content(isCa)[0] === 0) {
        return { kind: "end-entity" };
    }
    const pathLength = constraints.readOptional(tags.integer);
    return { kind: "ca", pathLength: (pathLength !== null) ? smallInteger(new DerReader(constraints.whole(pathLength))) : null };
}

function readKeyUsage(bitString: Uint8Array): string[] {
    const bits = bitString.subarray(1);
    return keyUsageNames.filter((_name, index) => index < bits.length * 8 && (bits[index >> 3] & (0x80 >> (index & 7))) !== 0);
}

function readExtendedKeyUsage(purposes: DerReader): string[] {
    const result: string[] = [];
    while (!purposes.atEnd) {
        const oid = readObjectIdentifier(purposes);
        result.push(extendedKeyUsageNames.get(oid) ?? oid);
    }
    return result;
}

function readObjectIdentifier(reader: DerReader): string {
    return objectIdentifier(reader.content(reader.readTagged(tags.objectIdentifier)));
}

function smallInteger(reader: DerReader): number {
    return reader.content(reader.readTagged(tags.integer)).reduce((value, byte) => value * 256 + byte, 0);
}

function colonHex(bytes: Uint8Array): string {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(":");
}

const replacementCharacter = 0xfffd;
const highestCodePoint = 0x10ffff;

function utf8(bytes: Uint8Array): string {
    const codePoints: number[] = [];
    for (let i = 0; i < bytes.length;) {
        const lead = bytes[i];
        const width = (lead < 0x80) ? 1 : (lead < 0xe0) ? 2 : (lead < 0xf0) ? 3 : 4;
        let codePoint = (width === 1) ? lead : lead & (0xff >> (width + 1));
        for (let j = 1; j < width; j++) {
            codePoint = (codePoint << 6) | ((bytes[i + j] ?? 0) & 0x3f);
        }
        codePoints.push((codePoint <= highestCodePoint) ? codePoint : replacementCharacter);
        i += width;
    }
    return String.fromCodePoint(...codePoints);
}

function codeUnits(bytes: Uint8Array, width: number): string {
    const codePoints: number[] = [];
    for (let i = 0; i + width <= bytes.length; i += width) {
        const codePoint = bytes.subarray(i, i + width).reduce((value, byte) => value * 256 + byte, 0);
        codePoints.push((codePoint <= highestCodePoint) ? codePoint : replacementCharacter);
    }
    return String.fromCodePoint(...codePoints);
}

function latin1(bytes: Uint8Array): string {
    return String.fromCharCode(...bytes);
}

function withoutLeadingZeros(bytes: Uint8Array): Uint8Array {
    let start = 0;
    while (start < bytes.length && bytes[start] === 0) {
        start++;
    }
    return bytes.subarray(start);
}

function ipAddress(bytes: Uint8Array): string {
    if (bytes.length === 4) {
        return Array.from(bytes).join(".");
    }
    const groups: string[] = [];
    for (let i = 0; i + 1 < bytes.length; i += 2) {
        groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
    }
    return groups.join(":");
}
