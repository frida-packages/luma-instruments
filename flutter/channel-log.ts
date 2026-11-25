import { type Codec, type Decoded, type Decoding, decodeReply, decodeRequest } from "./message-decoding.js";
import type { Settings } from "./settings.js";

export type Direction = "to-host" | "to-dart";

export type ChannelKind = "method" | "event" | "message" | "unknown";

export interface MessageSource {
    engine: string;
    direction: Direction;
    channel: string;
    data: NativePointer;
    size: number;
    expectsReply: boolean;
}

export interface ChannelTraffic {
    messageSent(source: MessageSource): number | null;
    replySent(id: number, data: NativePointer, size: number): void;
}

export interface ChannelMessage {
    readonly id: number;
    readonly channel: TrackedChannel;
    readonly direction: Direction;
    readonly sentAt: number;
    readonly size: number;
    readonly bytes: Uint8Array;
    readonly request: Decoding;
    readonly expectsReply: boolean;
    reply: Reply | null;
}

export interface Reply {
    readonly size: number;
    readonly bytes: Uint8Array;
    readonly decoding: Decoding;
    readonly latencyMs: number;
}

export interface TrackedChannel {
    readonly id: string;
    readonly name: string;
    readonly engine: number;
    kind: ChannelKind;
    codec: Codec | null;
    toHost: number;
    toDart: number;
    bytes: number;
    lastMethod: string | null;
    lastActive: number;
}

export interface TrafficObserver {
    onChannelChanged(channel: TrackedChannel): void;
    onMessage(message: ChannelMessage): void;
    onReply(message: ChannelMessage): void;
}

export interface TrafficTotals {
    messages: number;
    unshown: number;
    engines: number;
}

const MESSAGES_KEPT = 2000;
const RATE_WINDOW_MS = 1000;
const EVENT_CHANNEL_METHODS = new Set(["listen", "cancel"]);

export class ChannelLog implements ChannelTraffic {
    readonly #settings: Settings;
    readonly #observers: TrafficObserver[] = [];
    readonly #messages = new Map<number, ChannelMessage>();
    readonly #channels = new Map<string, TrackedChannel>();
    readonly #engines = new Map<string, number>();
    #nextMessageId = 1;
    #totalMessages = 0;
    #totalUnshown = 0;
    #windowStart = 0;
    #shownInWindow = 0;

    constructor(settings: Settings) {
        this.#settings = settings;
    }

    observe(observer: TrafficObserver): void {
        this.#observers.push(observer);
    }

    get totals(): TrafficTotals {
        return { messages: this.#totalMessages, unshown: this.#totalUnshown, engines: this.#engines.size };
    }

    channels(): TrackedChannel[] {
        return [...this.#channels.values()];
    }

    channel(id: string): TrackedChannel | undefined {
        return this.channels().find(channel => channel.id === id);
    }

    message(id: number): ChannelMessage | undefined {
        return this.#messages.get(id);
    }

    messagesOf(channel: TrackedChannel): ChannelMessage[] {
        return [...this.#messages.values()].filter(message => message.channel === channel);
    }

    messageSent(source: MessageSource): number | null {
        if (this.#settings.hides(source.channel)) {
            return null;
        }
        const channel = this.#channelOf(source);
        this.#totalMessages++;
        this.#count(channel, source);
        if (!this.#admits()) {
            this.#totalUnshown++;
            this.#notifyChannel(channel);
            return null;
        }
        const message = this.#record(channel, source);
        this.#learn(channel, message);
        this.#notifyChannel(channel);
        for (const observer of this.#observers) {
            observer.onMessage(message);
        }
        return message.id;
    }

    replySent(id: number, data: NativePointer, size: number): void {
        const message = this.#messages.get(id);
        if (message === undefined) {
            return;
        }
        const bytes = this.#copy(data, size);
        message.reply = { size, bytes, decoding: decodeReply(bytes, size, message.request.decoded), latencyMs: Date.now() - message.sentAt };
        message.channel.bytes += size;
        for (const observer of this.#observers) {
            observer.onReply(message);
        }
        this.#notifyChannel(message.channel);
    }

    #channelOf(source: MessageSource): TrackedChannel {
        const engine = this.#engineNumber(source.engine);
        const key = `${engine}/${source.channel}`;
        let channel = this.#channels.get(key);
        if (channel === undefined) {
            channel = {
                id: `c${this.#channels.size + 1}`,
                name: source.channel,
                engine,
                kind: "unknown",
                codec: null,
                toHost: 0,
                toDart: 0,
                bytes: 0,
                lastMethod: null,
                lastActive: 0,
            };
            this.#channels.set(key, channel);
        }
        return channel;
    }

    #engineNumber(engine: string): number {
        let number = this.#engines.get(engine);
        if (number === undefined) {
            number = this.#engines.size + 1;
            this.#engines.set(engine, number);
        }
        return number;
    }

    #count(channel: TrackedChannel, source: MessageSource): void {
        if (source.direction === "to-host") {
            channel.toHost++;
        } else {
            channel.toDart++;
        }
        channel.bytes += source.size;
        channel.lastActive = Date.now();
    }

    #admits(): boolean {
        const now = Date.now();
        if (now - this.#windowStart >= RATE_WINDOW_MS) {
            this.#windowStart = now;
            this.#shownInWindow = 0;
        }
        this.#shownInWindow++;
        return this.#shownInWindow <= this.#settings.messagesPerSecond;
    }

    #record(channel: TrackedChannel, source: MessageSource): ChannelMessage {
        const bytes = this.#copy(source.data, source.size);
        const unanswered = !source.expectsReply && source.direction === "to-dart";
        const message: ChannelMessage = {
            id: this.#nextMessageId++,
            channel,
            direction: source.direction,
            sentAt: Date.now(),
            size: source.size,
            bytes,
            request: decodeRequest(bytes, source.size, unanswered),
            expectsReply: source.expectsReply,
            reply: null,
        };
        this.#messages.set(message.id, message);
        if (this.#messages.size > MESSAGES_KEPT) {
            this.#messages.delete(this.#messages.keys().next().value!);
        }
        return message;
    }

    #learn(channel: TrackedChannel, message: ChannelMessage): void {
        const { decoded } = message.request;
        if (decoded.form === "empty") {
            return;
        }
        channel.codec = decoded.codec;
        channel.kind = kindAfter(channel.kind, decoded, message.direction);
        if (decoded.form === "call") {
            channel.lastMethod = decoded.method;
        }
    }

    #notifyChannel(channel: TrackedChannel): void {
        for (const observer of this.#observers) {
            observer.onChannelChanged(channel);
        }
    }

    #copy(data: NativePointer, size: number): Uint8Array {
        const kept = Math.min(size, this.#settings.bytesKept);
        return (kept === 0) ? new Uint8Array(0) : new Uint8Array(data.readByteArray(kept)!);
    }
}

function kindAfter(kind: ChannelKind, decoded: Decoded, direction: Direction): ChannelKind {
    if (kind === "event") {
        return kind;
    }
    switch (decoded.form) {
        case "call":
            return (direction === "to-host" && EVENT_CHANNEL_METHODS.has(decoded.method)) ? "event" : "method";
        case "success":
        case "error":
            return "event";
        default:
            return (kind === "unknown") ? "message" : kind;
    }
}
