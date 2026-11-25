import { readStandardValues } from "./standard-codec.js";
import { utf8Text } from "./utf8.js";

export type Codec = "standard" | "json" | "string" | "binary";

export type Decoded =
    | { form: "call"; codec: Codec; method: string; args: unknown; partial: boolean }
    | { form: "success"; codec: Codec; result: unknown; partial: boolean }
    | { form: "error"; codec: Codec; code: string; message: unknown; details: unknown; partial: boolean }
    | { form: "value"; codec: Codec; value: unknown; partial: boolean }
    | { form: "empty" };

export interface Decoding {
    decoded: Decoded;
    truncated: boolean;
}

type Decoder = (bytes: Uint8Array) => Decoded | null;

const ENVELOPE_SUCCESS = 0;
const ENVELOPE_ERROR = 1;
const SMALLEST_HALTED_PREFIX = 2;
const CONTROL_CHARACTERS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

export function decodeRequest(bytes: Uint8Array, size: number, unanswered: boolean): Decoding {
    const decoders = unanswered ? unansweredRequestDecoders : requestDecoders;
    return { decoded: firstDecoding(bytes, decoders), truncated: bytes.byteLength < size };
}

export function decodeReply(bytes: Uint8Array, size: number, request: Decoded): Decoding {
    return { decoded: firstDecoding(bytes, replyDecodersFor(request)), truncated: bytes.byteLength < size };
}

const requestDecoders: Decoder[] = [standardCall, jsonCall, standardValue, jsonValue, text, binary];
const unansweredRequestDecoders: Decoder[] = [standardCall, jsonCall, standardEnvelope, standardValue, jsonValue, text, binary];

function firstDecoding(bytes: Uint8Array, decoders: Decoder[]): Decoded {
    if (bytes.byteLength === 0) {
        return { form: "empty" };
    }
    for (const decode of decoders) {
        const decoded = attempt(decode, bytes);
        if (decoded !== null) {
            return decoded;
        }
    }
    return binary(bytes);
}

function attempt(decode: Decoder, bytes: Uint8Array): Decoded | null {
    try {
        return decode(bytes);
    } catch (e) {
        if (e instanceof RangeError) {
            return null;
        }
        throw e;
    }
}

function replyDecodersFor(request: Decoded): Decoder[] {
    const codec = (request.form === "empty") ? "binary" : request.codec;
    if (request.form === "call") {
        return (codec === "json") ? [jsonEnvelope, jsonValue, standardEnvelope, text, binary] : [standardEnvelope, jsonEnvelope, standardValue, text, binary];
    }
    switch (codec) {
        case "standard":
            return [standardValue, jsonValue, text, binary];
        case "json":
            return [jsonValue, standardValue, text, binary];
        case "string":
            return [text, standardValue, jsonValue, binary];
        case "binary":
            return [binary];
    }
}

function standardCall(bytes: Uint8Array): Decoded | null {
    const { values, complete, halted } = readStandardValues(bytes, 2);
    const [method, args] = values;
    if (typeof method !== "string" || !(complete || (halted && values.length === 2))) {
        return null;
    }
    return { form: "call", codec: "standard", method, args, partial: halted };
}

function jsonCall(bytes: Uint8Array): Decoded | null {
    const value = parsedJson(bytes);
    if (!isRecord(value) || typeof value.method !== "string") {
        return null;
    }
    return { form: "call", codec: "json", method: value.method, args: value.args ?? null, partial: false };
}

function standardEnvelope(bytes: Uint8Array): Decoded | null {
    const outcome = bytes[0];
    if (outcome === ENVELOPE_SUCCESS) {
        const { values, complete, halted } = readStandardValues(bytes, 1, 1);
        return (complete || (halted && values.length === 1)) ? { form: "success", codec: "standard", result: values[0], partial: halted } : null;
    }
    if (outcome === ENVELOPE_ERROR) {
        return standardError(bytes);
    }
    return null;
}

function standardError(bytes: Uint8Array): Decoded | null {
    for (const count of [3, 4]) {
        const { values, complete, halted } = readStandardValues(bytes, count, 1);
        const [code, message, details] = values;
        if (typeof code === "string" && (complete || (halted && values.length >= 2))) {
            return { form: "error", codec: "standard", code, message, details, partial: halted };
        }
    }
    return null;
}

function standardValue(bytes: Uint8Array): Decoded | null {
    const { values, complete, halted, decodedBytes } = readStandardValues(bytes, 1);
    if (complete || (halted && decodedBytes >= SMALLEST_HALTED_PREFIX)) {
        return { form: "value", codec: "standard", value: values[0], partial: halted };
    }
    return null;
}

function jsonEnvelope(bytes: Uint8Array): Decoded | null {
    const value = parsedJson(bytes);
    if (!Array.isArray(value)) {
        return null;
    }
    if (value.length === 1) {
        return { form: "success", codec: "json", result: value[0], partial: false };
    }
    if ((value.length === 3 || value.length === 4) && typeof value[0] === "string") {
        return { form: "error", codec: "json", code: value[0], message: value[1], details: value[2], partial: false };
    }
    return null;
}

function jsonValue(bytes: Uint8Array): Decoded | null {
    const value = parsedJson(bytes);
    return (value !== undefined) ? { form: "value", codec: "json", value, partial: false } : null;
}

function text(bytes: Uint8Array): Decoded | null {
    const value = utf8Text(bytes);
    return (value !== null && !CONTROL_CHARACTERS.test(value)) ? { form: "value", codec: "string", value, partial: false } : null;
}

function binary(bytes: Uint8Array): Decoded {
    return { form: "value", codec: "binary", value: bytes, partial: false };
}

function parsedJson(bytes: Uint8Array): unknown {
    const first = bytes[0];
    if (first !== 0x7b && first !== 0x5b && first !== 0x22) {
        return undefined;
    }
    const source = utf8Text(bytes);
    if (source === null) {
        return undefined;
    }
    try {
        return JSON.parse(source);
    } catch {
        return undefined;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
