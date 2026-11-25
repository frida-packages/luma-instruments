import type { CodeArchitecture, FunctionExtent } from "./executable-image.js";

export interface MachineCode {
    findCallsPassing(code: MemoryRange[], address: NativePointer): PassingCall[];
    calls(caller: FunctionExtent, callee: NativePointer): boolean;
}

export interface PassingCall {
    site: NativePointer;
    callee: NativePointer;
    argument: number;
    constants: Map<number, number>;
}

export function machineCodeFor(architecture: CodeArchitecture): MachineCode {
    return (architecture === "arm64") ? arm64 : x64;
}

const callSetupLimit = 16;
const jumpsFollowedLimit = 2;
const argumentRegisterCount = 8;

type SetupEnd =
    | { kind: "call"; callee: NativePointer }
    | { kind: "return" }
    | { kind: "unknown" };

const arm64: MachineCode = {
    findCallsPassing(code, address) {
        const found: PassingCall[] = [];
        for (const load of findArm64AddressLoads(code, address)) {
            const constants = new Map<number, number>();
            const end = followArm64CallSetup(load.address.add(4), constants);
            if (end.kind === "call") {
                found.push({ site: load.address, callee: end.callee, argument: load.register, constants });
            } else if (end.kind === "return") {
                const helper = arm64HelperEntry(load.address);
                for (const caller of findArm64CallsTo(code, helper)) {
                    const callerConstants = new Map(constants);
                    const callerEnd = followArm64CallSetup(caller.add(4), callerConstants);
                    if (callerEnd.kind === "call") {
                        found.push({ site: caller, callee: callerEnd.callee, argument: load.register, constants: callerConstants });
                    }
                }
            }
        }
        return found;
    },

    calls(caller, callee) {
        const words = new Uint32Array(caller.start.readByteArray(byteDistance(caller.start, caller.end) & ~3)!);
        return words.some((word, i) => (isArm64BranchWithLink(word) || isArm64Branch(word))
            && arm64BranchTarget(caller.start.add(i * 4), word).equals(callee));
    },
};

interface AddressLoad {
    address: NativePointer;
    register: number;
}

const arm64AddImmediate = 0x91000000;
const arm64AddImmediateMask = 0xfffffc00;
const arm64PageLoadWindow = 8;

function findArm64AddressLoads(code: MemoryRange[], address: NativePointer): AddressLoad[] {
    const pageOffset = address.and(0xfff).toUInt32();
    const page = address.sub(pageOffset);
    const pattern = wordPattern(arm64AddImmediate | (pageOffset << 10), arm64AddImmediateMask);
    return code.flatMap(range => Memory.scanSync(range.base, range.size, pattern))
        .map(match => match.address)
        .filter(add => (add.toUInt32() & 3) === 0 && arm64PageLoadPrecedes(add, page))
        .map(add => ({ address: add, register: add.readU32() & 0x1f }))
        .filter(load => load.register < argumentRegisterCount);
}

function arm64PageLoadPrecedes(add: NativePointer, page: NativePointer): boolean {
    const register = (add.readU32() >>> 5) & 0x1f;
    for (let i = 1; i <= arm64PageLoadWindow; i++) {
        const address = add.sub(i * 4);
        const word = address.readU32();
        if (isArm64PageAddress(word) && (word & 0x1f) === register) {
            return arm64PageAddressTarget(address, word).equals(page);
        }
    }
    return false;
}

function followArm64CallSetup(start: NativePointer, constants: Map<number, number>): SetupEnd {
    let cursor = start;
    let jumpsFollowed = 0;
    for (let i = 0; i !== callSetupLimit; i++) {
        const word = cursor.readU32();
        if (isArm64MoveWide(word)) {
            const register = word & 0x1f;
            if (register < argumentRegisterCount) {
                constants.set(register, ((word >>> 5) & 0xffff) * 2 ** (16 * ((word >>> 21) & 3)));
            }
        } else if (isArm64BranchWithLink(word)) {
            return { kind: "call", callee: arm64BranchTarget(cursor, word) };
        } else if (isArm64Branch(word)) {
            if (jumpsFollowed++ === jumpsFollowedLimit) {
                return { kind: "unknown" };
            }
            cursor = arm64BranchTarget(cursor, word);
            continue;
        } else if (isArm64Return(word)) {
            return { kind: "return" };
        } else if (isArm64ControlFlow(word)) {
            return { kind: "unknown" };
        }
        cursor = cursor.add(4);
    }
    return { kind: "unknown" };
}

function arm64HelperEntry(add: NativePointer): NativePointer {
    let entry = add;
    for (;;) {
        const word = entry.sub(4).readU32();
        if (!isArm64PageAddress(word) && !isArm64MoveWide(word) && !isArm64AddImmediate(word)) {
            return entry;
        }
        entry = entry.sub(4);
    }
}

const arm64CallWindow = 0x10000;

function findArm64CallsTo(code: MemoryRange[], callee: NativePointer): NativePointer[] {
    return code.flatMap(range => scanRelativeWindows(range, arm64CallWindow, (windowStart, windowEnd) => {
        const largest = signedDistance(windowStart, callee) / 4;
        const smallest = signedDistance(windowEnd.sub(4), callee) / 4;
        return [...new Set([smallest, largest].map(words => (words >>> 14) & 0xfff))]
            .map(high => `00 ${hexByte((high & 0x3) << 6)} ${hexByte((high >>> 2) & 0xff)} ${hexByte(0x94 | (high >>> 10))} : 00 c0 ff ff`);
    })).filter(site => (site.toUInt32() & 3) === 0 && isArm64BranchWithLink(site.readU32())
        && arm64BranchTarget(site, site.readU32()).equals(callee));
}

function isArm64PageAddress(word: number): boolean {
    return ((word & 0x9f000000) >>> 0) === 0x90000000;
}

function arm64PageAddressTarget(address: NativePointer, word: number): NativePointer {
    const low = (word >>> 29) & 3;
    const high = (word >>> 5) & 0x7ffff;
    const pages = signExtended(high * 4 + low, 21);
    return offsetBy(address.and(ptr(0xfff).not()), pages * 4096);
}

function isArm64AddImmediate(word: number): boolean {
    return ((word & 0xffc00000) >>> 0) === arm64AddImmediate;
}

function isArm64MoveWide(word: number): boolean {
    return ((word & 0x7f800000) >>> 0) === 0x52800000;
}

function isArm64BranchWithLink(word: number): boolean {
    return ((word & 0xfc000000) >>> 0) === 0x94000000;
}

function isArm64Branch(word: number): boolean {
    return ((word & 0xfc000000) >>> 0) === 0x14000000;
}

function isArm64Return(word: number): boolean {
    return ((word & 0xfffffbff) >>> 0) === 0xd65f0bff || word >>> 0 === 0xd65f03c0;
}

function isArm64ControlFlow(word: number): boolean {
    const conditionalBranch = ((word & 0xff000010) >>> 0) === 0x54000000;
    const compareAndBranch = ((word & 0x7e000000) >>> 0) === 0x34000000;
    const testAndBranch = ((word & 0x7e000000) >>> 0) === 0x36000000;
    const registerBranch = ((word & 0xfe000000) >>> 0) === 0xd6000000;
    return conditionalBranch || compareAndBranch || testAndBranch || registerBranch;
}

function arm64BranchTarget(address: NativePointer, word: number): NativePointer {
    return offsetBy(address, signExtended(word & 0x3ffffff, 26) * 4);
}

const x64ReferenceWindow = 0x10000;
const x64LeaLength = 7;
const x64CallLength = 5;
const x64ShortJumpLength = 2;
const x64ArgumentRegisters = new Map([[7, 0], [6, 1], [2, 2], [1, 3], [8, 4], [9, 5]]);
const x64PathRegisterEncodings = ["0d", "15"];
const int32Range = 2 ** 31;

const x64: MachineCode = {
    findCallsPassing(code, address) {
        const found: PassingCall[] = [];
        for (const load of code.flatMap(range => findX64AddressLoads(range, address))) {
            const constants = new Map<number, number>();
            const end = followX64CallSetup(load.address.add(x64LeaLength), constants);
            if (end.kind === "call") {
                found.push({ site: load.address, callee: end.callee, argument: load.register, constants });
            }
        }
        return found;
    },

    calls(caller, callee) {
        const size = byteDistance(caller.start, caller.end);
        const bytes = new Uint8Array(caller.start.readByteArray(size)!);
        const view = new DataView(bytes.buffer);
        for (let i = 0; i + x64CallLength <= size; i++) {
            if ((bytes[i] === 0xe8 || bytes[i] === 0xe9)
                && offsetBy(caller.start.add(i + x64CallLength), view.getInt32(i + 1, true)).equals(callee)) {
                return true;
            }
        }
        return false;
    },
};

function findX64AddressLoads(range: MemoryRange, address: NativePointer): AddressLoad[] {
    return scanRelativeWindows(range, x64ReferenceWindow, (windowStart, windowEnd) => {
        const largest = signedDistance(windowStart.add(x64LeaLength), address);
        const smallest = signedDistance(windowEnd.sub(1).add(x64LeaLength), address);
        if (largest < -int32Range || smallest >= int32Range) {
            return [];
        }
        return [...new Set([smallest, largest].map(distance => (distance >>> 16) & 0xffff))]
            .flatMap(high => x64PathRegisterEncodings.map(modrm => `48 8d ${modrm} ?? ?? ${hexByte(high & 0xff)} ${hexByte(high >>> 8)}`));
    }).filter(lea => offsetBy(lea.add(x64LeaLength), lea.add(3).readS32()).equals(address))
        .map(lea => ({ address: lea, register: x64ArgumentRegisters.get(x64LeaRegister(lea)) }))
        .filter((load): load is AddressLoad => load.register !== undefined);
}

function x64LeaRegister(lea: NativePointer): number {
    return ((lea.add(2).readU8() >>> 3) & 7) | ((lea.readU8() & 0x4) << 1);
}

function followX64CallSetup(start: NativePointer, constants: Map<number, number>): SetupEnd {
    let cursor = start;
    let pushed: number | null = null;
    let jumpsFollowed = 0;
    for (let i = 0; i !== callSetupLimit; i++) {
        const prefix = cursor.readU8();
        const rex = ((prefix & 0xf0) === 0x40) ? prefix : 0;
        const opcodeAddress = (rex !== 0) ? cursor.add(1) : cursor;
        const opcode = opcodeAddress.readU8();
        const modrm = opcodeAddress.add(1).readU8();
        if (opcode >= 0xb8 && opcode <= 0xbf && (rex & 0x8) === 0) {
            setX64Constant(constants, (opcode - 0xb8) | ((rex & 1) << 3), opcodeAddress.add(1).readU32());
            cursor = opcodeAddress.add(5);
        } else if (rex === 0 && opcode === 0x6a) {
            pushed = opcodeAddress.add(1).readS8();
            cursor = opcodeAddress.add(2);
        } else if (rex === 0 && opcode === 0x68) {
            pushed = opcodeAddress.add(1).readS32();
            cursor = opcodeAddress.add(5);
        } else if (opcode >= 0x58 && opcode <= 0x5f && pushed !== null) {
            setX64Constant(constants, (opcode - 0x58) | ((rex & 1) << 3), pushed);
            pushed = null;
            cursor = opcodeAddress.add(1);
        } else if (isX64RegisterToRegister(opcode, modrm)) {
            const destination = x64RegisterToRegisterDestination(opcode, modrm, rex);
            const zeroing = (opcode === 0x31 || opcode === 0x33) && (modrm & 7) === ((modrm >>> 3) & 7);
            if (zeroing) {
                setX64Constant(constants, destination, 0);
            } else {
                forgetX64Constant(constants, destination);
            }
            cursor = opcodeAddress.add(2);
        } else if (rex === 0 && opcode === 0xe8) {
            return { kind: "call", callee: offsetBy(cursor.add(x64CallLength), cursor.add(1).readS32()) };
        } else if (rex === 0 && (opcode === 0xe9 || opcode === 0xeb)) {
            if (jumpsFollowed++ === jumpsFollowedLimit) {
                return { kind: "unknown" };
            }
            cursor = (opcode === 0xe9)
                ? offsetBy(cursor.add(x64CallLength), cursor.add(1).readS32())
                : offsetBy(cursor.add(x64ShortJumpLength), cursor.add(1).readS8());
        } else {
            return { kind: "unknown" };
        }
    }
    return { kind: "unknown" };
}

function setX64Constant(constants: Map<number, number>, register: number, value: number): void {
    const argument = x64ArgumentRegisters.get(register);
    if (argument !== undefined) {
        constants.set(argument, value);
    }
}

function forgetX64Constant(constants: Map<number, number>, register: number): void {
    const argument = x64ArgumentRegisters.get(register);
    if (argument !== undefined) {
        constants.delete(argument);
    }
}

function isX64RegisterToRegister(opcode: number, modrm: number): boolean {
    const registerOperands = (modrm & 0xc0) === 0xc0;
    return registerOperands && (opcode === 0x31 || opcode === 0x33 || opcode === 0x89 || opcode === 0x8b);
}

function x64RegisterToRegisterDestination(opcode: number, modrm: number, rex: number): number {
    const toRm = opcode === 0x31 || opcode === 0x89;
    return toRm ? (modrm & 7) | ((rex & 1) << 3) : ((modrm >>> 3) & 7) | ((rex & 4) << 1);
}

type WindowPatterns = (windowStart: NativePointer, windowEnd: NativePointer) => string[];

const longestPattern = 8;

function scanRelativeWindows(range: MemoryRange, windowSize: number, patternsFor: WindowPatterns): NativePointer[] {
    const matches: NativePointer[] = [];
    const end = range.base.add(range.size);
    for (let windowStart = range.base; windowStart.compare(end) < 0; windowStart = windowStart.add(windowSize)) {
        const windowEnd = earlier(windowStart.add(windowSize), end);
        const scanned = byteDistance(windowStart, earlier(windowEnd.add(longestPattern - 1), end));
        for (const pattern of patternsFor(windowStart, windowEnd)) {
            for (const { address } of Memory.scanSync(windowStart, scanned, pattern)) {
                if (address.compare(windowEnd) < 0) {
                    matches.push(address);
                }
            }
        }
    }
    return matches;
}

function wordPattern(value: number, mask: number): string {
    return `${littleEndianHex(value)} : ${littleEndianHex(mask)}`;
}

function littleEndianHex(word: number): string {
    return [0, 8, 16, 24].map(shift => hexByte((word >>> shift) & 0xff)).join(" ");
}

function hexByte(value: number): string {
    return value.toString(16).padStart(2, "0");
}

function signExtended(value: number, bits: number): number {
    const sign = 2 ** (bits - 1);
    return (value >= sign) ? value - 2 * sign : value;
}

function offsetBy(address: NativePointer, delta: number): NativePointer {
    return (delta >= 0) ? address.add(delta) : address.sub(-delta);
}

function signedDistance(from: NativePointer, to: NativePointer): number {
    return (to.compare(from) >= 0) ? byteDistance(from, to) : -byteDistance(to, from);
}

function byteDistance(from: NativePointer, to: NativePointer): number {
    return Number(to.sub(from).toString());
}

function earlier(a: NativePointer, b: NativePointer): NativePointer {
    return (a.compare(b) <= 0) ? a : b;
}
