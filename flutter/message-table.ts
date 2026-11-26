import type { ChannelMessage } from "./channel-log.js";
import { messageCells } from "./message-cells.js";

export interface MessageTableWidget {
    upsertRow(row: { id: string; cells: Record<string, string> }): void;
    clear(): void;
}

const FLUSH_DELAY_MS = 200;
const ROWS_REMEMBERED = 2000;

export class MessageTable {
    readonly #widget: MessageTableWidget;
    readonly #withChannel: boolean;
    readonly #changed = new Set<ChannelMessage>();
    readonly #shown = new Set<number>();
    #pendingFlush: ReturnType<typeof setTimeout> | null = null;

    constructor(widget: MessageTableWidget, withChannel: boolean) {
        this.#widget = widget;
        this.#withChannel = withChannel;
        widget.clear();
    }

    show(message: ChannelMessage): void {
        this.#shown.add(message.id);
        if (this.#shown.size > ROWS_REMEMBERED) {
            this.#shown.delete(this.#shown.values().next().value!);
        }
        this.#changed.add(message);
        this.#pendingFlush ??= setTimeout(() => this.#flush(), FLUSH_DELAY_MS);
    }

    update(message: ChannelMessage): void {
        if (this.#shown.has(message.id)) {
            this.show(message);
        }
    }

    clear(): void {
        this.#changed.clear();
        this.#shown.clear();
        this.#widget.clear();
    }

    dispose(): void {
        if (this.#pendingFlush !== null) {
            clearTimeout(this.#pendingFlush);
            this.#flush();
        }
    }

    #flush(): void {
        this.#pendingFlush = null;
        for (const message of this.#changed) {
            const { channel, ...cells } = messageCells(message);
            this.#widget.upsertRow({ id: String(message.id), cells: this.#withChannel ? { channel, ...cells } : cells });
        }
        this.#changed.clear();
    }
}
