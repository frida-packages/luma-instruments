import { utf8Text } from "./utf8.js";

export interface VmService {
    url: string;
    version: string | null;
    isolates: IsolateFacts[];
    unreachable: string | null;
}

export interface IsolateFacts {
    id: string;
    name: string;
    system: boolean;
    rootLibrary: string | null;
    libraries: string[];
}

interface VmResult {
    version: string;
    isolates: IsolateReference[];
    systemIsolates?: IsolateReference[];
}

interface IsolateReference {
    id: string;
    name: string;
}

interface IsolateResult {
    rootLib?: { uri: string };
    libraries?: { uri: string }[];
}

const HIGHEST_HANDLE = 4096;
const LOOPBACK = new Set(["127.0.0.1", "::1"]);
const SERVICE_PATH = /^\/([A-Za-z0-9_=-]+=)\//;
const URL_READ = 96;
const HEADER_END = "\r\n\r\n";
const READ_SIZE = 65536;

export async function findVmService(): Promise<VmService | null> {
    for (const port of listeningLoopbackPorts()) {
        const token = await serviceTokenFor(port);
        if (token !== null) {
            return await describeService(port, token).catch((e: Error) => ({
                url: serviceUrl(port, token),
                version: null,
                isolates: [],
                unreachable: e.message,
            }));
        }
    }
    return null;
}

function listeningLoopbackPorts(): number[] {
    const ports: number[] = [];
    for (let handle = 0; handle < HIGHEST_HANDLE; handle++) {
        const type = Socket.type(handle);
        if (type !== "tcp" && type !== "tcp6") {
            continue;
        }
        const local = Socket.localAddress(handle);
        if (local !== null && "ip" in local && LOOPBACK.has(local.ip) && Socket.peerAddress(handle) === null) {
            ports.push(local.port);
        }
    }
    return ports;
}

async function serviceTokenFor(port: number): Promise<string | null> {
    const prefix = `http://127.0.0.1:${port}`;
    const pattern = Array.from(prefix, character => character.charCodeAt(0).toString(16)).join(" ");
    for (const range of Process.enumerateRanges("rw-")) {
        for (const address of await matchesIn(range, pattern)) {
            const tail = latin1(address.add(prefix.length).readByteArray(URL_READ)!);
            const path = SERVICE_PATH.exec(tail);
            if (path !== null) {
                return path[1];
            }
        }
    }
    return null;
}

function matchesIn(range: RangeDetails, pattern: string): Promise<NativePointer[]> {
    const matches: NativePointer[] = [];
    const matchesBeforeAnyUnreadableMemory = () => matches;
    return Memory.scan(range.base, range.size, pattern, {
        onMatch(address) {
            matches.push(address);
        },
    }).then(matchesBeforeAnyUnreadableMemory, matchesBeforeAnyUnreadableMemory);
}

function serviceUrl(port: number, token: string): string {
    return `http://127.0.0.1:${port}/${token}/`;
}

async function describeService(port: number, token: string): Promise<VmService> {
    const path = `/${token}/`;
    const vm = await call<VmResult>(port, `${path}getVM`);
    const references = [...vm.isolates.map(isolate => ({ ...isolate, system: false })),
        ...(vm.systemIsolates ?? []).map(isolate => ({ ...isolate, system: true }))];
    const isolates: IsolateFacts[] = [];
    for (const reference of references) {
        const isolate = reference.system ? {} : await call<IsolateResult>(port, `${path}getIsolate?isolateId=${encodeURIComponent(reference.id)}`);
        isolates.push({
            id: reference.id,
            name: reference.name,
            system: reference.system,
            rootLibrary: isolate.rootLib?.uri ?? null,
            libraries: (isolate.libraries ?? []).map(library => library.uri),
        });
    }
    return { url: serviceUrl(port, token), version: vm.version, isolates, unreachable: null };
}

async function call<T>(port: number, path: string): Promise<T> {
    const response = await httpGet(port, path);
    const reply = JSON.parse(response) as { result?: T; error?: { message: string } };
    if (reply.result === undefined) {
        throw new Error(`The VM service refused ${path}: ${reply.error?.message ?? response.slice(0, 200)}`);
    }
    return reply.result;
}

async function httpGet(port: number, path: string): Promise<string> {
    const connection = await Socket.connect({ family: "ipv4", host: "127.0.0.1", port });
    const request = `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`;
    await connection.output.writeAll(Array.from(request, character => character.charCodeAt(0)));
    let received = "";
    let body: string | null = null;
    while (body === null) {
        const chunk = await connection.input.read(READ_SIZE);
        if (chunk.byteLength === 0) {
            break;
        }
        received += latin1(chunk);
        body = completeBody(received);
    }
    await connection.close();
    return utf8Of(body ?? completeBody(received) ?? "");
}

function completeBody(received: string): string | null {
    const headerEnd = received.indexOf(HEADER_END);
    if (headerEnd === -1) {
        return null;
    }
    const headers = received.slice(0, headerEnd).toLowerCase();
    const content = received.slice(headerEnd + HEADER_END.length);
    if (headers.includes("transfer-encoding: chunked")) {
        return dechunked(content);
    }
    const length = /content-length: (\d+)/.exec(headers);
    return (length !== null && content.length >= Number(length[1])) ? content.slice(0, Number(length[1])) : null;
}

function dechunked(content: string): string | null {
    let body = "";
    let at = 0;
    for (;;) {
        const lineEnd = content.indexOf("\r\n", at);
        if (lineEnd === -1) {
            return null;
        }
        const size = parseInt(content.slice(at, lineEnd), 16);
        if (size === 0) {
            return body;
        }
        const chunkStart = lineEnd + 2;
        if (content.length < chunkStart + size + 2) {
            return null;
        }
        body += content.slice(chunkStart, chunkStart + size);
        at = chunkStart + size + 2;
    }
}

function latin1(bytes: ArrayBuffer): string {
    let text = "";
    const view = new Uint8Array(bytes);
    for (let i = 0; i < view.length; i += 8192) {
        text += String.fromCharCode(...view.subarray(i, i + 8192));
    }
    return text;
}

function utf8Of(latin1Text: string): string {
    return utf8Text(Uint8Array.from(latin1Text, character => character.charCodeAt(0))) ?? latin1Text;
}
