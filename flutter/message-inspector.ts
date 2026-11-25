import type { ChannelMessage } from "./channel-log.js";
import { channelLabel, clockTime, kindOf } from "./message-cells.js";
import type { Decoded, Decoding } from "./message-decoding.js";

export interface ConsoleSink {
    output(text: string): void;
    value(value: unknown): void;
}

export function inspectMessage(message: ChannelMessage, sink: ConsoleSink): void {
    const direction = (message.direction === "to-host") ? "Dart → host" : "host → Dart";
    sink.output(`#${message.id} ${direction} on ${channelLabel(message.channel)} at ${clockTime(message.sentAt)}: `
        + `${kindOf(message)}, ${codecText(message.request.decoded)}, ${message.size} B`);
    showDecoding(message.request, message.size, message.bytes, sink);
    const { reply } = message;
    if (!message.expectsReply) {
        sink.output("No reply expected.");
    } else if (reply === null) {
        sink.output("No reply yet.");
    } else {
        sink.output(`Reply after ${reply.latencyMs} ms: ${outcomeOf(reply.decoding.decoded)}, ${codecText(reply.decoding.decoded)}, ${reply.size} B`);
        showDecoding(reply.decoding, reply.size, reply.bytes, sink);
    }
}

function codecText(decoded: Decoded): string {
    return (decoded.form === "empty") ? "no bytes" : `${decoded.codec} codec`;
}

function showDecoding(decoding: Decoding, size: number, bytes: Uint8Array, sink: ConsoleSink): void {
    const { decoded } = decoding;
    if (decoded.form !== "empty") {
        sink.value(plainValueOf(decoded));
    }
    if (decoded.form !== "empty" && decoded.partial) {
        sink.output("Decoding stopped at a value of a type the standard codec leaves to the app's own codec, such as one Pigeon generates; "
            + "the rest is shown undecoded.");
    }
    if (decoding.truncated) {
        sink.output(`Only the first ${bytes.byteLength} of ${size} bytes were kept; raise "Bytes kept per message" to keep more.`);
    }
}

function outcomeOf(decoded: Decoded): string {
    switch (decoded.form) {
        case "success":
            return "success";
        case "error":
            return `error ${decoded.code}`;
        case "empty":
            return "empty, which a method channel reads as no handler";
        default:
            return "value";
    }
}

function plainValueOf(decoded: Exclude<Decoded, { form: "empty" }>): unknown {
    switch (decoded.form) {
        case "call":
            return { method: decoded.method, arguments: decoded.args };
        case "success":
            return { result: decoded.result };
        case "error":
            return { code: decoded.code, message: decoded.message, details: decoded.details };
        case "value":
            return decoded.value;
    }
}
