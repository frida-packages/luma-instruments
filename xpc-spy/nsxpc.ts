import { isOfType, xpc, xpcTypes } from "./xpc.js";

const PROXY_NUMBER_KEY = Memory.allocUtf8String("proxynum");
const ROOT_KEY = Memory.allocUtf8String("root");

const ENCODED_MAGIC = "bplist1";
const ROOT_CONTAINER_MARKER = 0xa0;
const FIRST_OBJECT_OFFSET = 17;
const UTF8_STRING_KIND = 0x7;
const INTEGER_KIND = 0x1;
const LENGTH_FOLLOWS = 0xf;
const HEAD_BYTES = 512;

const selectorPattern = /^[A-Za-z_][A-Za-z0-9_:]*$/;

export function invokedSelector(message: NativePointer): string | null {
    if (!isOfType(message, xpcTypes.dictionary) || xpc.dictionaryGetValue(message, PROXY_NUMBER_KEY).isNull()) {
        return null;
    }
    const root = xpc.dictionaryGetValue(message, ROOT_KEY);
    if (root.isNull() || !isOfType(root, xpcTypes.data)) {
        return null;
    }
    const length = Math.min(xpc.dataGetLength(root).toNumber(), HEAD_BYTES);
    const head = new Uint8Array(xpc.dataGetBytesPtr(root).readByteArray(length)!);
    const selector = firstString(head);
    return (selector !== null && selectorPattern.test(selector)) ? selector : null;
}

function firstString(encoded: Uint8Array): string | null {
    if (encoded.length <= FIRST_OBJECT_OFFSET || ascii(encoded.subarray(0, ENCODED_MAGIC.length)) !== ENCODED_MAGIC
        || encoded[ENCODED_MAGIC.length + 1] !== ROOT_CONTAINER_MARKER) {
        return null;
    }
    const marker = encoded[FIRST_OBJECT_OFFSET];
    if ((marker >> 4) !== UTF8_STRING_KIND) {
        return null;
    }
    let length = marker & 0xf;
    let start = FIRST_OBJECT_OFFSET + 1;
    if (length === LENGTH_FOLLOWS) {
        const lengthMarker = encoded[start];
        if ((lengthMarker >> 4) !== INTEGER_KIND) {
            return null;
        }
        const width = lengthMarker & 0xf;
        length = littleEndian(encoded.subarray(start + 1, start + 1 + width));
        start += 1 + width;
    }
    if (start + length > encoded.length) {
        return null;
    }
    return ascii(encoded.subarray(start, start + length)).replace(/\0$/, "");
}

function ascii(bytes: Uint8Array): string {
    return String.fromCharCode(...bytes);
}

function littleEndian(bytes: Uint8Array): number {
    return bytes.reduceRight((value, byte) => value * 256 + byte, 0);
}
