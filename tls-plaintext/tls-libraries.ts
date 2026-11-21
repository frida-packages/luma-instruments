export type Direction = "sent" | "received";

export interface TlsTrafficObserver {
    onHandshake(session: NativePointer, library: TlsLibrary): void;
    onData(session: NativePointer, library: TlsLibrary, direction: Direction, data: NativePointer, length: number): void;
    onFree(session: NativePointer): void;
}

export interface TlsLibrary {
    describe(session: NativePointer): SessionDetails;
}

export interface SessionDetails {
    serverName: string | null;
    version: string | null;
    cipher: string | null;
    alpn: string | null;
    peer: string | null;
    complete: boolean;
}

export interface TlsLibraryWatch {
    dispose(): void;
}

export function watchTlsLibraries(observer: TlsTrafficObserver): TlsLibraryWatch {
    const interceptor = new TlsInterceptor(observer);
    const moduleObserver = Process.attachModuleObserver({
        onAdded(module) {
            interceptor.hook(module);
        },
        onRemoved(module) {
            interceptor.unhook(module);
        },
    });

    return {
        dispose() {
            moduleObserver.detach();
            interceptor.unhookAll();
        },
    };
}

interface HookedModule {
    listeners: InvocationListener[];
    functions: string[];
}

type TransferredLength = (retval: InvocationReturnValue, lengthStore: NativePointer) => number;

class TlsInterceptor {
    private readonly observer: TlsTrafficObserver;
    private readonly hookedModules = new Map<string, HookedModule>();
    private readonly claimedFunctions = new Set<string>();
    private readonly threadsInTransfer = new Set<ThreadId>();

    constructor(observer: TlsTrafficObserver) {
        this.observer = observer;
    }

    hook(module: Module): void {
        const read = module.findExportByName("SSL_read");
        const write = module.findExportByName("SSL_write");
        if (read === null || write === null) {
            return;
        }

        const library = openTlsLibrary(module);
        const hooked: HookedModule = { listeners: [], functions: [] };
        this.attachTransfer(hooked, read, library, "received", returnedLength);
        this.attachTransfer(hooked, module.findExportByName("SSL_read_ex"), library, "received", storedLength);
        this.attachTransfer(hooked, write, library, "sent", returnedLength);
        this.attachTransfer(hooked, module.findExportByName("SSL_write_ex"), library, "sent", storedLength);
        this.attachHandshake(hooked, module.findExportByName("SSL_do_handshake"), library);
        this.attachFree(hooked, module.findExportByName("SSL_free"));
        this.hookedModules.set(module.path, hooked);
    }

    unhook(module: Module): void {
        const hooked = this.hookedModules.get(module.path);
        if (hooked === undefined) {
            return;
        }
        this.release(hooked);
        this.hookedModules.delete(module.path);
    }

    unhookAll(): void {
        for (const hooked of this.hookedModules.values()) {
            this.release(hooked);
        }
        this.hookedModules.clear();
    }

    private attachTransfer(
        hooked: HookedModule,
        target: NativePointer | null,
        library: TlsLibrary,
        direction: Direction,
        transferred: TransferredLength,
    ): void {
        const { observer, threadsInTransfer } = this;
        this.attach(hooked, target, {
            onEnter(args) {
                this.outermost = !threadsInTransfer.has(this.threadId);
                if (!this.outermost) {
                    return;
                }
                threadsInTransfer.add(this.threadId);
                this.session = args[0];
                this.data = args[1];
                this.lengthStore = args[3];
            },
            onLeave(retval) {
                if (!this.outermost) {
                    return;
                }
                threadsInTransfer.delete(this.threadId);
                const length = transferred(retval, this.lengthStore);
                if (length > 0) {
                    observer.onData(this.session, library, direction, this.data, length);
                }
            },
        });
    }

    private attachHandshake(hooked: HookedModule, target: NativePointer | null, library: TlsLibrary): void {
        const { observer } = this;
        this.attach(hooked, target, {
            onEnter(args) {
                this.session = args[0];
            },
            onLeave(retval) {
                if (retval.toInt32() === 1) {
                    observer.onHandshake(this.session, library);
                }
            },
        });
    }

    private attachFree(hooked: HookedModule, target: NativePointer | null): void {
        const { observer } = this;
        this.attach(hooked, target, {
            onEnter(args) {
                observer.onFree(args[0]);
            },
        });
    }

    private attach(hooked: HookedModule, target: NativePointer | null, callbacks: ScriptInvocationListenerCallbacks): void {
        if (target === null || this.claimedFunctions.has(target.toString())) {
            return;
        }
        this.claimedFunctions.add(target.toString());
        hooked.functions.push(target.toString());
        hooked.listeners.push(Interceptor.attach(target, callbacks));
    }

    private release(hooked: HookedModule): void {
        for (const listener of hooked.listeners) {
            listener.detach();
        }
        for (const target of hooked.functions) {
            this.claimedFunctions.delete(target);
        }
    }
}

const hostNameType = 0;

function openTlsLibrary(module: Module): TlsLibrary {
    const serverName = exportedFunction(module, "SSL_get_servername", "pointer", ["pointer", "int"]);
    const protocolVersion = exportedFunction(module, "SSL_version", "int", ["pointer"]);
    const currentCipher = exportedFunction(module, "SSL_get_current_cipher", "pointer", ["pointer"]);
    const cipherName = exportedFunction(module, "SSL_CIPHER_get_name", "pointer", ["pointer"]);
    const selectedAlpn = exportedFunction(module, "SSL_get0_alpn_selected", "void", ["pointer", "pointer", "pointer"]);
    const socketHandle = exportedFunction(module, "SSL_get_fd", "int", ["pointer"]);

    return {
        describe(session) {
            const cipher = currentCipher?.(session);
            const negotiated = cipher !== undefined && !cipher.isNull();
            return {
                serverName: stringAt(serverName?.(session, hostNameType)),
                version: negotiated ? versionName(protocolVersion?.(session)) : null,
                cipher: negotiated ? stringAt(cipherName?.(cipher)) : null,
                alpn: selectedAlpn !== null ? alpnProtocol(selectedAlpn, session) : null,
                peer: peerAddress(socketHandle?.(session)),
                complete: negotiated || currentCipher === null,
            };
        },
    };
}

function exportedFunction<R extends NativeFunctionReturnType, A extends NativeFunctionArgumentType[] | []>(
    module: Module,
    name: string,
    retType: R,
    argTypes: A,
) {
    const address = module.findExportByName(name);
    return address !== null ? new NativeFunction(address, retType, argTypes) : null;
}

function stringAt(address: NativePointer | undefined): string | null {
    return address === undefined || address.isNull() ? null : address.readUtf8String();
}

const versionNames = new Map([
    [0x0300, "SSL 3.0"],
    [0x0301, "TLS 1.0"],
    [0x0302, "TLS 1.1"],
    [0x0303, "TLS 1.2"],
    [0x0304, "TLS 1.3"],
    [0xfeff, "DTLS 1.0"],
    [0xfefd, "DTLS 1.2"],
    [0xfefc, "DTLS 1.3"],
    [0x0001, "QUIC"],
]);

function versionName(version: number | undefined): string | null {
    if (version === undefined) {
        return null;
    }
    return versionNames.get(version) ?? `0x${version.toString(16)}`;
}

type AlpnGetter = NativeFunction<void, [NativePointerValue, NativePointerValue, NativePointerValue]>;

function alpnProtocol(selectedAlpn: AlpnGetter, session: NativePointer): string | null {
    const protocol = Memory.alloc(Process.pointerSize);
    const length = Memory.alloc(4);
    selectedAlpn(session, protocol, length);
    const byteLength = length.readU32();
    return byteLength !== 0 ? protocol.readPointer().readUtf8String(byteLength) : null;
}

function peerAddress(handle: number | undefined): string | null {
    if (handle === undefined || handle < 0) {
        return null;
    }
    const address = Socket.peerAddress(handle);
    if (address === null || !("ip" in address)) {
        return null;
    }
    const ip = address.ip.replace(/^::ffff:/, "");
    return ip.includes(":") ? `[${ip}]:${address.port}` : `${ip}:${address.port}`;
}

function returnedLength(retval: InvocationReturnValue): number {
    return retval.toInt32();
}

function storedLength(retval: InvocationReturnValue, lengthStore: NativePointer): number {
    return retval.toInt32() === 1 ? lengthStore.readPointer().toUInt32() : 0;
}
