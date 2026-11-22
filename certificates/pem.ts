const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const sextets = new Map(Array.from(alphabet, (character, index) => [character.charCodeAt(0), index]));
const padding = "=".charCodeAt(0);
const lineLength = 64;

export function decodeBase64Body(text: Uint8Array): Uint8Array {
    const decoded: number[] = [];
    let accumulator = 0;
    let bits = 0;
    for (const character of text) {
        if (character === padding) {
            break;
        }
        const sextet = sextets.get(character);
        if (sextet === undefined) {
            continue;
        }
        accumulator = (accumulator << 6) | sextet;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            decoded.push((accumulator >> bits) & 0xff);
        }
    }
    return new Uint8Array(decoded);
}

export function pemOf(der: ArrayBuffer): string {
    const encoded = encodeBase64(new Uint8Array(der));
    const lines: string[] = [];
    for (let offset = 0; offset < encoded.length; offset += lineLength) {
        lines.push(encoded.slice(offset, offset + lineLength));
    }
    return ["-----BEGIN CERTIFICATE-----", ...lines, "-----END CERTIFICATE-----", ""].join("\n");
}

function encodeBase64(bytes: Uint8Array): string {
    let encoded = "";
    for (let offset = 0; offset < bytes.length; offset += 3) {
        const group = (bytes[offset] << 16) | ((bytes[offset + 1] ?? 0) << 8) | (bytes[offset + 2] ?? 0);
        const available = Math.min(3, bytes.length - offset);
        for (let i = 0; i !== 4; i++) {
            encoded += (i <= available) ? alphabet[(group >> (18 - 6 * i)) & 0x3f] : "=";
        }
    }
    return encoded;
}
