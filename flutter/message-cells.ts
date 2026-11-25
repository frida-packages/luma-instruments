import type { ChannelMessage, TrackedChannel } from "./channel-log.js";
import type { Decoded } from "./message-decoding.js";
import { summaryOf } from "./value-text.js";

const SUMMARY_LENGTH = 160;
const MISSING = "—";
const AWAITED = "…";

export function messageCells(message: ChannelMessage): Record<string, string> {
    return {
        number: String(message.id),
        time: clockTime(message.sentAt),
        direction: (message.direction === "to-host") ? "Dart → host" : "host → Dart",
        channel: channelLabel(message.channel),
        kind: kindOf(message),
        message: requestSummary(message),
        reply: replySummary(message),
        size: sizeSummary(message),
        latency: (message.reply !== null) ? `${message.reply.latencyMs} ms` : "",
    };
}

export function clockTime(timestamp: number): string {
    const time = new Date(timestamp);
    const seconds = [time.getHours(), time.getMinutes(), time.getSeconds()].map(part => String(part).padStart(2, "0")).join(":");
    return `${seconds}.${String(time.getMilliseconds()).padStart(3, "0")}`;
}

export function channelLabel(channel: TrackedChannel): string {
    return (channel.engine > 1) ? `${channel.name} · engine ${channel.engine}` : channel.name;
}

export function kindOf(message: ChannelMessage): string {
    const { decoded } = message.request;
    switch (decoded.form) {
        case "call":
            return "call";
        case "success":
            return "event";
        case "error":
            return "event error";
        default:
            return "message";
    }
}

function requestSummary(message: ChannelMessage): string {
    return withTruncation(summaryOf(message.request.decoded, SUMMARY_LENGTH), message.request.truncated);
}

function replySummary(message: ChannelMessage): string {
    if (!message.expectsReply) {
        return MISSING;
    }
    const { reply } = message;
    if (reply === null) {
        return AWAITED;
    }
    return withTruncation(replyText(reply.decoding.decoded, message.request.decoded), reply.decoding.truncated);
}

function replyText(reply: Decoded, request: Decoded): string {
    if (reply.form === "empty") {
        return (request.form === "call") ? "(empty: no handler)" : "(empty)";
    }
    return summaryOf(reply, SUMMARY_LENGTH);
}

function sizeSummary(message: ChannelMessage): string {
    const sent = `${message.size} B`;
    return (message.reply !== null) ? `${sent} → ${message.reply.size} B` : sent;
}

function withTruncation(summary: string, truncated: boolean): string {
    return truncated ? `${summary} (cut short)` : summary;
}
