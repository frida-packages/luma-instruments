import type { ChannelTraffic } from "./channel-log.js";
import { EngineProcTable, PlatformMessage } from "./embedder-api.pat";
import { EmbedderMessages } from "./embedder-messages.js";
import type { ChannelWatch } from "./flutter-platforms.js";
import { objcClass } from "./objc-runtime.js";

export function watchMacosChannels(_engine: Module, traffic: ChannelTraffic): ChannelWatch {
    const tap = new MacosEngineTap(traffic);
    tap.start();
    return tap;
}

class MacosEngineTap implements ChannelWatch {
    readonly how = "-[FlutterEngine engineCallbackOnPlatformMessage:] and the embedder API in its _embedderAPI";
    readonly watching = true;

    readonly #traffic: ChannelTraffic;
    readonly #listeners: InvocationListener[] = [];
    #engineHandleOffset = 0;
    #procTableOffset = 0;
    #embedder: EmbedderMessages | null = null;

    constructor(traffic: ChannelTraffic) {
        this.#traffic = traffic;
    }

    start(): void {
        const engineClass = objcClass("FlutterEngine");
        this.#engineHandleOffset = engineClass.ivarOffset("_engine");
        this.#procTableOffset = engineClass.ivarOffset("_embedderAPI");
        const tap = this;
        this.#listeners.push(Interceptor.attach(engineClass.implementationOf("engineCallbackOnPlatformMessage:"), {
            onEnter(args) {
                tap.#messageToHost(args[0], PlatformMessage.at(args[2]));
            },
        }));
        this.#listeners.push(Interceptor.attach(engineClass.implementationOf("sendOnChannel:message:binaryReply:"), {
            onEnter(args) {
                tap.#embedderOf(args[0]);
            },
        }));
    }

    dispose(): void {
        for (const listener of this.#listeners) {
            listener.detach();
        }
        this.#embedder?.dispose();
    }

    #messageToHost(engine: NativePointer, message: PlatformMessage): void {
        this.#embedderOf(engine).messageToHost(engine.add(this.#engineHandleOffset).readPointer(), message);
    }

    #embedderOf(engine: NativePointer): EmbedderMessages {
        this.#embedder ??= new EmbedderMessages(EngineProcTable.at(engine.add(this.#procTableOffset)), this.#traffic);
        return this.#embedder;
    }
}
