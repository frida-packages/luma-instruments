import type { Direction } from "./tls-libraries.js";

export type Http1StartLine =
    | { kind: "request"; method: string; path: string }
    | { kind: "response"; status: number };

const startLineReadLimit = 2048;
const carriageReturn = 0x0d;
const capitalA = 0x41;
const capitalH = 0x48;
const capitalZ = 0x5a;

export function readHttp1StartLine(direction: Direction, data: NativePointer, length: number): Http1StartLine | null {
    const first = data.readU8();
    const mayStartLine = direction === "sent" ? first >= capitalA && first <= capitalZ : first === capitalH;
    if (!mayStartLine) {
        return null;
    }

    const line = firstLine(new Uint8Array(data.readByteArray(Math.min(length, startLineReadLimit))!));
    if (line === null) {
        return null;
    }
    return direction === "sent" ? parseRequestLine(line) : parseStatusLine(line);
}

function firstLine(bytes: Uint8Array): string | null {
    const end = bytes.indexOf(carriageReturn);
    return end !== -1 ? String.fromCharCode(...bytes.subarray(0, end)) : null;
}

const requestLinePattern = /^([A-Z]+) (\S+) HTTP\/1\.[01]$/;
const statusLinePattern = /^HTTP\/1\.[01] (\d{3})(?: .*)?$/;

function parseRequestLine(line: string): Http1StartLine | null {
    const match = requestLinePattern.exec(line);
    return match !== null ? { kind: "request", method: match[1], path: match[2] } : null;
}

function parseStatusLine(line: string): Http1StartLine | null {
    const match = statusLinePattern.exec(line);
    return match !== null ? { kind: "response", status: parseInt(match[1], 10) } : null;
}
