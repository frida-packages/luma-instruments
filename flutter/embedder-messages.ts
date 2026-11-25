import type { ChannelTraffic } from "./channel-log.js";
import { EngineProcTable, PlatformMessage } from "./embedder-api.pat";

const SUCCESS = 0;

export class EmbedderMessages {
    readonly #traffic: ChannelTraffic;
    readonly #listeners: InvocationListener[] = [];
    readonly #hookedReplyCallbacks = new Set<string>();
    readonly #replyContexts = new Map<string, NativePointer>();
    readonly #awaitedReplies = new Map<string, number>();
    readonly #awaitedResponses = new Map<string, number>();

    constructor(procs: EngineProcTable, traffic: ChannelTraffic) {
        this.#traffic = traffic;
        this.#hookSends(procs.sendPlatformMessage);
        this.#hookResponseHandles(procs.platformMessageCreateResponseHandle);
        this.#hookResponses(procs.sendPlatformMessageResponse);
    }

    messageToHost(engine: NativePointer, message: PlatformMessage): void {
        const handle = message.responseHandle;
        const id = this.#traffic.messageSent({
            engine: engine.toString(),
            direction: "to-host",
            channel: message.channel.readUtf8String()!,
            data: message.message,
            size: message.messageSize.toNumber(),
            expectsReply: !handle.isNull(),
        });
        if (id !== null && !handle.isNull()) {
            this.#awaitedResponses.set(handle.toString(), id);
        }
    }

    dispose(): void {
        for (const listener of this.#listeners) {
            listener.detach();
        }
    }

    #hookSends(target: NativePointer): void {
        const embedder = this;
        this.#listeners.push(Interceptor.attach(target, {
            onEnter(args) {
                embedder.#messageToDart(args[0], PlatformMessage.at(args[1]));
            },
        }));
    }

    #messageToDart(engine: NativePointer, message: PlatformMessage): void {
        const handle = message.responseHandle;
        const id = this.#traffic.messageSent({
            engine: engine.toString(),
            direction: "to-dart",
            channel: message.channel.readUtf8String()!,
            data: message.message,
            size: message.messageSize.toNumber(),
            expectsReply: !handle.isNull(),
        });
        const context = this.#replyContexts.get(handle.toString());
        this.#replyContexts.delete(handle.toString());
        if (id !== null && context !== undefined) {
            this.#awaitedReplies.set(context.toString(), id);
        }
    }

    #hookResponseHandles(target: NativePointer): void {
        const embedder = this;
        this.#listeners.push(Interceptor.attach(target, {
            onEnter(args) {
                this.callback = args[1];
                this.replyContext = args[2];
                this.handleStore = args[3];
            },
            onLeave(result) {
                if (result.toInt32() === SUCCESS) {
                    embedder.#rememberReplyContext(this.handleStore.readPointer(), this.callback, this.replyContext);
                }
            },
        }));
    }

    #rememberReplyContext(handle: NativePointer, callback: NativePointer, context: NativePointer): void {
        this.#replyContexts.set(handle.toString(), context);
        if (!this.#hookedReplyCallbacks.has(callback.toString())) {
            this.#hookedReplyCallbacks.add(callback.toString());
            this.#hookReplyCallback(callback);
        }
    }

    #hookReplyCallback(target: NativePointer): void {
        const embedder = this;
        this.#listeners.push(Interceptor.attach(target, {
            onEnter(args) {
                embedder.#replyFromDart(args[2], args[0], args[1].toUInt32());
            },
        }));
    }

    #replyFromDart(context: NativePointer, data: NativePointer, size: number): void {
        const id = this.#awaitedReplies.get(context.toString());
        if (id !== undefined) {
            this.#awaitedReplies.delete(context.toString());
            this.#traffic.replySent(id, data, size);
        }
    }

    #hookResponses(target: NativePointer): void {
        const embedder = this;
        this.#listeners.push(Interceptor.attach(target, {
            onEnter(args) {
                embedder.#responseFromHost(args[1], args[2], args[3].toUInt32());
            },
        }));
    }

    #responseFromHost(handle: NativePointer, data: NativePointer, size: number): void {
        const id = this.#awaitedResponses.get(handle.toString());
        if (id !== undefined) {
            this.#awaitedResponses.delete(handle.toString());
            this.#traffic.replySent(id, data, size);
        }
    }
}
