export function utf8Text(bytes: Uint8Array): string | null {
    let text = "";
    let i = 0;
    while (i < bytes.length) {
        const lead = bytes[i];
        const length = sequenceLength(lead);
        if (length === 0 || i + length > bytes.length) {
            return null;
        }
        let codePoint = (length === 1) ? lead : lead & (0xff >> (length + 1));
        for (let k = 1; k < length; k++) {
            const continuation = bytes[i + k];
            if ((continuation & 0xc0) !== 0x80) {
                return null;
            }
            codePoint = (codePoint << 6) | (continuation & 0x3f);
        }
        if (codePoint < smallestOfLength[length] || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
            return null;
        }
        text += String.fromCodePoint(codePoint);
        i += length;
    }
    return text;
}

const smallestOfLength = [0, 0, 0x80, 0x800, 0x10000];

function sequenceLength(lead: number): number {
    if (lead < 0x80) {
        return 1;
    }
    if ((lead & 0xe0) === 0xc0) {
        return 2;
    }
    if ((lead & 0xf0) === 0xe0) {
        return 3;
    }
    if ((lead & 0xf8) === 0xf0) {
        return 4;
    }
    return 0;
}
