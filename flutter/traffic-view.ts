import type { ChannelLog, ChannelMessage, TrackedChannel, TrafficObserver } from "./channel-log.js";
import type { ChannelPages } from "./channel-pages.js";
import type { ChannelTable } from "./channel-table.js";
import { channelLabel, kindOf } from "./message-cells.js";
import type { MessageTable } from "./message-table.js";
import type { Settings } from "./settings.js";
import type { StatusLine } from "./status-line.js";

export class TrafficView implements TrafficObserver {
    readonly #ctx: CustomInstrumentContext;
    readonly #settings: Settings;
    readonly #log: ChannelLog;
    readonly #messages: MessageTable;
    readonly #channels: ChannelTable;
    readonly #pages: ChannelPages;
    readonly #status: StatusLine;

    constructor(ctx: CustomInstrumentContext, settings: Settings, log: ChannelLog,
        views: { messages: MessageTable; channels: ChannelTable; pages: ChannelPages; status: StatusLine }) {
        this.#ctx = ctx;
        this.#settings = settings;
        this.#log = log;
        this.#messages = views.messages;
        this.#channels = views.channels;
        this.#pages = views.pages;
        this.#status = views.status;
    }

    onChannelChanged(channel: TrackedChannel): void {
        this.#channels.show(channel);
        this.#pages.onChannelChanged(channel);
        this.#status.showTotals(this.#log.totals);
    }

    onMessage(message: ChannelMessage): void {
        this.#messages.show(message);
        this.#pages.onMessage(message);
        if (this.#settings.emitMessages) {
            this.#ctx.emit(messageEvent(message));
        }
    }

    onReply(message: ChannelMessage): void {
        this.#messages.update(message);
        this.#pages.onReply(message);
        if (this.#settings.emitMessages) {
            this.#ctx.emit({ ...messageEvent(message), reply: message.reply!.bytes.buffer, latencyMs: message.reply!.latencyMs });
        }
    }
}

function messageEvent(message: ChannelMessage): { [field: string]: unknown } {
    return {
        number: message.id,
        channel: channelLabel(message.channel),
        direction: message.direction,
        kind: kindOf(message),
        codec: (message.request.decoded.form === "empty") ? null : message.request.decoded.codec,
        size: message.size,
        data: message.bytes.buffer,
    };
}
