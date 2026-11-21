import { invokedSelector } from "./nsxpc.js";
import type { ServiceBoard } from "./services.js";
import type { Settings } from "./settings.js";
import { summarize } from "./summary.js";
import type { Capture, Direction, Kind } from "./traffic.js";
import { xpc } from "./xpc.js";
import { toJavaScript } from "./xpc-value.js";

export interface MessageEvent {
    direction: Direction;
    kind: Kind;
    service: string;
    pid?: number;
    seq: number;
    inReplyTo?: number;
    latencyMs?: number;
    selector?: string;
    message: unknown;
    backtrace?: string[];
}

const FLUSH_DELAY_MS = 50;
const RECALLABLE_MESSAGES = 500;
const GIST_LENGTH = 120;

const arrows: Record<Direction, string> = { sent: "→", received: "←" };

export class Recorder {
    private queue: Capture[] = [];
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly recallable = new Map<number, MessageEvent>();
    private readonly requestSelectors = new Map<number, string>();

    constructor(
        private readonly ctx: CustomInstrumentContext,
        private readonly settings: Settings,
        private readonly services: ServiceBoard,
    ) {
    }

    record(capture: Capture): void {
        this.queue.push(capture);
        if (this.flushTimer === null) {
            this.flushTimer = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
        }
    }

    recall(seq: number): MessageEvent | undefined {
        return this.recallable.get(seq);
    }

    discard(): void {
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        for (const capture of this.queue) {
            xpc.release(capture.object);
        }
        this.queue = [];
    }

    private flush(): void {
        this.flushTimer = null;
        const captures = this.queue;
        this.queue = [];
        const log = this.ctx.widget("messages");
        for (const capture of captures) {
            const event = this.eventFrom(capture);
            xpc.release(capture.object);

            this.ctx.emit(event);

            const gist = event.selector ?? summarize(event.message, GIST_LENGTH);
            const clock = clockTime(capture.time);
            this.services.note(event, `${arrows[event.direction]} ${event.kind} ${gist}`, clock);
            log.appendOutput(logLine(event, gist, clock));
            this.keepRecallable(event);
        }
        this.services.publish();
    }

    private eventFrom(capture: Capture): MessageEvent {
        const selector = this.selectorOf(capture);
        const link = capture.reply;
        return {
            direction: capture.direction,
            kind: capture.kind,
            service: capture.service,
            ...((capture.pid !== 0) ? { pid: capture.pid } : {}),
            seq: capture.seq,
            ...((link !== undefined) ? { inReplyTo: link.to, latencyMs: roundToMicroseconds(link.latencyMs) } : {}),
            ...((selector !== null) ? { selector } : {}),
            message: toJavaScript(capture.object, this.settings.dataLimit),
            ...((capture.backtrace !== undefined) ? { backtrace: capture.backtrace.map(symbolicate) } : {}),
        };
    }

    private selectorOf(capture: Capture): string | null {
        if (capture.reply !== undefined) {
            const selector = this.requestSelectors.get(capture.reply.to) ?? null;
            this.requestSelectors.delete(capture.reply.to);
            return selector;
        }
        const selector = invokedSelector(capture.object);
        if (selector !== null && capture.kind === "request") {
            this.requestSelectors.set(capture.seq, selector);
        }
        return selector;
    }

    private keepRecallable(event: MessageEvent): void {
        this.recallable.set(event.seq, event);
        if (this.recallable.size > RECALLABLE_MESSAGES) {
            this.recallable.delete(this.recallable.keys().next().value!);
        }
    }
}

function clockTime(time: number): string {
    const date = new Date(time);
    return `${date.toTimeString().slice(0, 8)}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function logLine(event: MessageEvent, gist: string, clock: string): string {
    const reply = (event.inReplyTo !== undefined) ? ` to #${event.inReplyTo} in ${event.latencyMs} ms` : "";
    return `#${event.seq} ${clock} ${arrows[event.direction]} ${event.service} ${event.kind}${reply} ${gist}`;
}

function roundToMicroseconds(milliseconds: number): number {
    return Math.round(milliseconds * 1000) / 1000;
}

function symbolicate(address: NativePointer): string {
    return DebugSymbol.fromAddress(address).toString();
}
