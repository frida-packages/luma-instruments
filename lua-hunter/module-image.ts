export type StringExtent = "whole" | "prefix";

const codeSectionNames = new Set(["__text", ".text"]);

export class ModuleImage {
    readonly readable: MemoryRange[];
    readonly code: MemoryRange[];
    readonly data: MemoryRange[];

    constructor(readonly module: Module) {
        const ranges = module.enumerateRanges("r--");
        this.readable = ranges.map(({ base, size }) => ({ base, size }));
        const codeSections = module.enumerateSections().filter(section => codeSectionNames.has(section.name));
        this.code = (codeSections.length !== 0)
            ? codeSections.map(({ address, size }) => ({ base: address, size }))
            : ranges.filter(range => range.protection.includes("x")).map(({ base, size }) => ({ base, size }));
        this.data = ranges.filter(range => !range.protection.includes("x")).map(({ base, size }) => ({ base, size }));
    }

    get name(): string {
        return this.module.name;
    }

    contains(address: NativePointer): boolean {
        return this.readable.some(range => rangeContains(range, address));
    }

    isCode(address: NativePointer): boolean {
        return this.code.some(range => rangeContains(range, address));
    }

    findCStrings(text: string, extent: StringExtent): NativePointer[] {
        const pattern = ["00", bytePatternOf(text), ...((extent === "whole") ? ["00"] : [])].join(" ");
        return this.scan(pattern).map(match => match.add(1));
    }

    findText(text: string): NativePointer[] {
        return this.scan(bytePatternOf(text));
    }

    private scan(pattern: string): NativePointer[] {
        return this.readable.flatMap(range => Memory.scanSync(range.base, range.size, pattern).map(match => match.address));
    }
}

export function boundedCStringAt(address: NativePointer, limit: number): string {
    let bytes: Uint8Array;
    try {
        bytes = new Uint8Array(address.readByteArray(limit)!);
    } catch (e) {
        return "";
    }
    const end = bytes.indexOf(0);
    return String.fromCharCode(...((end !== -1) ? bytes.subarray(0, end) : bytes));
}

function rangeContains(range: MemoryRange, address: NativePointer): boolean {
    return address.compare(range.base) >= 0 && address.compare(range.base.add(range.size)) < 0;
}

function bytePatternOf(text: string): string {
    return Array.from(text, character => character.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");
}
