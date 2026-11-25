import type { ChannelLog, ChannelMessage, TrackedChannel } from "./channel-log.js";
import { channelLabel } from "./message-cells.js";
import { MessageTable } from "./message-table.js";

type Pages = CustomInstrumentChildren<"channel">;

export type ChannelPage = CustomInstrumentChild<"channel">;

interface OpenPage {
    page: ChannelPage;
    table: MessageTable;
    shownRow: string;
}

const LONGEST_TITLE = 120;
const ROW_REFRESH_MS = 1000;

export class ChannelPages {
    readonly #pages: Pages;
    readonly #log: ChannelLog;
    readonly #open = new Map<string, OpenPage>();
    readonly #changed = new Set<TrackedChannel>();
    #pendingRefresh: ReturnType<typeof setTimeout> | null = null;

    constructor(pages: Pages, log: ChannelLog) {
        this.#pages = pages;
        this.#log = log;
    }

    show(channel: TrackedChannel): ChannelPage {
        const known = this.#open.get(channel.id);
        if (known !== undefined) {
            return known.page;
        }
        const row = rowOf(channel);
        const page = this.#pages.add(channel.id, row);
        const table = new MessageTable(page.widget("messages"), false);
        this.#open.set(channel.id, { page, table, shownRow: JSON.stringify(row) });
        for (const message of this.#log.messagesOf(channel)) {
            table.show(message);
        }
        return page;
    }

    pageOf(id: string): ChannelPage | undefined {
        return this.#open.get(id)?.page;
    }

    onMessage(message: ChannelMessage): void {
        this.#open.get(message.channel.id)?.table.show(message);
    }

    onReply(message: ChannelMessage): void {
        this.#open.get(message.channel.id)?.table.update(message);
    }

    onChannelChanged(channel: TrackedChannel): void {
        if (this.#open.has(channel.id)) {
            this.#changed.add(channel);
            this.#pendingRefresh ??= setTimeout(() => this.#refreshRows(), ROW_REFRESH_MS);
        }
    }

    clear(id: string): void {
        this.#open.get(id)?.table.clear();
    }

    dispose(): void {
        if (this.#pendingRefresh !== null) {
            clearTimeout(this.#pendingRefresh);
        }
        for (const { table } of this.#open.values()) {
            table.dispose();
        }
    }

    #refreshRows(): void {
        this.#pendingRefresh = null;
        for (const channel of this.#changed) {
            const open = this.#open.get(channel.id)!;
            const row = rowOf(channel);
            const text = JSON.stringify(row);
            if (text !== open.shownRow) {
                open.shownRow = text;
                open.page.update(row);
            }
        }
        this.#changed.clear();
    }
}

function rowOf(channel: TrackedChannel): CustomInstrumentChildRow {
    const kind = (channel.kind === "unknown") ? "channel" : `${channel.kind} channel`;
    return {
        title: channelLabel(channel).slice(0, LONGEST_TITLE),
        subtitle: `${kind}${(channel.codec !== null) ? `, ${channel.codec} codec` : ""}`,
        badge: { text: String(channel.toHost + channel.toDart), tone: "neutral" },
    };
}
