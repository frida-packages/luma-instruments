import type { TrackedChannel } from "./channel-log.js";
import { channelLabel, clockTime } from "./message-cells.js";
import { sizeText } from "./flutter-files.js";

type ChannelsWidget = CustomInstrumentWidgetMap["channels"];

const FLUSH_DELAY_MS = 250;
const MISSING = "—";

export class ChannelTable {
    readonly #widget: ChannelsWidget;
    readonly #changed = new Set<TrackedChannel>();
    #pendingFlush: ReturnType<typeof setTimeout> | null = null;

    constructor(widget: ChannelsWidget) {
        this.#widget = widget;
        widget.clear();
    }

    show(channel: TrackedChannel): void {
        this.#changed.add(channel);
        this.#pendingFlush ??= setTimeout(() => this.#flush(), FLUSH_DELAY_MS);
    }

    dispose(): void {
        if (this.#pendingFlush !== null) {
            clearTimeout(this.#pendingFlush);
            this.#flush();
        }
    }

    #flush(): void {
        this.#pendingFlush = null;
        for (const channel of this.#changed) {
            this.#widget.upsertRow({ id: channel.id, cells: channelCells(channel) });
        }
        this.#changed.clear();
    }
}

function channelCells(channel: TrackedChannel) {
    return {
        channel: channelLabel(channel),
        kind: (channel.kind === "unknown") ? MISSING : channel.kind,
        codec: channel.codec ?? MISSING,
        toHost: String(channel.toHost),
        toDart: String(channel.toDart),
        bytes: sizeText(channel.bytes),
        method: channel.lastMethod ?? MISSING,
        active: clockTime(channel.lastActive),
    };
}
