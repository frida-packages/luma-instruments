import type { ExecutableImage, FunctionExtent, FunctionTable } from "./executable-image.js";
import { machineCodeFor, type MachineCode } from "./machine-code.js";

export type BoringSslLocation =
    | { kind: "absent" }
    | { kind: "unplaced"; reason: string }
    | { kind: "placed"; entryPoints: BoringSslEntryPoints };

export interface BoringSslEntryPoints {
    read: NativePointer;
    write: NativePointer;
    doHandshake: NativePointer;
    newSession: NativePointer | null;
    setHostName: NativePointer | null;
}

export interface ErrorReportingFunction {
    extent: FunctionExtent;
    reasons: Set<number>;
    reporters: Set<string>;
}

export function locateStaticBoringSsl(image: ExecutableImage): BoringSslLocation {
    const sourcePaths = findSslLibSourcePaths(image.strings);
    if (sourcePaths.length === 0) {
        return { kind: "absent" };
    }
    if (sourcePaths.length > 1) {
        return { kind: "unplaced", reason: `${sourcePaths.length} copies of ssl_lib.cc` };
    }
    if (image.functions === null) {
        return { kind: "unplaced", reason: "no table of its functions" };
    }
    const machineCode = machineCodeFor(image.architecture);
    const functions = findErrorReportingFunctions(machineCode, image, image.functions, sourcePaths[0]);
    try {
        return { kind: "placed", entryPoints: identifyEntryPoints(machineCode, functions) };
    } catch (e) {
        if (e instanceof UnrecognizedCode) {
            return { kind: "unplaced", reason: e.message };
        }
        throw e;
    }
}

const sourcePathSuffix = "/ssl/ssl_lib.cc";
const longestSourcePath = 512;

function findSslLibSourcePaths(strings: MemoryRange[]): NativePointer[] {
    const pattern = [...sourcePathSuffix, "\0"].map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");
    return strings.flatMap(range => Memory.scanSync(range.base, range.size, pattern)
        .map(match => startOfString(match.address, range.base)));
}

function startOfString(address: NativePointer, rangeStart: NativePointer): NativePointer {
    let start = address;
    for (let i = 0; i !== longestSourcePath && start.compare(rangeStart) > 0; i++) {
        if (start.sub(1).readU8() === 0) {
            break;
        }
        start = start.sub(1);
    }
    return start;
}

const sslLibrary = 16;

export function findErrorReportingFunctions(
    machineCode: MachineCode,
    image: ExecutableImage,
    functions: FunctionTable,
    sourcePath: NativePointer,
): ErrorReportingFunction[] {
    const found = new Map<string, ErrorReportingFunction>();
    for (const call of machineCode.findCallsPassing(image.code, sourcePath)) {
        const library = call.constants.get(0);
        const reason = call.constants.get(call.argument - 1);
        const extent = functions.functionContaining(call.site);
        if (library !== sslLibrary || reason === undefined || extent === null) {
            continue;
        }
        const key = extent.start.toString();
        let entry = found.get(key);
        if (entry === undefined) {
            entry = { extent, reasons: new Set(), reporters: new Set() };
            found.set(key, entry);
        }
        entry.reasons.add(reason);
        entry.reporters.add(call.callee.toString());
    }
    return [...found.values()];
}

const reasons = {
    mallocFailure: 65,
    shouldNotHaveBeenCalled: 66,
    internalError: 68,
    badHelloRequest: 110,
    badLength: 111,
    connectionTypeNotSet: 134,
    noRenegotiation: 182,
    nullSslContext: 185,
    protocolIsShutdown: 194,
    invalidServerName: 213,
    contextHasNoDefaultVersion: 214,
    handshakeFailure: 215,
    uninitialized: 226,
};

const doHandshakeReasons = [reasons.connectionTypeNotSet];
const writeReasons = [reasons.shouldNotHaveBeenCalled, reasons.uninitialized, reasons.handshakeFailure, reasons.badLength, reasons.protocolIsShutdown];
const readCoreReasons = [
    reasons.shouldNotHaveBeenCalled,
    reasons.uninitialized,
    reasons.handshakeFailure,
    reasons.badHelloRequest,
    reasons.noRenegotiation,
    reasons.internalError,
];
const readReasons = [reasons.shouldNotHaveBeenCalled];
const newSessionReasons = [reasons.nullSslContext, reasons.contextHasNoDefaultVersion, reasons.mallocFailure];
const setHostNameReasons = [reasons.invalidServerName, reasons.mallocFailure];

class UnrecognizedCode extends Error {
}

function identifyEntryPoints(machineCode: MachineCode, functions: ErrorReportingFunction[]): BoringSslEntryPoints {
    const doHandshake = onlyOne("SSL_do_handshake", functions, f => f.reasons.has(reasons.connectionTypeNotSet));
    expectReasonsWithin("SSL_do_handshake", doHandshake, doHandshakeReasons);

    const handshakeCallers = functions.filter(f => f !== doHandshake && machineCode.calls(f.extent, doHandshake.extent.start));
    const write = onlyOne("SSL_write", handshakeCallers, f => reportsAll(f, [reasons.uninitialized, reasons.handshakeFailure])
        && (f.reasons.has(reasons.badLength) || f.reasons.has(reasons.protocolIsShutdown)));
    expectReasonsWithin("SSL_write", write, writeReasons);

    const readCore = onlyOne("ssl_read_impl", handshakeCallers, f => f !== write
        && reportsAll(f, [reasons.uninitialized, reasons.handshakeFailure]));
    expectReasonsWithin("ssl_read_impl", readCore, readCoreReasons);

    const read = readCore.reasons.has(reasons.shouldNotHaveBeenCalled)
        ? readCore
        : onlyOne("SSL_read", functions, f => reportsOnly(f, readReasons) && machineCode.calls(f.extent, readCore.extent.start));

    const reporters = new Set([doHandshake, write, readCore, read].flatMap(f => [...f.reporters]));
    if (reporters.size !== 1) {
        throw new UnrecognizedCode(`its errors go through ${reporters.size} functions`);
    }

    return {
        read: read.extent.start,
        write: write.extent.start,
        doHandshake: doHandshake.extent.start,
        newSession: optionalOne(functions, f => f.reasons.has(reasons.nullSslContext), newSessionReasons),
        setHostName: optionalOne(functions, f => f.reasons.has(reasons.invalidServerName), setHostNameReasons),
    };
}

function onlyOne(
    name: string,
    candidates: ErrorReportingFunction[],
    predicate: (f: ErrorReportingFunction) => boolean,
): ErrorReportingFunction {
    const matches = candidates.filter(predicate);
    if (matches.length !== 1) {
        throw new UnrecognizedCode(`${matches.length} candidates for ${name}`);
    }
    return matches[0];
}

function reportsAll(f: ErrorReportingFunction, expected: number[]): boolean {
    return expected.every(reason => f.reasons.has(reason));
}

function expectReasonsWithin(name: string, f: ErrorReportingFunction, allowed: number[]): void {
    if (!reportsOnly(f, allowed)) {
        throw new UnrecognizedCode(`${name} reports unexpected errors`);
    }
}

function optionalOne(
    candidates: ErrorReportingFunction[],
    predicate: (f: ErrorReportingFunction) => boolean,
    allowed: number[],
): NativePointer | null {
    const matches = candidates.filter(predicate);
    return (matches.length === 1 && reportsOnly(matches[0], allowed)) ? matches[0].extent.start : null;
}

function reportsOnly(f: ErrorReportingFunction, allowed: number[]): boolean {
    return [...f.reasons].every(reason => allowed.includes(reason));
}
