import { copyOf, readPointer, readU32 } from "./heap-search.js";
import type { JscInternals } from "./jsc-internals.js";

const DEBUGGABLE_SLOTS = 8;
const CONFIG_WORDS = 0x200;
const STRUCTURE_BYTES = 0x100;
const LONGEST_CHAIN = 16;
const NUKED_STRUCTURE_ID_BIT = 1;
const LONGEST_CLASS_NAME = 128;
const LOWEST_USER_ADDRESS = ptr("0x100000000");
const HIGHEST_USER_ADDRESS = ptr("0x800000000000");

interface StructureLayout {
    configOffset: number;
    classInfoOffset: number;
}

export class GlobalObjectLayout {
    readonly #internals: JscInternals;
    readonly #parentOffset: number;
    #debuggableSlot: number | null = null;
    #structure: StructureLayout | null = null;

    constructor(internals: JscInternals) {
        this.#internals = internals;
        this.#parentOffset = parentOffsetOf(internals.globalObjectInfo);
    }

    get learned(): boolean {
        return this.#structure !== null;
    }

    globalObjectOf(debuggable: NativePointer): NativePointer | null {
        this.#debuggableSlot ??= this.#slotLeadingToGlobalObject(debuggable);
        if (this.#debuggableSlot === null) {
            return null;
        }
        const global = readPointer(debuggable.add(this.#debuggableSlot * Process.pointerSize));
        return (global !== null && this.classChainOf(global) !== null) ? global : null;
    }

    classChainOf(global: NativePointer): string[] | null {
        this.#structure ??= this.#structureLayoutFor(global);
        if (this.#structure === null) {
            return null;
        }
        const structure = this.#structureOf(global, this.#structure.configOffset);
        const classInfo = (structure !== null) ? readPointer(structure.add(this.#structure.classInfoOffset)) : null;
        return (classInfo !== null) ? this.#chainFrom(classInfo) : null;
    }

    #slotLeadingToGlobalObject(debuggable: NativePointer): number | null {
        for (let slot = 1; slot !== DEBUGGABLE_SLOTS; slot++) {
            const candidate = readPointer(debuggable.add(slot * Process.pointerSize));
            if (candidate !== null && isUserAddress(candidate) && this.classChainOf(candidate) !== null) {
                return slot;
            }
        }
        return null;
    }

    #structureLayoutFor(global: NativePointer): StructureLayout | null {
        for (let word = 0; word !== CONFIG_WORDS; word++) {
            const configOffset = word * Process.pointerSize;
            const structure = this.#structureOf(global, configOffset);
            const copy = (structure !== null) ? copyOf(structure, STRUCTURE_BYTES) : null;
            if (copy === null) {
                continue;
            }
            for (let classInfoOffset = 0; classInfoOffset !== STRUCTURE_BYTES; classInfoOffset += Process.pointerSize) {
                const candidate = copy.add(classInfoOffset).readPointer();
                if (isUserAddress(candidate) && this.#chainFrom(candidate) !== null) {
                    return { configOffset, classInfoOffset };
                }
            }
        }
        return null;
    }

    #structureOf(global: NativePointer, configOffset: number): NativePointer | null {
        const heap = this.#internals.config.add(configOffset).readPointer();
        const id = readU32(global);
        if (!isUserAddress(heap) || id === null || id === 0) {
            return null;
        }
        return heap.add((id & ~NUKED_STRUCTURE_ID_BIT) >>> 0);
    }

    #chainFrom(classInfo: NativePointer): string[] | null {
        const names: string[] = [];
        for (let info = classInfo; names.length !== LONGEST_CHAIN;) {
            const namePointer = readPointer(info);
            const name = (namePointer !== null && isUserAddress(namePointer)) ? classNameAt(namePointer) : null;
            if (name === null) {
                return null;
            }
            names.push(this.#internals.classNames.get(info.toString()) ?? name);
            if (info.equals(this.#internals.globalObjectInfo)) {
                return names;
            }
            const parent = readPointer(info.add(this.#parentOffset));
            if (parent === null || !isUserAddress(parent)) {
                return null;
            }
            info = parent;
        }
        return null;
    }
}

function parentOffsetOf(globalObjectInfo: NativePointer): number {
    const nameLength = globalObjectInfo.add(Process.pointerSize).readU64().toNumber();
    const holdsNameLength = nameLength === globalObjectInfo.readPointer().readCString()!.length + 1;
    return (holdsNameLength ? 2 : 1) * Process.pointerSize;
}

function classNameAt(address: NativePointer): string | null {
    const toPageEnd = Process.pageSize - address.and(Process.pageSize - 1).toUInt32();
    const size = (copyOf(address, LONGEST_CLASS_NAME) !== null) ? LONGEST_CLASS_NAME : Math.min(LONGEST_CLASS_NAME, toPageEnd);
    const copy = copyOf(address, size);
    if (copy === null) {
        return null;
    }
    const bytes = new Uint8Array(copy.readByteArray(size)!);
    const end = bytes.indexOf(0);
    const text = String.fromCharCode(...bytes.subarray(0, end));
    return (end > 0 && /^[\x21-\x7e][\x20-\x7e]*$/.test(text)) ? text : null;
}

function isUserAddress(address: NativePointer): boolean {
    return address.compare(LOWEST_USER_ADDRESS) >= 0 && address.compare(HIGHEST_USER_ADDRESS) < 0;
}
