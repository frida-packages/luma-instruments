export const tags = {
    boolean: 0x01,
    integer: 0x02,
    bitString: 0x03,
    octetString: 0x04,
    null: 0x05,
    objectIdentifier: 0x06,
    utf8String: 0x0c,
    printableString: 0x13,
    teletexString: 0x14,
    ia5String: 0x16,
    utcTime: 0x17,
    generalizedTime: 0x18,
    visibleString: 0x1a,
    universalString: 0x1c,
    bmpString: 0x1e,
    sequence: 0x30,
    set: 0x31,
} as const;

export class MalformedDer extends Error {
}

export interface DerElement {
    tag: number;
    start: number;
    contentStart: number;
    end: number;
}

export function declaredLength(header: Uint8Array): number {
    return new DerReader(header).readHeader().end;
}

const highTagNumberForm = 0x1f;
const indefiniteLength = 0x80;
const longFormLength = 0x80;
const maximumLengthOctets = 3;

export class DerReader {
    private readonly bytes: Uint8Array;
    private offset: number;
    private readonly limit: number;

    constructor(bytes: Uint8Array, start = 0, limit = bytes.length) {
        this.bytes = bytes;
        this.offset = start;
        this.limit = limit;
    }

    enterTagged(tag: number): DerReader {
        return this.enter(this.readTagged(tag));
    }

    expectEnd(): void {
        if (!this.atEnd) {
            throw new MalformedDer(`unexpected data at ${this.offset}`);
        }
    }

    readTagged(tag: number): DerElement {
        const element = this.read();
        if (element.tag !== tag) {
            throw new MalformedDer(`expected tag 0x${tag.toString(16)} at ${element.start}, found 0x${element.tag.toString(16)}`);
        }
        return element;
    }

    readOptional(tag: number): DerElement | null {
        return this.peekTag() === tag ? this.read() : null;
    }

    enter(element: DerElement): DerReader {
        return new DerReader(this.bytes, element.contentStart, element.end);
    }

    content(element: DerElement): Uint8Array {
        return this.bytes.subarray(element.contentStart, element.end);
    }

    whole(element: DerElement): Uint8Array {
        return this.bytes.subarray(element.start, element.end);
    }

    peekTag(): number | null {
        return this.atEnd ? null : this.bytes[this.offset];
    }

    get atEnd(): boolean {
        return this.offset === this.limit;
    }

    read(): DerElement {
        const element = this.readHeader();
        if (element.end > this.limit) {
            throw new MalformedDer(`element at ${element.start} runs past its container`);
        }
        this.offset = element.end;
        return element;
    }

    readHeader(): DerElement {
        const start = this.offset;
        const tag = this.byteAt(start);
        if ((tag & highTagNumberForm) === highTagNumberForm) {
            throw new MalformedDer(`unsupported tag 0x${tag.toString(16)} at ${start}`);
        }
        let cursor = start + 1;
        const first = this.byteAt(cursor++);
        let length = first;
        if (first === indefiniteLength) {
            throw new MalformedDer(`indefinite length at ${start}`);
        }
        if ((first & longFormLength) !== 0) {
            const octets = first & ~longFormLength;
            if (octets > maximumLengthOctets) {
                throw new MalformedDer(`length of ${octets} octets at ${start}`);
            }
            length = 0;
            for (let i = 0; i !== octets; i++) {
                length = length * 256 + this.byteAt(cursor++);
            }
        }
        return { tag, start, contentStart: cursor, end: cursor + length };
    }

    private byteAt(offset: number): number {
        if (offset >= this.limit) {
            throw new MalformedDer(`truncated at ${offset}`);
        }
        return this.bytes[offset];
    }
}

export function objectIdentifier(content: Uint8Array): string {
    if (content.length === 0) {
        throw new MalformedDer("empty object identifier");
    }
    const arcs: number[] = [];
    let value = 0;
    for (const byte of content) {
        value = value * 128 + (byte & 0x7f);
        if ((byte & 0x80) === 0) {
            arcs.push(value);
            value = 0;
        }
    }
    if ((content[content.length - 1] & 0x80) !== 0) {
        throw new MalformedDer("truncated object identifier");
    }
    const first = arcs.shift()!;
    const leading = first < 80 ? [Math.floor(first / 40), first % 40] : [2, first - 80];
    return [...leading, ...arcs].join(".");
}

export function encodeElement(tag: number, ...parts: Uint8Array[]): Uint8Array {
    const contentLength = parts.reduce((total, part) => total + part.length, 0);
    const header = [tag, ...encodedLength(contentLength)];
    const encoded = new Uint8Array(header.length + contentLength);
    encoded.set(header);
    let offset = header.length;
    for (const part of parts) {
        encoded.set(part, offset);
        offset += part.length;
    }
    return encoded;
}

function encodedLength(length: number): number[] {
    if (length < longFormLength) {
        return [length];
    }
    const octets: number[] = [];
    for (let remaining = length; remaining !== 0; remaining = Math.floor(remaining / 256)) {
        octets.unshift(remaining & 0xff);
    }
    return [longFormLength | octets.length, ...octets];
}
