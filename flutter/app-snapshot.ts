import { SnapshotHeader } from "./snapshot-header.pat";

export interface AppImage {
    module: Module;
    isolateData: NativePointer;
}

export interface SnapshotFacts {
    hash: string;
    kind: string;
    build: string;
    features: string[];
    length: number;
}

const ISOLATE_DATA_EXPORTS = ["kDartIsolateSnapshotData", "_kDartIsolateSnapshotData", "kDartSnapshotData", "_kDartSnapshotData"];
const MAGIC = 0xdcdcf5f5;
const HEADER_BYTES_READ = 1100;

export function appImageIn(module: Module): AppImage | null {
    for (const name of ISOLATE_DATA_EXPORTS) {
        const isolateData = module.findExportByName(name);
        if (isolateData !== null) {
            return { module, isolateData };
        }
    }
    return null;
}

export function snapshotFactsAt(address: NativePointer, aot: boolean): SnapshotFacts | null {
    const header = SnapshotHeader.at(address);
    if (header.magic !== MAGIC) {
        return null;
    }
    const kind = header.kind.toNumber();
    const features = address.add(SnapshotHeader.size).readCString()!.split(" ");
    return {
        hash: header.hash,
        kind: `kind ${kind}`,
        build: buildOf(aot, features),
        features,
        length: header.length.toNumber(),
    };
}

export function snapshotFactsInFile(path: string): SnapshotFacts | null {
    const file = new File(path, "rb");
    const bytes = file.readBytes(HEADER_BYTES_READ);
    file.close();
    if (bytes.byteLength < SnapshotHeader.size) {
        return null;
    }
    const copy = Memory.alloc(bytes.byteLength + 1);
    copy.writeByteArray(bytes);
    return snapshotFactsAt(copy, false);
}

function buildOf(aot: boolean, features: string[]): string {
    if (!aot) {
        return "JIT, a debug build";
    }
    return features.includes("product") ? "AOT, a release build" : "AOT, a profile build";
}
