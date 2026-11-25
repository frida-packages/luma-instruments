import {
    EhFrameHeader,
    EhFrameTableEntry,
    Elf64Header,
    Elf64ProgramHeader,
    LinkeditDataCommand,
    LoadCommand,
    MachHeader64,
    Section64,
    SegmentCommand64,
} from "./executable-headers.pat";

export type CodeArchitecture = "arm64" | "x64";

export interface ExecutableImage {
    architecture: CodeArchitecture;
    code: MemoryRange[];
    strings: MemoryRange[];
    functions: FunctionTable | null;
}

export interface FunctionExtent {
    start: NativePointer;
    end: NativePointer;
}

export function readExecutableImage(base: NativePointer): ExecutableImage | null {
    switch (base.readU32()) {
        case machOMagic:
            return readMachOImage(base);
        case elfMagic:
            return readElfImage(base);
        default:
            return null;
    }
}

const machOMagic = 0xfeedfacf;
const machOArchitectures = new Map<number, CodeArchitecture>([
    [0x0100000c, "arm64"],
    [0x01000007, "x64"],
]);
const segmentCommand = 0x19;
const functionStartsCommand = 0x26;
const pureInstructions = 0x80000000;
const sectionTypeMask = 0xff;
const cStringLiterals = 0x2;

function readMachOImage(base: NativePointer): ExecutableImage | null {
    const header = MachHeader64.at(base);
    const architecture = machOArchitectures.get(header.cpuType);
    if (architecture === undefined) {
        return null;
    }

    const segments: SegmentCommand64[] = [];
    let functionStarts: LinkeditDataCommand | null = null;
    let command = base.add(MachHeader64.size);
    for (let i = 0; i !== header.commandCount; i++) {
        const { command: kind, size } = LoadCommand.at(command);
        if (kind === segmentCommand) {
            segments.push(SegmentCommand64.at(command));
        } else if (kind === functionStartsCommand) {
            functionStarts = LinkeditDataCommand.at(command);
        }
        command = command.add(size);
    }

    const textSegment = segments.find(segment => segment.name === "__TEXT")!;
    const slide = base.sub(textSegment.vmAddress);
    const sections = segments.flatMap(segment => machOSections(segment));
    const linkedit = segments.find(segment => segment.name === "__LINKEDIT");

    return {
        architecture,
        code: sections.filter(section => (section.flags & pureInstructions) !== 0).map(section => sectionRange(section, slide)),
        strings: sections.filter(section => (section.flags & sectionTypeMask) === cStringLiterals).map(section => sectionRange(section, slide)),
        functions: (functionStarts !== null && linkedit !== undefined) ? machOFunctionTable(base, slide, linkedit, functionStarts) : null,
    };
}

function machOSections(segment: SegmentCommand64): Section64[] {
    const first = segment.$address.add(SegmentCommand64.size);
    return Array.from({ length: segment.sectionCount }, (_, i) => Section64.at(first.add(i * Section64.size)));
}

function sectionRange(section: Section64, slide: NativePointer): MemoryRange {
    return { base: slide.add(section.address), size: section.size.toNumber() };
}

function machOFunctionTable(
    base: NativePointer,
    slide: NativePointer,
    linkedit: SegmentCommand64,
    functionStarts: LinkeditDataCommand,
): FunctionTable {
    const linkeditStart = slide.add(linkedit.vmAddress).sub(linkedit.fileOffset);
    const encoded = new Uint8Array(linkeditStart.add(functionStarts.dataOffset).readByteArray(functionStarts.dataSize)!);
    const starts: number[] = [];
    let offset = 0;
    let delta = 0;
    let shift = 0;
    for (const byte of encoded) {
        delta += (byte & 0x7f) * 2 ** shift;
        shift += 7;
        if ((byte & 0x80) !== 0) {
            continue;
        }
        if (delta === 0) {
            break;
        }
        offset += delta;
        starts.push(offset);
        delta = 0;
        shift = 0;
    }
    return new FunctionTable(base, starts);
}

const elfMagic = 0x464c457f;
const elfClass64 = 2;
const elfArchitectures = new Map<number, CodeArchitecture>([
    [183, "arm64"],
    [62, "x64"],
]);
const loadableSegment = 1;
const ehFrameHeaderSegment = 0x6474e550;
const executableFlag = 0x1;
const writableFlag = 0x2;
const pageMask = 0xfff;
const supportedEhFrameHeader = { version: 1, framePointerEncoding: 0x1b, countEncoding: 0x03, tableEncoding: 0x3b };

function readElfImage(base: NativePointer): ExecutableImage | null {
    const header = Elf64Header.at(base);
    const architecture = elfArchitectures.get(header.machine);
    if (header.identification[4] !== elfClass64 || architecture === undefined) {
        return null;
    }

    const programHeaders = Array.from({ length: header.programHeaderCount },
        (_, i) => Elf64ProgramHeader.at(base.add(header.programHeaderOffset.toNumber() + i * header.programHeaderSize)));
    const loads = programHeaders.filter(segment => segment.type === loadableSegment);
    const bias = base.sub(loads[0].virtualAddress.toNumber() & ~pageMask);
    const code = loads.filter(segment => (segment.flags & executableFlag) !== 0);
    const readOnlyData = loads.filter(segment => (segment.flags & (executableFlag | writableFlag)) === 0);
    const ehFrameHeader = programHeaders.find(segment => segment.type === ehFrameHeaderSegment);

    return {
        architecture,
        code: code.map(segment => elfSegmentRange(segment, bias)),
        strings: (readOnlyData.length !== 0 ? readOnlyData : code).map(segment => elfSegmentRange(segment, bias)),
        functions: (ehFrameHeader !== undefined) ? elfFunctionTable(base, bias.add(ehFrameHeader.virtualAddress)) : null,
    };
}

function elfSegmentRange(segment: Elf64ProgramHeader, bias: NativePointer): MemoryRange {
    return { base: bias.add(segment.virtualAddress), size: segment.fileSize.toNumber() };
}

function elfFunctionTable(base: NativePointer, headerAddress: NativePointer): FunctionTable | null {
    const header = EhFrameHeader.at(headerAddress);
    if (header.version !== supportedEhFrameHeader.version
        || header.framePointerEncoding !== supportedEhFrameHeader.framePointerEncoding
        || header.countEncoding !== supportedEhFrameHeader.countEncoding
        || header.tableEncoding !== supportedEhFrameHeader.tableEncoding) {
        return null;
    }
    const headerOffset = Number(headerAddress.sub(base).toString());
    const entryWords = EhFrameTableEntry.size / 4;
    const table = new Int32Array(headerAddress.add(EhFrameHeader.size).readByteArray(header.count * EhFrameTableEntry.size)!);
    const starts = Array.from({ length: header.count }, (_, i) => headerOffset + table[i * entryWords]);
    return new FunctionTable(base, starts);
}

export class FunctionTable {
    readonly #base: NativePointer;
    readonly #starts: number[];

    constructor(base: NativePointer, starts: number[]) {
        this.#base = base;
        this.#starts = starts;
    }

    functionContaining(address: NativePointer): FunctionExtent | null {
        const offset = Number(address.sub(this.#base).toString());
        const starts = this.#starts;
        let low = 0;
        let high = starts.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (starts[middle] <= offset) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        if (low === 0 || low === starts.length) {
            return null;
        }
        return { start: this.#base.add(starts[low - 1]), end: this.#base.add(starts[low]) };
    }
}
