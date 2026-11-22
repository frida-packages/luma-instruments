export type ArgumentValue =
    | { kind: "unknown" }
    | { kind: "integer"; value: number }
    | { kind: "address"; value: NativePointer };

export interface CallSite {
    target: NativePointer;
    argumentValues: ArgumentValue[];
}

interface ParsedInstruction {
    address: NativePointer;
    next: NativePointer;
    mnemonic: string;
    operands: Operand[];
}

interface Operand {
    type: string;
    value: unknown;
    access?: string;
}

const ARM64_ADD_IMMEDIATE = 0x91000000;
const ARM64_ADD_IMMEDIATE_MASK = 0xfffffc00;
const ARM64_ADR = 0x10000000;
const ARM64_ADR_MASK = 0x9f000000;
const ARM64_INSTRUCTION_SIZE = 4;
const PAGE_OFFSET_MASK = 0xfff;
const ADRP_LOOKBEHIND = 8;
const FUNCTION_START_LOOKBEHIND = 96;
const MAX_FUNCTION_INSTRUCTIONS = 1024;
const MAX_FUNCTION_BYTES = 0x2000;
const ARGUMENT_REGISTERS = 6;
const CALLER_SAVED_REGISTERS = 18;

const functionBoundaries = new Set(["ret", "brk", "udf"]);
const terminators = new Set(["ret", "b", "br", "brk", "udf"]);
const unknown: ArgumentValue = { kind: "unknown" };

export function addressesMaterializedBy(start: NativePointer, instructionLimit: number): NativePointer[] {
    const addresses: NativePointer[] = [];
    const pages = new Map<string, NativePointer>();
    let cursor = start;
    for (let count = 0; count !== instructionLimit; count++) {
        const instruction = parseInstruction(cursor);
        if (instruction === null) {
            break;
        }
        const { mnemonic, operands } = instruction;
        if (mnemonic === "adrp") {
            pages.set(operands[0].value as string, ptr(operands[1].value as string));
        } else if (mnemonic === "add" && operands.length === 3 && operands[2].type === "imm") {
            const page = pages.get(operands[1].value as string);
            if (page !== undefined) {
                addresses.push(page.add(operands[2].value as string));
            }
        } else if (mnemonic === "adr") {
            addresses.push(ptr(operands[1].value as string));
        } else if (mnemonic === "lea" && operands[1]?.type === "mem") {
            const memory = operands[1].value as { base?: string; disp?: number };
            if (memory.base === "rip") {
                addresses.push(instruction.next.add(memory.disp ?? 0));
            }
        }
        cursor = instruction.next;
    }
    return addresses;
}

export function functionStartsReferencing(target: NativePointer, code: MemoryRange[]): NativePointer[] {
    return referencesTo(target, code).flatMap(reference => functionStartCandidates(reference));
}

export function callSitesOf(start: NativePointer): CallSite[] {
    if (Process.arch !== "arm64") {
        return [];
    }
    const body = functionBody(start);
    const end = (body.length !== 0) ? body[body.length - 1].next : start;
    const blockStarts = new Set(body.flatMap(instruction => {
        const target = branchTargetOf(instruction);
        return (target !== null && isWithin(target, start, end)) ? [target.toString()] : [];
    }));
    const registers: ArgumentValue[] = [];
    const sites: CallSite[] = [];
    for (const instruction of body) {
        if (blockStarts.has(instruction.address.toString())) {
            registers.length = 0;
        }
        const { mnemonic } = instruction;
        const target = branchTargetOf(instruction);
        if (mnemonic === "bl" && target !== null) {
            sites.push(callSite(target, registers));
            registers.length = 0;
        } else if (mnemonic === "b" && target !== null && !isWithin(target, start, end)) {
            sites.push(callSite(target, registers));
        } else if (mnemonic === "blr") {
            registers.length = 0;
        } else {
            track(instruction, registers);
        }
    }
    return sites;
}

function referencesTo(target: NativePointer, code: MemoryRange[]): NativePointer[] {
    if (Process.arch !== "arm64") {
        return [];
    }
    return code.flatMap(range => [...pageOffsetReferences(range, target), ...adrReferences(range, target)]);
}

function pageOffsetReferences(range: MemoryRange, target: NativePointer): NativePointer[] {
    const pageOffset = target.and(PAGE_OFFSET_MASK).toUInt32();
    const page = target.and(ptr(PAGE_OFFSET_MASK).not());
    const pattern = `${hexWord(ARM64_ADD_IMMEDIATE | (pageOffset << 10))} : ${hexWord(ARM64_ADD_IMMEDIATE_MASK)}`;
    return Memory.scanSync(range.base, range.size, pattern)
        .map(match => match.address)
        .filter(address => isInstructionAligned(address) && computesPage(address, page));
}

function adrReferences(range: MemoryRange, target: NativePointer): NativePointer[] {
    const pattern = `${hexWord(ARM64_ADR)} : ${hexWord(ARM64_ADR_MASK)}`;
    return Memory.scanSync(range.base, range.size, pattern)
        .map(match => match.address)
        .filter(address => isInstructionAligned(address) && adrTarget(address).equals(target));
}

function adrTarget(address: NativePointer): NativePointer {
    const word = address.readU32();
    const low = (word >>> 29) & 0x3;
    const high = (word >>> 5) & 0x7ffff;
    const offset = (((high << 2) | low) << 11) >> 11;
    return address.add(offset);
}

function computesPage(add: NativePointer, page: NativePointer): boolean {
    const register = (add.readU32() >>> 5) & 0x1f;
    for (let back = 1; back <= ADRP_LOOKBEHIND; back++) {
        const instruction = parseInstruction(add.sub(back * ARM64_INSTRUCTION_SIZE));
        if (instruction?.mnemonic === "adrp" && instruction.operands[0].value === `x${register}`) {
            return ptr(instruction.operands[1].value as string).equals(page);
        }
    }
    return false;
}

function functionStartCandidates(reference: NativePointer): NativePointer[] {
    const candidates = [reference];
    for (let back = 1; back <= FUNCTION_START_LOOKBEHIND; back++) {
        const address = reference.sub(back * ARM64_INSTRUCTION_SIZE);
        const instruction = parseInstruction(address);
        if (instruction === null || functionBoundaries.has(instruction.mnemonic)) {
            break;
        }
        candidates.push(address);
    }
    return candidates;
}

function functionBody(start: NativePointer): ParsedInstruction[] {
    const body: ParsedInstruction[] = [];
    let furthest = start;
    for (let cursor = start; body.length !== MAX_FUNCTION_INSTRUCTIONS;) {
        const instruction = parseInstruction(cursor);
        if (instruction === null) {
            break;
        }
        body.push(instruction);
        const target = branchTargetOf(instruction);
        if (target !== null && instruction.mnemonic !== "bl" && target.compare(furthest) > 0
            && target.sub(start).compare(ptr(MAX_FUNCTION_BYTES)) < 0) {
            furthest = target;
        }
        if (terminators.has(instruction.mnemonic) && instruction.next.compare(furthest) >= 0) {
            break;
        }
        cursor = instruction.next;
    }
    return body;
}

function callSite(target: NativePointer, registers: ArgumentValue[]): CallSite {
    const argumentValues: ArgumentValue[] = [];
    for (let index = 0; index !== ARGUMENT_REGISTERS; index++) {
        argumentValues.push(registers[index] ?? unknown);
    }
    return { target, argumentValues };
}

function track(instruction: ParsedInstruction, registers: ArgumentValue[]): void {
    const { operands } = instruction;
    const destination = (operands[0]?.type === "reg") ? registerIndex(operands[0].value as string) : null;
    const value = (destination !== null) ? valueProducedBy(instruction, registers) : unknown;
    for (const operand of operands) {
        if (operand.type === "reg" && operand.access?.includes("w")) {
            forget(registers, operand.value as string);
        }
    }
    if (destination !== null) {
        registers[destination] = value;
    }
}

function valueProducedBy({ mnemonic, operands }: ParsedInstruction, registers: ArgumentValue[]): ArgumentValue {
    const source = operands[1];
    if (mnemonic === "mov" && source?.type === "imm") {
        return { kind: "integer", value: immediateOf(source, operands[0].value as string) };
    }
    if (mnemonic === "mov" && source?.type === "reg") {
        return valueOfRegister(registers, source.value as string);
    }
    if (mnemonic === "adr" || mnemonic === "adrp") {
        return { kind: "address", value: ptr(source.value as string) };
    }
    if (mnemonic === "add" && operands[2]?.type === "imm" && source?.type === "reg") {
        const base = valueOfRegister(registers, source.value as string);
        return (base.kind === "address") ? { kind: "address", value: base.value.add(operands[2].value as string) } : unknown;
    }
    return unknown;
}

function immediateOf(operand: Operand, register: string): number {
    const value = Number(operand.value as string);
    return register.startsWith("w") ? (value | 0) : value;
}

function valueOfRegister(registers: ArgumentValue[], name: string): ArgumentValue {
    if (name === "xzr" || name === "wzr") {
        return { kind: "integer", value: 0 };
    }
    const index = registerIndex(name);
    return (index !== null) ? (registers[index] ?? unknown) : unknown;
}

function forget(registers: ArgumentValue[], name: string): void {
    const index = registerIndex(name);
    if (index !== null) {
        registers[index] = unknown;
    }
}

function registerIndex(name: string): number | null {
    const match = /^[xw](\d+)$/.exec(name);
    if (match === null) {
        return null;
    }
    const index = Number(match[1]);
    return (index < CALLER_SAVED_REGISTERS) ? index : null;
}

function branchTargetOf(instruction: ParsedInstruction): NativePointer | null {
    const { mnemonic, operands } = instruction;
    const isBranch = mnemonic === "b" || mnemonic === "bl" || mnemonic.startsWith("b.") || mnemonic === "cbz" || mnemonic === "cbnz"
        || mnemonic === "tbz" || mnemonic === "tbnz";
    if (!isBranch) {
        return null;
    }
    const target = operands[operands.length - 1];
    return (target?.type === "imm") ? ptr(target.value as string) : null;
}

function isWithin(address: NativePointer, start: NativePointer, end: NativePointer): boolean {
    return address.compare(start) >= 0 && address.compare(end) < 0;
}

function isInstructionAligned(address: NativePointer): boolean {
    return address.and(ARM64_INSTRUCTION_SIZE - 1).isNull();
}

function parseInstruction(address: NativePointer): ParsedInstruction | null {
    try {
        return Instruction.parse(address) as unknown as ParsedInstruction;
    } catch (e) {
        return null;
    }
}

function hexWord(word: number): string {
    return [0, 8, 16, 24].map(shift => ((word >>> shift) & 0xff).toString(16).padStart(2, "0")).join(" ");
}
