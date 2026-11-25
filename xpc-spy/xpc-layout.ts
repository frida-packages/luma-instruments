import { blocks } from "./block.js";
import { isOfType, xpc, xpcClasses, xpcErrors, xpcTypes } from "./xpc.js";
import { findCandidates, type HeapLocation, locateValue } from "./xpc-heap.js";

export interface XpcLayout {
    connectionSize: number;
    eventHandlerOffset: number;
    listenerOffset: number;
    serializerSize: number;
    replyHandlerOffset: number;
}

const ARRIVAL_TIMEOUT_MS = 1000;
const REMOVAL_TIMEOUT_MS = 5000;
const DISPATCH_TIME_NOW = 0;

const dispatch = {
    queueCreate: new NativeFunction(Module.getGlobalExportByName("dispatch_queue_create"), "pointer", ["pointer", "pointer"]),
    time: new NativeFunction(Module.getGlobalExportByName("dispatch_time"), "uint64", ["uint64", "int64"]),
    semaphoreCreate: new NativeFunction(Module.getGlobalExportByName("dispatch_semaphore_create"), "pointer", ["long"]),
    semaphoreWait: new NativeFunction(Module.getGlobalExportByName("dispatch_semaphore_wait"), "long", ["pointer", "uint64"]),
    semaphoreSignal: new NativeFunction(Module.getGlobalExportByName("dispatch_semaphore_signal"), "long", ["pointer"]),
    release: new NativeFunction(Module.getGlobalExportByName("dispatch_release"), "void", ["pointer"]),
};

let learned: XpcLayout | Error | null = null;
let currentProbe: LayoutProbe;

const probeEventHandler = blocks.makeGlobal(new NativeCallback((_block: NativePointer, event: NativePointer) => {
    currentProbe.onEvent(event);
}, "void", ["pointer", "pointer"]));

const probeReplyHandler = blocks.makeGlobal(new NativeCallback(() => {
    currentProbe.onReply();
}, "void", ["pointer", "pointer"]));

export function xpcLayout(): XpcLayout {
    learned ??= probeLayout();
    if (learned instanceof Error) {
        throw learned;
    }
    return learned;
}

function probeLayout(): XpcLayout | Error {
    currentProbe = new LayoutProbe();
    try {
        return currentProbe.run();
    } catch (error) {
        return error as Error;
    }
}

class LayoutProbe {
    readonly #queue = dispatch.queueCreate(Memory.allocUtf8String("re.frida.xpc-spy.layout-probe"), NULL);
    readonly #signals = new Semaphore();
    #listener = NULL;
    #client = NULL;
    readonly #peers: NativePointer[] = [];
    #request = NULL;
    #cancelled = 0;
    #invalidated = 0;
    #answered = false;
    #removing = false;

    run(): XpcLayout {
        this.#listener = this.#listen();
        this.#client = this.#connect();
        this.#sendRequest();
        try {
            if (!this.#waitUntil(() => this.#hasArrived(), ARRIVAL_TIMEOUT_MS)) {
                throw new Error("a request between two connections of XPC Spy's own did not arrive in time");
            }
            return this.#measure();
        } finally {
            this.#remove();
        }
    }

    onEvent(event: NativePointer): void {
        if (isOfType(event, xpcTypes.connection)) {
            this.#accept(event);
        } else if (isOfType(event, xpcTypes.dictionary)) {
            this.#hold(event);
        } else if (event.equals(xpcErrors.connectionInvalid)) {
            this.#invalidated++;
        }
        this.#signals.signal();
    }

    onReply(): void {
        this.#answered = true;
        this.#signals.signal();
    }

    #listen(): NativePointer {
        const listener = xpc.connectionCreate(NULL, NULL);
        this.#activate(listener);
        return listener;
    }

    #connect(): NativePointer {
        const endpoint = xpc.endpointCreate(this.#listener);
        const client = xpc.connectionCreateFromEndpoint(endpoint);
        xpc.release(endpoint);
        this.#activate(client);
        return client;
    }

    #sendRequest(): void {
        const request = xpc.dictionaryCreate(NULL, NULL, 0);
        xpc.connectionSendMessageWithReply(this.#client, request, this.#queue, probeReplyHandler);
        xpc.release(request);
    }

    #waitUntil(condition: () => boolean, timeoutMs: number): boolean {
        const deadline = Date.now() + timeoutMs;
        while (!condition()) {
            if (!this.#signals.waitFor(deadline - Date.now())) {
                return condition();
            }
        }
        return true;
    }

    #hasArrived(): boolean {
        return this.#peers.length !== 0 && !this.#request.isNull();
    }

    #measure(): XpcLayout {
        const [peer] = this.#peers;
        const eventHandlers = [this.#listener, this.#client, peer]
            .map(connection => onlyLocation(connection, probeEventHandler, "a connection's event handler"));
        const [eventHandler] = eventHandlers;
        if (eventHandlers.some(({ offset, size }) => offset !== eventHandler.offset || size !== eventHandler.size)) {
            throw new Error("libxpc did not keep the event handler in the same place in each of XPC Spy's own connections");
        }

        const listener = onlyLocation(peer, this.#listener, "a peer connection's listener");
        if ([this.#listener, this.#client].some(connection => !connection.add(listener.offset).readPointer().isNull())) {
            throw new Error("libxpc keeps something besides a peer connection's listener where it keeps that listener");
        }

        const pendingReply = pendingReplyLocation();
        return {
            connectionSize: eventHandler.size,
            eventHandlerOffset: eventHandler.offset,
            listenerOffset: listener.offset,
            serializerSize: pendingReply.size,
            replyHandlerOffset: pendingReply.offset,
        };
    }

    #remove(): void {
        this.#waitUntil(() => this.#hasArrived(), REMOVAL_TIMEOUT_MS);
        this.#removing = true;
        for (const connection of [...this.#peers, this.#client, this.#listener]) {
            this.#cancel(connection);
        }
        if (!this.#waitUntil(() => this.#invalidated === this.#cancelled && this.#answered, REMOVAL_TIMEOUT_MS)) {
            throw new Error("libxpc did not remove the connections XPC Spy made to learn its layout in time");
        }
        for (const object of [this.#request, ...this.#peers, this.#client, this.#listener].filter(object => !object.isNull())) {
            xpc.release(object);
        }
        this.#signals.dispose();
        dispatch.release(this.#queue);
    }

    #accept(peer: NativePointer): void {
        this.#peers.push(xpc.retain(peer));
        this.#activate(peer);
        if (this.#removing) {
            this.#cancel(peer);
        }
    }

    #hold(request: NativePointer): void {
        if (!this.#removing && this.#request.isNull()) {
            this.#request = xpc.retain(request);
        }
    }

    #activate(connection: NativePointer): void {
        xpc.connectionSetTargetQueue(connection, this.#queue);
        xpc.connectionSetEventHandler(connection, probeEventHandler);
        xpc.connectionActivate(connection);
    }

    #cancel(connection: NativePointer): void {
        this.#cancelled++;
        xpc.connectionCancel(connection);
    }
}

class Semaphore {
    readonly #handle = dispatch.semaphoreCreate(0);

    waitFor(milliseconds: number): boolean {
        const deadline = dispatch.time(DISPATCH_TIME_NOW, Math.round(Math.max(milliseconds, 0) * 1e6));
        return Number(dispatch.semaphoreWait(this.#handle, deadline)) === 0;
    }

    signal(): void {
        dispatch.semaphoreSignal(this.#handle);
    }

    dispose(): void {
        dispatch.release(this.#handle);
    }
}

function onlyLocation(connection: NativePointer, value: NativePointer, what: string): HeapLocation {
    const location = locateValue(connection, xpcClasses.connection, value);
    if (location === null || location.matches !== 1) {
        throw new Error(`could not tell where libxpc keeps ${what}`);
    }
    return location;
}

function pendingReplyLocation(): HeapLocation {
    const locations = findCandidates([xpcClasses.serializer])
        .map(({ address }) => locateValue(address, xpcClasses.serializer, probeReplyHandler))
        .filter(location => location !== null);
    if (locations.length !== 1 || locations[0].matches !== 1) {
        throw new Error("could not tell where libxpc keeps the reply handler of a request waiting for its reply");
    }
    return locations[0];
}
