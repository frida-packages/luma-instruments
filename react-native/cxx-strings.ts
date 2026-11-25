import {
    AppleArm64LongString,
    AppleArm64ShortString,
    StandardLongString,
    StandardShortString,
} from "./cxx-abi.pat";

export const STD_STRING_SIZE = AppleArm64LongString.size;

const usesAppleArm64Layout = Process.platform === "darwin" && Process.arch === "arm64";
const APPLE_LONG_FLAG = uint64("0x8000000000000000");
const APPLE_SHORT_SIZE_MASK = 0x7f;
const STANDARD_LONG_FLAG = 1;

const operatorDelete = new NativeFunction(
    Module.findGlobalExportByName("_ZdlPv") ?? Module.getGlobalExportByName("free"), "void", ["pointer"]);

export function takeStdString(address: NativePointer): string {
    return usesAppleArm64Layout ? takeAppleArm64String(address) : takeStandardString(address);
}

function takeAppleArm64String(address: NativePointer): string {
    const long = AppleArm64LongString.at(address);
    if (long.capacity.and(APPLE_LONG_FLAG).equals(0)) {
        const short = AppleArm64ShortString.at(address);
        return inlineText(short.text, short.size & APPLE_SHORT_SIZE_MASK);
    }
    return takeHeapText(long.data, long.size.toNumber());
}

function takeStandardString(address: NativePointer): string {
    const short = StandardShortString.at(address);
    if ((short.size & STANDARD_LONG_FLAG) === 0) {
        return inlineText(short.text, short.size >>> 1);
    }
    const long = StandardLongString.at(address);
    return takeHeapText(long.data, long.size.toNumber());
}

function takeHeapText(data: NativePointer, length: number): string {
    const text = utf8Text(data, length);
    operatorDelete(data);
    return text;
}

function inlineText(bytes: number[], length: number): string {
    const copy = Memory.alloc(Math.max(length, 1));
    copy.writeByteArray(bytes.slice(0, length));
    return utf8Text(copy, length);
}

function utf8Text(data: NativePointer, length: number): string {
    return (length === 0) ? "" : data.readUtf8String(length)!;
}
