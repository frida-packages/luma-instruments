import { Buffer } from "buffer";
import { crc32 } from "./texture-kernels.js";

export interface ArchiveEntry {
    name: string;
    bytes: Buffer;
}

interface PlacedEntry {
    entry: ArchiveEntry;
    name: Buffer;
    crc: number;
    offset: number;
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_OF_DIRECTORY_SIZE = 22;
const VERSION_NEEDED = 20;
const UTF8_NAMES = 0x0800;
const STORED = 0;

export function zipArchive(entries: ArchiveEntry[], when: Date): Buffer[] {
    const stamp = dosStamp(when);
    const pieces: Buffer[] = [];
    const placed: PlacedEntry[] = [];
    let offset = 0;
    for (const entry of entries) {
        const name = Buffer.from(entry.name);
        const crc = crc32(entry.bytes);
        const header = localHeader(name, entry.bytes.byteLength, crc, stamp);
        pieces.push(header, entry.bytes);
        placed.push({ entry, name, crc, offset });
        offset += header.byteLength + entry.bytes.byteLength;
    }
    const directory = placed.map(each => centralHeader(each, stamp));
    const directorySize = directory.reduce((sum, header) => sum + header.byteLength, 0);
    return [...pieces, ...directory, endOfDirectory(placed.length, directorySize, offset)];
}

function dosStamp(when: Date): { time: number; date: number } {
    return {
        time: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
        date: ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
    };
}

function localHeader(name: Buffer, size: number, crc: number, stamp: { time: number; date: number }): Buffer {
    const header = Buffer.alloc(LOCAL_HEADER_SIZE + name.byteLength);
    header.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
    header.writeUInt16LE(VERSION_NEEDED, 4);
    header.writeUInt16LE(UTF8_NAMES, 6);
    header.writeUInt16LE(STORED, 8);
    header.writeUInt16LE(stamp.time, 10);
    header.writeUInt16LE(stamp.date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(size, 18);
    header.writeUInt32LE(size, 22);
    header.writeUInt16LE(name.byteLength, 26);
    name.copy(header, LOCAL_HEADER_SIZE);
    return header;
}

function centralHeader({ entry, name, crc, offset }: PlacedEntry, stamp: { time: number; date: number }): Buffer {
    const header = Buffer.alloc(CENTRAL_HEADER_SIZE + name.byteLength);
    header.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
    header.writeUInt16LE(VERSION_NEEDED, 4);
    header.writeUInt16LE(VERSION_NEEDED, 6);
    header.writeUInt16LE(UTF8_NAMES, 8);
    header.writeUInt16LE(STORED, 10);
    header.writeUInt16LE(stamp.time, 12);
    header.writeUInt16LE(stamp.date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(entry.bytes.byteLength, 20);
    header.writeUInt32LE(entry.bytes.byteLength, 24);
    header.writeUInt16LE(name.byteLength, 28);
    header.writeUInt32LE(offset, 42);
    name.copy(header, CENTRAL_HEADER_SIZE);
    return header;
}

function endOfDirectory(count: number, directorySize: number, directoryOffset: number): Buffer {
    const end = Buffer.alloc(END_OF_DIRECTORY_SIZE);
    end.writeUInt32LE(END_OF_DIRECTORY_SIGNATURE, 0);
    end.writeUInt16LE(count, 8);
    end.writeUInt16LE(count, 10);
    end.writeUInt32LE(directorySize, 12);
    end.writeUInt32LE(directoryOffset, 16);
    return end;
}
