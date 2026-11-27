import { Buffer } from "buffer";
import type { TextureFormat } from "../../mesh-finder/texture-format.js";
import { crc32, decodeTexture, encodePng, fitForView, type ViewPixels } from "../../mesh-finder/texture-kernels.js";

interface Case {
    what: string;
    check(): string | null;
}

const TIMED_SIDE = 2048;
const BC7_BLOCK_SIZE = 16;

const cases: Case[] = [
    { what: "crc32 matches zlib's for the standard check string", check: standardCrc },
    { what: "crc32 of a subarray covers only its bytes", check: subarrayCrc },
    { what: "fitForView keeps a texture within the side and packs 0xAARRGGBB words", check: unchangedFit },
    { what: "fitForView box-averages down to the largest side", check: halvedFit },
    { what: "fitForView keeps the aspect ratio of a wide texture", check: wideFit },
];

rpc.exports = {
    run(): number {
        let failures = 0;
        for (const { what, check } of cases) {
            const problem = check();
            failures += (problem !== null) ? 1 : 0;
            console.log((problem === null) ? `PASS ${what}` : `FAIL ${what}: ${problem}`);
        }
        return failures;
    },

    decode(format: TextureFormat, width: number, height: number, data: string): string {
        return Buffer.from(decodeTexture(bufferOf(data), format, width, height)).toString("base64");
    },

    encodePng(width: number, height: number, rgba: string): string {
        return Buffer.from(encodePng(new Uint8Array(bufferOf(rgba)), width, height)).toString("base64");
    },

    time(): string[] {
        const blocks = randomBc7Blocks();
        const start = Date.now();
        const decoded = decodeTexture(blocks, "bc7", TIMED_SIDE, TIMED_SIDE);
        const elapsed = Date.now() - start;
        return [
            `decoding ${TIMED_SIDE}x${TIMED_SIDE} BC7 took ${elapsed} ms`,
            timedPng("random BC7 blocks, decoded", decoded),
            timedPng("a smooth gradient", smoothGradient()),
        ];
    },
};

function standardCrc(): string | null {
    const value = crc32(new Uint8Array(Buffer.from("123456789")));
    return (value === 0xcbf43926) ? null : `got 0x${value.toString(16)}`;
}

function subarrayCrc(): string | null {
    const bytes = new Uint8Array(Buffer.from("xx123456789yy"));
    const value = crc32(bytes.subarray(2, 11));
    return (value === 0xcbf43926) ? null : `got 0x${value.toString(16)}`;
}

function unchangedFit(): string | null {
    const rgba = Uint8Array.from([1, 2, 3, 4, 250, 251, 252, 253]);
    const fitted = fitForView(rgba, 2, 1, 16);
    return problemWithFit(fitted, 2, 1, [0x04010203, 0xfdfafbfc]);
}

function halvedFit(): string | null {
    const rgba = Uint8Array.from([
        0, 0, 0, 0, 10, 20, 30, 40, 100, 100, 100, 100, 101, 101, 101, 101,
        2, 4, 6, 8, 12, 24, 36, 48, 102, 102, 102, 102, 103, 103, 103, 103,
    ]);
    const fitted = fitForView(rgba, 4, 2, 2);
    return problemWithFit(fitted, 2, 1, [packed(6, 12, 18, 24), packed(102, 102, 102, 102)]);
}

function wideFit(): string | null {
    const rgba = new Uint8Array(1000 * 10 * 4).fill(255);
    const fitted = fitForView(rgba, 1000, 10, 100);
    return problemWithFit(fitted, 100, 1, new Array(100).fill(0xffffffff));
}

function problemWithFit(fitted: ViewPixels, width: number, height: number, words: number[]): string | null {
    const got = Array.from(new Uint32Array(fitted.pixels));
    if (fitted.width !== width || fitted.height !== height) {
        return `fitted to ${fitted.width}x${fitted.height}`;
    }
    return (got.every((word, i) => word === words[i]) && got.length === words.length)
        ? null
        : `got ${got.map(word => word.toString(16)).join(" ")}`;
}

function packed(r: number, g: number, b: number, a: number): number {
    return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

function bufferOf(base64: string): ArrayBuffer {
    const bytes = Buffer.from(base64, "base64");
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function timedPng(what: string, rgba: Uint8Array): string {
    const start = Date.now();
    const png = encodePng(rgba, TIMED_SIDE, TIMED_SIDE);
    const elapsed = Date.now() - start;
    const ratio = (100 * png.byteLength / rgba.byteLength).toFixed(1);
    return `encoding ${TIMED_SIDE}x${TIMED_SIDE} PNG of ${what} took ${elapsed} ms, ${png.byteLength} bytes (${ratio}% of RGBA)`;
}

function randomBc7Blocks(): ArrayBuffer {
    const blocks = new Uint8Array((TIMED_SIDE / 4) * (TIMED_SIDE / 4) * BC7_BLOCK_SIZE);
    let seed = 1;
    for (let i = 0; i !== blocks.length; i++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        blocks[i] = seed >>> 24;
    }
    for (let i = 0; i < blocks.length; i += BC7_BLOCK_SIZE) {
        const mode = (i / BC7_BLOCK_SIZE) % 8;
        blocks[i] = ((blocks[i] << (mode + 1)) | (1 << mode)) & 0xff;
    }
    return blocks.buffer;
}

function smoothGradient(): Uint8Array {
    const rgba = new Uint8Array(TIMED_SIDE * TIMED_SIDE * 4);
    for (let y = 0; y !== TIMED_SIDE; y++) {
        for (let x = 0; x !== TIMED_SIDE; x++) {
            const i = (y * TIMED_SIDE + x) * 4;
            rgba[i] = x >> 3;
            rgba[i + 1] = y >> 3;
            rgba[i + 2] = ((x * y) >> 14) & 0xff;
            rgba[i + 3] = 255;
        }
    }
    return rgba;
}
