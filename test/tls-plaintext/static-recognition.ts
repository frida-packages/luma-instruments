import { readExecutableImage } from "../../tls-plaintext/executable-image.js";
import { machineCodeFor } from "../../tls-plaintext/machine-code.js";
import { findErrorReportingFunctions, locateStaticBoringSsl } from "../../tls-plaintext/static-boringssl.js";

rpc.exports = {
    recognize(path: string, sliceOffset: number, sliceSize: number) {
        const file = File.readAllBytes(path).slice(sliceOffset, sliceOffset + sliceSize);
        const base = mapImage(file);
        const image = readExecutableImage(base)!;
        const started = Date.now();
        const location = locateStaticBoringSsl(image);
        const elapsed = Date.now() - started;
        return {
            architecture: image.architecture,
            elapsed,
            location: describeLocation(location, base),
            errorFunctions: listErrorFunctions(image, base),
        };
    },
};

function describeLocation(location: ReturnType<typeof locateStaticBoringSsl>, base: NativePointer) {
    if (location.kind !== "placed") {
        return location;
    }
    return {
        kind: location.kind,
        entryPoints: Object.fromEntries(Object.entries(location.entryPoints)
            .map(([name, address]) => [name, address !== null ? offsetOf(address, base) : null])),
    };
}

function listErrorFunctions(image: NonNullable<ReturnType<typeof readExecutableImage>>, base: NativePointer) {
    const sourcePath = findSourcePath(image);
    if (sourcePath === null || image.functions === null) {
        return [];
    }
    return findErrorReportingFunctions(machineCodeFor(image.architecture), image, image.functions, sourcePath)
        .map(f => ({ start: offsetOf(f.extent.start, base), reasons: [...f.reasons], reporters: [...f.reporters].map(r => offsetOf(ptr(r), base)) }));
}

function findSourcePath(image: NonNullable<ReturnType<typeof readExecutableImage>>): NativePointer | null {
    for (const range of image.strings) {
        const matches = Memory.scanSync(range.base, range.size, "2f 73 73 6c 2f 73 73 6c 5f 6c 69 62 2e 63 63 00");
        if (matches.length !== 0) {
            let start = matches[0].address;
            while (start.sub(1).readU8() !== 0) {
                start = start.sub(1);
            }
            return start;
        }
    }
    return null;
}

function offsetOf(address: NativePointer, base: NativePointer): string {
    return "0x" + address.sub(base).toString(16).replace(/^0x/, "");
}

function mapImage(file: ArrayBuffer): NativePointer {
    const view = new DataView(file);
    const segments = (view.getUint32(0, true) === 0xfeedfacf) ? machOSegments(view) : elfSegments(view);
    const first = Math.min(...segments.map(s => s.address));
    const size = Math.max(...segments.map(s => s.address + s.memorySize)) - first;
    const base = Memory.alloc(Math.ceil(size / Process.pageSize) * Process.pageSize);
    for (const segment of segments) {
        if (segment.fileSize !== 0) {
            base.add(segment.address - first).writeByteArray(file.slice(segment.fileOffset, segment.fileOffset + segment.fileSize));
        }
    }
    return base;
}

interface FileSegment {
    address: number;
    memorySize: number;
    fileOffset: number;
    fileSize: number;
}

function machOSegments(view: DataView): FileSegment[] {
    const segments: FileSegment[] = [];
    const count = view.getUint32(16, true);
    let offset = 32;
    for (let i = 0; i !== count; i++) {
        const command = view.getUint32(offset, true);
        if (command === 0x19) {
            segments.push({
                address: Number(view.getBigUint64(offset + 24, true)),
                memorySize: Number(view.getBigUint64(offset + 32, true)),
                fileOffset: Number(view.getBigUint64(offset + 40, true)),
                fileSize: Number(view.getBigUint64(offset + 48, true)),
            });
        }
        offset += view.getUint32(offset + 4, true);
    }
    return segments.filter(s => s.memorySize !== 0 && !(s.address === 0 && s.fileSize === 0));
}

function elfSegments(view: DataView): FileSegment[] {
    const segments: FileSegment[] = [];
    const tableOffset = Number(view.getBigUint64(32, true));
    const entrySize = view.getUint16(54, true);
    const count = view.getUint16(56, true);
    for (let i = 0; i !== count; i++) {
        const entry = tableOffset + i * entrySize;
        if (view.getUint32(entry, true) === 1) {
            const address = Number(view.getBigUint64(entry + 16, true));
            const fileOffset = Number(view.getBigUint64(entry + 8, true));
            const pageOffset = address % 4096;
            segments.push({
                address: address - pageOffset,
                memorySize: Number(view.getBigUint64(entry + 40, true)) + pageOffset,
                fileOffset: fileOffset - pageOffset,
                fileSize: Number(view.getBigUint64(entry + 32, true)) + pageOffset,
            });
        }
    }
    return segments;
}
