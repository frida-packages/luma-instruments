import { readExecutableImage } from "./executable-image.js";
import { locateStaticBoringSsl, type BoringSslEntryPoints } from "./static-boringssl.js";

export type Direction = "sent" | "received";

export interface TlsTrafficObserver {
    onHandshake(session: NativePointer, library: TlsLibrary): void;
    onData(session: NativePointer, library: TlsLibrary, direction: Direction, data: NativePointer, length: number): void;
    onFree(session: NativePointer): void;
    onLibrary(report: LibraryReport): void;
}

export interface TlsLibrary {
    name: string;
    describe(session: NativePointer): SessionDetails;
}

export interface LibraryReport {
    module: string;
    backend: string;
    status: string;
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
    readonly #observer: TlsTrafficObserver;
    readonly #hookedModules = new Map<string, HookedModule>();
    readonly #claimedFunctions = new Set<string>();
    readonly #threadsInTransfer = new Set<ThreadId>();

    constructor(observer: TlsTrafficObserver) {
        this.#observer = observer;
    }

    hook(module: Module): void {
        const read = module.findExportByName("SSL_read");
        const write = module.findExportByName("SSL_write");
        if (read !== null && write !== null) {
            this.#hookExports(module, read, write);
        } else if (mayCarryStaticBoringSsl(module)) {
            this.#hookStaticBoringSsl(module);
        }
    }

    unhook(module: Module): void {
        const hooked = this.#hookedModules.get(module.path);
        if (hooked === undefined) {
            return;
        }
        this.#release(hooked);
        this.#hookedModules.delete(module.path);
    }

    unhookAll(): void {
        for (const hooked of this.#hookedModules.values()) {
            this.#release(hooked);
        }
        this.#hookedModules.clear();
    }

    #hookExports(module: Module, read: NativePointer, write: NativePointer): void {
        const library = openTlsLibrary(module);
        const hooked: HookedModule = { listeners: [], functions: [] };
        this.#attachTransfer(hooked, read, library, "received", returnedLength);
        this.#attachTransfer(hooked, module.findExportByName("SSL_read_ex"), library, "received", storedLength);
        this.#attachTransfer(hooked, write, library, "sent", returnedLength);
        this.#attachTransfer(hooked, module.findExportByName("SSL_write_ex"), library, "sent", storedLength);
        this.#attachHandshake(hooked, module.findExportByName("SSL_do_handshake"), library);
        this.#attachFree(hooked, module.findExportByName("SSL_free"));
        this.#hookedModules.set(module.path, hooked);
        this.#observer.onLibrary({ module: module.name, backend: "Exported SSL_read and SSL_write", status: "Hooked" });
    }

    #hookStaticBoringSsl(module: Module): void {
        const image = readExecutableImage(module.base);
        if (image === null) {
            return;
        }
        const location = locateStaticBoringSsl(image);
        switch (location.kind) {
            case "absent":
                return;
            case "unplaced":
                this.#observer.onLibrary({ module: module.name, backend: staticBackend, status: `Not hooked: ${location.reason}` });
                return;
            case "placed":
                this.#hookEntryPoints(module, location.entryPoints);
                this.#observer.onLibrary({ module: module.name, backend: staticBackend, status: placedStatus(location.entryPoints) });
                return;
        }
    }

    #hookEntryPoints(module: Module, entryPoints: BoringSslEntryPoints): void {
        const serverNames = new Map<string, string>();
        const library = staticBoringSslLibrary(module, serverNames);
        const hooked: HookedModule = { listeners: [], functions: [] };
        this.#attachTransfer(hooked, entryPoints.read, library, "received", returnedLength);
        this.#attachTransfer(hooked, entryPoints.write, library, "sent", returnedLength);
        this.#attachHandshake(hooked, entryPoints.doHandshake, library);
        this.#attachSessionCreation(hooked, entryPoints.newSession, serverNames);
        this.#attachServerNaming(hooked, entryPoints.setHostName, serverNames);
        this.#hookedModules.set(module.path, hooked);
    }

    #attachTransfer(
        hooked: HookedModule,
        target: NativePointer | null,
        library: TlsLibrary,
        direction: Direction,
        transferred: TransferredLength,
    ): void {
        const observer = this.#observer;
        const threadsInTransfer = this.#threadsInTransfer;
        this.#attach(hooked, target, {
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

    #attachHandshake(hooked: HookedModule, target: NativePointer | null, library: TlsLibrary): void {
        const observer = this.#observer;
        this.#attach(hooked, target, {
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

    #attachFree(hooked: HookedModule, target: NativePointer | null): void {
        const observer = this.#observer;
        this.#attach(hooked, target, {
            onEnter(args) {
                observer.onFree(args[0]);
            },
        });
    }

    #attachSessionCreation(hooked: HookedModule, target: NativePointer | null, serverNames: Map<string, string>): void {
        const observer = this.#observer;
        this.#attach(hooked, target, {
            onLeave(retval) {
                serverNames.delete(retval.toString());
                observer.onFree(retval);
            },
        });
    }

    #attachServerNaming(hooked: HookedModule, target: NativePointer | null, serverNames: Map<string, string>): void {
        this.#attach(hooked, target, {
            onEnter(args) {
                const name = args[1];
                if (name.isNull()) {
                    serverNames.delete(args[0].toString());
                } else {
                    serverNames.set(args[0].toString(), name.readUtf8String()!);
                }
            },
        });
    }

    #attach(hooked: HookedModule, target: NativePointer | null, callbacks: ScriptInvocationListenerCallbacks): void {
        if (target === null || this.#claimedFunctions.has(target.toString())) {
            return;
        }
        this.#claimedFunctions.add(target.toString());
        hooked.functions.push(target.toString());
        hooked.listeners.push(Interceptor.attach(target, callbacks));
    }

    #release(hooked: HookedModule): void {
        for (const listener of hooked.listeners) {
            listener.detach();
        }
        for (const target of hooked.functions) {
            this.#claimedFunctions.delete(target);
        }
    }
}

const systemModulePrefixes = (Process.platform === "darwin") ? ["/System/", "/usr/lib/"] : ["/system/", "/apex/", "/vendor/"];

function mayCarryStaticBoringSsl(module: Module): boolean {
    return !systemModulePrefixes.some(prefix => module.path.startsWith(prefix));
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
        name: module.name,
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

const staticBackend = "Static BoringSSL, found by its error reports";

function placedStatus(entryPoints: BoringSslEntryPoints): string {
    const hooked = [
        "SSL_read",
        "SSL_write",
        "SSL_do_handshake",
        ...(entryPoints.newSession !== null ? ["SSL_new"] : []),
        ...(entryPoints.setHostName !== null ? ["SSL_set_tlsext_host_name"] : []),
    ];
    return `Hooked ${hooked.join(", ")}`;
}

function staticBoringSslLibrary(module: Module, serverNames: Map<string, string>): TlsLibrary {
    return {
        name: module.name,
        describe(session) {
            return {
                serverName: serverNames.get(session.toString()) ?? null,
                version: null,
                cipher: null,
                alpn: null,
                peer: null,
                complete: true,
            };
        },
    };
}

function returnedLength(retval: InvocationReturnValue): number {
    return retval.toInt32();
}

function storedLength(retval: InvocationReturnValue, lengthStore: NativePointer): number {
    return retval.toInt32() === 1 ? lengthStore.readPointer().toUInt32() : 0;
}
