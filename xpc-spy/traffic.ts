import { blocks } from "./block.js";
import { connectionName, isOfType, xpc, xpcEntryPoints, xpcTypes } from "./xpc.js";

export type Direction = "sent" | "received";
export type Kind = "message" | "request" | "reply" | "error" | "peer";

export interface Capture {
    seq: number;
    direction: Direction;
    kind: Kind;
    service: string;
    pid: number;
    object: NativePointer;
    time: number;
    reply?: ReplyLink;
    backtrace?: NativePointer[];
}

export interface ReplyLink {
    to: number;
    latencyMs: number;
}

export interface CapturePolicy {
    readonly backtraces: boolean;
    wants(service: string): boolean;
}

interface OutstandingRequest {
    seq: number;
    service: string;
    issuedAt: number;
}

type UndeliveredCapture = Omit<Capture, "seq">;

type HandlerRole = "event" | "reply";

const ANONYMOUS_SERVICE = "(anonymous)";
const REMEMBERED_CONNECTIONS = 4096;
const CLOCK_UPTIME_RAW = 8;

const uptimeNanoseconds = new NativeFunction(Module.getGlobalExportByName("clock_gettime_nsec_np"), "uint64", ["int"]);

export class XpcTap {
    private readonly listeners: InvocationListener[] = [];
    private readonly hookedInvokes = new Set<string>();
    private readonly handlerServices = new Map<string, string>();
    private readonly peerServices = new Map<string, string>();
    private readonly pendingReplies = new Map<string, OutstandingRequest>();
    private nextSeq = 1;

    constructor(private readonly policy: CapturePolicy, private readonly sink: (capture: Capture) => void) {
    }

    start(): void {
        const tap = this;
        this.listeners.push(
            Interceptor.attach(xpcEntryPoints.sendMessage, {
                onEnter(args) {
                    tap.recordSent(args[0], args[1], "message", this.context);
                }
            }),
            Interceptor.attach(xpcEntryPoints.sendMessageWithReply, {
                onEnter(args) {
                    this.handler = tap.watchAsyncRequest(args, this.context);
                },
                onLeave() {
                    if (this.handler !== null) {
                        blocks.release(this.handler);
                    }
                }
            }),
            Interceptor.attach(xpcEntryPoints.sendMessageWithReplySync, {
                onEnter(args) {
                    this.connection = args[0];
                    this.request = tap.recordSent(args[0], args[1], "request", this.context);
                },
                onLeave(reply) {
                    if (this.request !== null) {
                        tap.recordReply(this.request, this.connection, reply);
                    }
                }
            }),
            Interceptor.attach(xpcEntryPoints.setEventHandler, {
                onEnter(args) {
                    this.handler = tap.adoptEventHandler(args);
                },
                onLeave() {
                    blocks.release(this.handler);
                }
            }),
        );
    }

    stop(): void {
        for (const listener of this.listeners) {
            listener.detach();
        }
        this.listeners.length = 0;
    }

    private recordSent(connection: NativePointer, message: NativePointer, kind: Kind, context: CpuContext): OutstandingRequest | null {
        const service = this.serviceOf(connection);
        if (!this.policy.wants(service)) {
            return null;
        }
        const capture = this.capture("sent", kind, service, xpc.connectionGetPid(connection), message);
        if (this.policy.backtraces) {
            capture.backtrace = Thread.backtrace(context, Backtracer.ACCURATE);
        }
        const { seq } = this.deliver(capture);
        return (kind === "request") ? { seq, service, issuedAt: uptimeNanoseconds(CLOCK_UPTIME_RAW).toNumber() } : null;
    }

    private watchAsyncRequest(args: InvocationArguments, context: CpuContext): NativePointer | null {
        const request = this.recordSent(args[0], args[1], "request", context);
        if (request === null) {
            return null;
        }
        const handler = blocks.copy(args[3]);
        args[3] = handler;
        this.pendingReplies.set(handler.toString(), request);
        this.hookHandler(handler, "reply");
        return handler;
    }

    private recordReply(request: OutstandingRequest, connection: NativePointer, reply: NativePointer): void {
        const kind = isOfType(reply, xpcTypes.error) ? "error" : "reply";
        const pid = connection.isNull() ? 0 : xpc.connectionGetPid(connection);
        const capture = this.capture("received", kind, request.service, pid, reply);
        capture.reply = { to: request.seq, latencyMs: (uptimeNanoseconds(CLOCK_UPTIME_RAW).toNumber() - request.issuedAt) / 1e6 };
        this.deliver(capture);
    }

    private adoptEventHandler(args: InvocationArguments): NativePointer {
        const handler = blocks.copy(args[1]);
        args[1] = handler;
        remember(this.handlerServices, handler.toString(), this.serviceOf(args[0]));
        this.hookHandler(handler, "event");
        return handler;
    }

    private hookHandler(handler: NativePointer, role: HandlerRole): void {
        const invoke = blocks.invokeOf(handler);
        const key = invoke.toString();
        if (this.hookedInvokes.has(key)) {
            return;
        }
        this.hookedInvokes.add(key);
        const tap = this;
        this.listeners.push(Interceptor.attach(invoke, {
            onEnter(args) {
                tap.onHandlerInvoked(args[0], args[1], role);
            }
        }));
    }

    private onHandlerInvoked(handler: NativePointer, object: NativePointer, role: HandlerRole): void {
        const key = handler.toString();
        const request = this.pendingReplies.get(key);
        if (request !== undefined) {
            this.pendingReplies.delete(key);
            this.recordReply(request, remoteConnectionOf(object), object);
            return;
        }
        const service = this.handlerServices.get(key);
        if (service !== undefined) {
            this.recordEvent(service, object);
            return;
        }
        this.recordDeliveryToUnseenHandler(object, role);
    }

    private recordEvent(handlerService: string, event: NativePointer): void {
        if (isOfType(event, xpcTypes.connection)) {
            remember(this.peerServices, event.toString(), handlerService);
            this.recordReceived("peer", handlerService, xpc.connectionGetPid(event), event);
        } else if (isOfType(event, xpcTypes.error)) {
            this.recordReceived("error", handlerService, 0, event);
        } else {
            const remote = remoteConnectionOf(event);
            const service = remote.isNull() ? handlerService : connectionName(remote) ?? handlerService;
            this.recordReceived("message", service, remote.isNull() ? 0 : xpc.connectionGetPid(remote), event);
        }
    }

    private recordDeliveryToUnseenHandler(object: NativePointer, role: HandlerRole): void {
        const remote = remoteConnectionOf(object);
        if (remote.isNull()) {
            return;
        }
        this.recordReceived((role === "reply") ? "reply" : "message", this.serviceOf(remote), xpc.connectionGetPid(remote), object);
    }

    private recordReceived(kind: Kind, service: string, pid: number, object: NativePointer): void {
        if (this.policy.wants(service)) {
            this.deliver(this.capture("received", kind, service, pid, object));
        }
    }

    private capture(direction: Direction, kind: Kind, service: string, pid: number, object: NativePointer): UndeliveredCapture {
        return {
            direction,
            kind,
            service,
            pid,
            object: xpc.retain(object),
            time: Date.now(),
        };
    }

    private deliver(capture: UndeliveredCapture): Capture {
        const delivered = { seq: this.nextSeq++, ...capture };
        this.sink(delivered);
        return delivered;
    }

    private serviceOf(connection: NativePointer): string {
        return connectionName(connection) ?? this.peerServices.get(connection.toString()) ?? ANONYMOUS_SERVICE;
    }
}

function remoteConnectionOf(object: NativePointer): NativePointer {
    return isOfType(object, xpcTypes.dictionary) ? xpc.dictionaryGetRemoteConnection(object) : NULL;
}

function remember(map: Map<string, string>, key: string, value: string): void {
    map.delete(key);
    map.set(key, value);
    if (map.size > REMEMBERED_CONNECTIONS) {
        map.delete(map.keys().next().value!);
    }
}
