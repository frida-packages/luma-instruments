import { Buffer } from "buffer";

export interface FlutterFile {
    id: string;
    name: string;
    path: string;
    holds: string;
    size: number;
    mediaType: string;
}

export interface FileReply {
    output(text: string): void;
    error(text: string): void;
    file: CustomInstrumentOfferFile;
}

interface KnownAsset {
    name: string;
    holds: string;
    mediaType: string;
}

const OCTETS = "application/octet-stream";
const JSON_TYPE = "application/json";
const LARGEST_OFFER = 64 * 1048576;
const PIECE_SIZE = 1048576;

const knownAssets: KnownAsset[] = [
    { name: "kernel_blob.bin", holds: "the app's Dart as kernel, every library (debug builds)", mediaType: OCTETS },
    { name: "isolate_snapshot_data", holds: "the isolate snapshot the JIT starts from (debug builds)", mediaType: OCTETS },
    { name: "vm_snapshot_data", holds: "the VM snapshot (debug builds)", mediaType: OCTETS },
    { name: "AssetManifest.bin", holds: "the assets the app bundles, in the standard codec", mediaType: OCTETS },
    { name: "AssetManifest.json", holds: "the assets the app bundles", mediaType: JSON_TYPE },
    { name: "FontManifest.json", holds: "the app's fonts", mediaType: JSON_TYPE },
    { name: "NativeAssetsManifest.json", holds: "native libraries Dart code loads", mediaType: JSON_TYPE },
    { name: "NOTICES.Z", holds: "the licenses of every package, zlib-compressed", mediaType: OCTETS },
];

export function flutterFiles(engine: Module, app: Module | null, aot: boolean, assets: string | null): FlutterFile[] {
    const files: FlutterFile[] = [];
    if (app !== null) {
        files.push(moduleFile("app", app, aot ? "the AOT snapshots: the app's compiled Dart, its object pools and strings" : "no Dart code: a debug build keeps it in kernel_blob.bin"));
    }
    files.push(moduleFile("engine", engine, "the Flutter engine, with the Dart VM and BoringSSL linked in"));
    if (assets !== null) {
        for (const asset of knownAssets) {
            const path = `${assets}/${asset.name}`;
            const size = sizeOf(path);
            if (size !== null) {
                files.push({ id: asset.name, name: asset.name, path, holds: asset.holds, size, mediaType: asset.mediaType });
            }
        }
    }
    return files;
}

function moduleFile(id: string, module: Module, holds: string): FlutterFile {
    return { id, name: module.name, path: module.path, holds, size: sizeOf(module.path) ?? module.size, mediaType: OCTETS };
}

function sizeOf(path: string): number | null {
    let file: File;
    try {
        file = new File(path, "rb");
    } catch {
        return null;
    }
    file.seek(0, File.SEEK_END);
    const size = file.tell();
    file.close();
    return size;
}

export function offerFile(file: FlutterFile, reply: FileReply): void {
    if (file.size > LARGEST_OFFER) {
        reply.error(`${file.name} is ${sizeText(file.size)}, more than the 64 MiB a file offered for saving can be. It is at ${file.path}.`);
        return;
    }
    const sink = reply.file({ name: file.name, mediaType: file.mediaType });
    const source = new File(file.path, "rb");
    for (let offered = 0; offered < file.size; offered += PIECE_SIZE) {
        sink.write(Buffer.from(source.readBytes(PIECE_SIZE)));
    }
    source.close();
    sink.end();
    reply.output(`Offered ${file.name} (${sizeText(file.size)}) for saving.`);
}

export function sizeText(byteCount: number): string {
    const units = ["B", "KiB", "MiB", "GiB"];
    let value = byteCount;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return (unit === 0) ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}
