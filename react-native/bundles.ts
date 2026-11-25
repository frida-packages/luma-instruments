import { Buffer } from "buffer";
import { HermesBytecodeHeader } from "./hermes-bytecode.pat";
import { lastPathComponent } from "./runtime-descriptions.js";
import type { Runtime } from "./runtimes.js";

export type BundleFormat = "Hermes bytecode" | "JavaScript";

export type BundleLocation = { kind: "file"; path: string } | { kind: "memory"; address: NativePointer };

export interface Bundle {
    number: number;
    location: BundleLocation;
    size: number;
    format: BundleFormat;
    bytecodeVersion: number | null;
    runtimes: Set<number>;
}

export interface OfferReply {
    output(text: string): void;
    error(text: string): void;
    file: CustomInstrumentActionResponder["file"];
}

type BundleTableWidget = CustomInstrumentWidgetMap["bundles"];

const HERMES_BYTECODE_MAGIC = uint64("0x1f1903c103bc1fc6");
const LOWEST_BYTECODE_VERSION = 59;
const HIGHEST_BYTECODE_VERSION = 255;
const SMALLEST_BUNDLE_IN_MEMORY = 4096;
const BUNDLE_FILE = /\.(jsbundle|bundle|hbc)$/i;
const LARGEST_SEARCHED_RANGE = 512 * 1048576;
const LARGEST_OFFER = 64 * 1048576;
const CHUNK_BYTES = 1048576;
const DARWIN_PRIVATE_ALIASES = /^\/private\/(tmp|var|etc)\//;
const UNSAFE_IN_FILE_NAMES = /[\\/<>:"|?*\x00-\x1f\x7f]/g;

const mediaTypes: Record<BundleFormat, string> = {
    "Hermes bytecode": "application/octet-stream",
    "JavaScript": "text/javascript",
};

export class BundleCatalog {
    readonly #table: BundleTableWidget;
    readonly #bundles: Bundle[] = [];

    constructor(table: BundleTableWidget) {
        this.#table = table;
        table.clear();
    }

    async scan(): Promise<number> {
        const before = this.#bundles.length;
        for (const path of mappedBundleFiles()) {
            this.#remember({ kind: "file", path });
        }
        for (const address of await hermesBytecodeInMemory()) {
            this.#remember({ kind: "memory", address });
        }
        return this.#bundles.length - before;
    }

    noteRuntime(runtime: Runtime): void {
        const path = filePathOf(runtime.facts?.bundleURL ?? null);
        const bundle = (path !== null) ? this.#remember({ kind: "file", path }) : null;
        if (bundle !== null && !bundle.runtimes.has(runtime.number)) {
            bundle.runtimes.add(runtime.number);
            this.#show(bundle);
        }
    }

    bundleOf(runtime: Runtime): Bundle | null {
        return this.#bundles.find(bundle => bundle.runtimes.has(runtime.number)) ?? null;
    }

    numbered(number: number): Bundle | undefined {
        return this.#bundles.find(bundle => bundle.number === number);
    }

    offer(bundle: Bundle, reply: OfferReply): void {
        if (bundle.size > LARGEST_OFFER) {
            reply.error(`Bundle #${bundle.number} is ${formattedSize(bundle.size)}, more than the ${LARGEST_OFFER / 1048576} MiB `
                + "a file offered for saving can be.");
            return;
        }
        const name = fileNameOf(bundle);
        const file = reply.file({ name, mediaType: mediaTypes[bundle.format] });
        for (const chunk of chunksOf(bundle)) {
            file.write(Buffer.from(chunk));
        }
        file.end();
        reply.output(`Offered bundle #${bundle.number} (${bundle.format}, ${formattedSize(bundle.size)}) for saving as ${name}.`);
    }

    #remember(location: BundleLocation): Bundle | null {
        const known = this.#bundles.find(bundle => sameLocation(bundle.location, location));
        if (known !== undefined) {
            return known;
        }
        const contents = contentsAt(location);
        if (contents === null) {
            return null;
        }
        const bundle: Bundle = { number: this.#bundles.length + 1, location, ...contents, runtimes: new Set() };
        this.#bundles.push(bundle);
        this.#show(bundle);
        return bundle;
    }

    #show(bundle: Bundle): void {
        this.#table.upsertRow({
            id: String(bundle.number),
            cells: {
                number: `#${bundle.number}`,
                where: (bundle.location.kind === "file") ? bundle.location.path : `memory at ${bundle.location.address}`,
                format: (bundle.bytecodeVersion !== null) ? `${bundle.format} ${bundle.bytecodeVersion}` : bundle.format,
                size: formattedSize(bundle.size),
                loadedBy: [...bundle.runtimes].map(number => `#${number}`).join(", ") || "—",
            },
        });
    }
}

function mappedBundleFiles(): string[] {
    const paths = Process.enumerateRanges("r--")
        .filter(range => range.file !== undefined && range.file.offset === 0 && BUNDLE_FILE.test(range.file.path))
        .map(range => range.file!.path);
    return [...new Set(paths)];
}

async function hermesBytecodeInMemory(): Promise<NativePointer[]> {
    const pattern = HermesBytecodeHeader.pattern({ magic: HERMES_BYTECODE_MAGIC });
    const found: NativePointer[] = [];
    for (const range of Process.enumerateRanges("r--")) {
        if (range.file !== undefined || range.size > LARGEST_SEARCHED_RANGE) {
            continue;
        }
        found.push(...matchesIn(range, pattern));
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    return found.filter(address => (bytecodeHeaderAt(address)?.fileLength ?? 0) >= SMALLEST_BUNDLE_IN_MEMORY);
}

function matchesIn(range: MemoryRange, pattern: string): NativePointer[] {
    try {
        return Memory.scanSync(range.base, range.size, pattern).map(match => match.address);
    } catch (e) {
        return [];
    }
}

function filePathOf(url: string | null): string | null {
    if (url === null) {
        return null;
    }
    if (url.startsWith("file://")) {
        return decodeURIComponent(url.slice("file://".length));
    }
    return url.startsWith("/") ? url : null;
}

function formattedSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    const kib = bytes / 1024;
    return (kib < 1024) ? `${kib.toFixed(1)} KiB` : `${(kib / 1024).toFixed(1)} MiB`;
}

function fileNameOf(bundle: Bundle): string {
    const { location } = bundle;
    const fallback = `bundle-${bundle.number}${(bundle.format === "Hermes bytecode") ? ".hbc" : ".js"}`;
    const name = (location.kind === "file") ? lastPathComponent(location.path).replace(UNSAFE_IN_FILE_NAMES, "-") : fallback;
    return (name.length === 0 || name.startsWith(".")) ? fallback : name;
}

function* chunksOf(bundle: Bundle): Generator<ArrayBuffer> {
    for (let offset = 0; offset < bundle.size; offset += CHUNK_BYTES) {
        const length = Math.min(CHUNK_BYTES, bundle.size - offset);
        const { location } = bundle;
        yield (location.kind === "file")
            ? readFile(location.path, offset, length)
            : location.address.add(offset).readByteArray(length)!;
    }
}

function sameLocation(a: BundleLocation, b: BundleLocation): boolean {
    if (a.kind === "file" && b.kind === "file") {
        return withoutFirmlinkPrefix(a.path) === withoutFirmlinkPrefix(b.path);
    }
    return a.kind === "memory" && b.kind === "memory" && a.address.equals(b.address);
}

function withoutFirmlinkPrefix(path: string): string {
    return (Process.platform === "darwin" && DARWIN_PRIVATE_ALIASES.test(path)) ? path.slice("/private".length) : path;
}

function contentsAt(location: BundleLocation): Pick<Bundle, "size" | "format" | "bytecodeVersion"> | null {
    if (location.kind === "memory") {
        const header = bytecodeHeaderAt(location.address)!;
        return { size: header.fileLength, format: "Hermes bytecode", bytecodeVersion: header.version };
    }
    const size = fileSize(location.path);
    if (size === null) {
        return null;
    }
    const start = Memory.alloc(HermesBytecodeHeader.size);
    start.writeByteArray(readFile(location.path, 0, Math.min(size, HermesBytecodeHeader.size)));
    const header = (size >= HermesBytecodeHeader.size) ? bytecodeHeaderAt(start) : null;
    return (header !== null)
        ? { size, format: "Hermes bytecode", bytecodeVersion: header.version }
        : { size, format: "JavaScript", bytecodeVersion: null };
}

function bytecodeHeaderAt(address: NativePointer): HermesBytecodeHeader | null {
    const header = HermesBytecodeHeader.at(address);
    try {
        const plausible = header.magic.equals(HERMES_BYTECODE_MAGIC)
            && header.version >= LOWEST_BYTECODE_VERSION && header.version <= HIGHEST_BYTECODE_VERSION
            && header.fileLength >= HermesBytecodeHeader.size;
        return plausible ? header : null;
    } catch (e) {
        return null;
    }
}

function fileSize(path: string): number | null {
    try {
        const file = new File(path, "rb");
        file.seek(0, File.SEEK_END);
        const size = file.tell();
        file.close();
        return size;
    } catch (e) {
        return null;
    }
}

function readFile(path: string, offset: number, length: number): ArrayBuffer {
    const file = new File(path, "rb");
    file.seek(offset);
    const bytes = file.readBytes(length);
    file.close();
    return bytes;
}
