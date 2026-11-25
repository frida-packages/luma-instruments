import type { Writable } from "stream";

export interface AsarEntry {
    path: string;
    size: number;
    offset: number;
    unpacked: boolean;
    executable: boolean;
}

const READ_CHUNK_BYTES = 1024 * 1024;

export class AsarArchive {
    readonly path: string;
    readonly size: number;
    readonly headerHash: string;
    readonly entries: AsarEntry[];
    readonly #dataOffset: number;

    static open(path: string): AsarArchive | null {
        let file: File;
        try {
            file = new File(path, "rb");
        } catch (e) {
            return null;
        }
        try {
            return new AsarArchive(path, file);
        } finally {
            file.close();
        }
    }

    private constructor(path: string, file: File) {
        this.path = path;
        file.seek(0, File.SEEK_END);
        this.size = file.tell();
        file.seek(0);
        const sizePickle = new DataView(file.readBytes(8));
        const headerPickleSize = sizePickle.getUint32(4, true);
        const headerPickle = file.readBytes(headerPickleSize);
        const headerLength = new DataView(headerPickle).getUint32(4, true);
        const headerBytes = headerPickle.slice(8, 8 + headerLength);
        this.headerHash = Checksum.compute("sha256", headerBytes);
        this.#dataOffset = 8 + headerPickleSize;
        this.entries = [];
        collectEntries(JSON.parse(utf8Decode(headerBytes)), "", this.entries);
        this.entries.sort((a, b) => a.path.localeCompare(b.path));
    }

    find(path: string): AsarEntry | undefined {
        return this.entries.find(entry => entry.path === path);
    }

    read(entry: AsarEntry): ArrayBuffer {
        if (entry.unpacked) {
            return File.readAllBytes(`${this.path}.unpacked/${entry.path}`);
        }
        const file = new File(this.path, "rb");
        try {
            file.seek(this.#dataOffset + entry.offset);
            return file.readBytes(entry.size);
        } finally {
            file.close();
        }
    }

    async copyTo(sink: Writable): Promise<void> {
        const file = new File(this.path, "rb");
        try {
            let remaining = this.size;
            while (remaining > 0) {
                const chunk = file.readBytes(Math.min(remaining, READ_CHUNK_BYTES));
                remaining -= chunk.byteLength;
                if (!sink.write(new Uint8Array(chunk))) {
                    await new Promise(resolve => sink.once("drain", resolve));
                }
            }
        } finally {
            file.close();
        }
        sink.end();
    }
}

function collectEntries(node: any, prefix: string, entries: AsarEntry[]): void {
    for (const [name, child] of Object.entries<any>(node.files)) {
        const path = prefix + name;
        if (child.files !== undefined) {
            collectEntries(child, `${path}/`, entries);
        } else if (child.link === undefined) {
            entries.push({
                path,
                size: child.size,
                offset: (child.offset !== undefined) ? Number(child.offset) : 0,
                unpacked: child.unpacked === true,
                executable: child.executable === true,
            });
        }
    }
}

function utf8Decode(bytes: ArrayBuffer): string {
    return Memory.alloc(bytes.byteLength).writeByteArray(bytes).readUtf8String(bytes.byteLength)!;
}
