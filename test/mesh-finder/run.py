import base64
import random
import struct
import subprocess
import sys
import zlib
from pathlib import Path

import frida

here = Path(__file__).resolve().parent
repository = here.parent.parent


def main():
    if sys.argv[1] == "--bundle":
        Path(sys.argv[2]).write_text(build("harness.ts"))
        return
    if sys.argv[1] == "--export":
        check_export()
    if sys.argv[1] == "--textures":
        check_textures(sys.argv[2])
    if sys.argv[1] == "--probe":
        probe(int(sys.argv[2]), float(sys.argv[3]))
    pid, out = int(sys.argv[1]), sys.argv[2]
    exploring = len(sys.argv) > 3
    bundle = build("explore.ts" if exploring else "harness.ts")

    session = frida.attach(pid)
    script = session.create_script(bundle)
    script.on("message", print_message)
    script.load()
    if exploring:
        script.exports_sync.explore(out, float(sys.argv[3]))
        failures = 0
    else:
        failures = script.exports_sync.run(out)
    script.unload()
    session.detach()
    sys.exit(1 if failures else 0)


def check_export():
    session = frida.attach(0)
    script = session.create_script(build("export-check.ts"))
    script.on("message", print_message)
    script.load()
    failures = script.exports_sync.run()
    script.unload()
    session.detach()
    sys.exit(1 if failures else 0)


def check_textures(reference):
    session = frida.attach(0)
    script = session.create_script(build("texture-check.ts"))
    script.on("message", print_message)
    script.load()
    checks = script.exports_sync
    failures = checks.run()
    for name in TEXTURE_FORMATS:
        failures += check_decoding(checks, reference, name)
    for what, width, height, rgba, compressible in png_cases():
        failures += check_png(checks, what, width, height, rgba, compressible)
    for line in checks.time():
        print(line, flush=True)
    script.unload()
    session.detach()
    sys.exit(1 if failures else 0)


def check_decoding(checks, reference, name):
    metal, swizzle, snorm, block_width, block_height, block_size = describe_texture_format(name)
    rng = random.Random(name)
    columns, rows = (64, 32) if block_width > 1 else (61, 37)
    width = columns * block_width - block_width // 2
    height = rows * block_height - block_height // 2
    data, gpu_data = texture_data(name, rng, columns, rows)
    expected = subprocess.run([reference, metal, str(width), str(height), swizzle, "1" if snorm else "0"], input=gpu_data,
                              capture_output=True, check=True).stdout
    decoded = base64.b64decode(checks.decode(name, width, height, base64.b64encode(data).decode()))
    what = f"{name} decodes {width}x{height} texels as this GPU's Metal {metal} does"
    mismatches = [i for i in range(0, len(expected), 4) if decoded[i:i + 4] != expected[i:i + 4]]
    if not mismatches:
        print(f"PASS {what}, byte for byte", flush=True)
        return 0
    texel = mismatches[0] // 4
    x, y = texel % width, texel // width
    print(f"FAIL {what}: {len(mismatches)} texels differ, the first at ({x}, {y}) is {list(decoded[texel * 4:texel * 4 + 4])}, "
          f"not {list(expected[texel * 4:texel * 4 + 4])}", flush=True)
    return 1


def check_png(checks, what, width, height, rgba, compressible):
    png = base64.b64decode(checks.encode_png(width, height, base64.b64encode(rgba).decode()))
    try:
        decoded_width, decoded_height, decoded = decode_png(png)
    except (AssertionError, zlib.error, struct.error) as e:
        print(f"FAIL a {width}x{height} PNG of {what} decodes: {e!r}", flush=True)
        return 1
    if (decoded_width, decoded_height) != (width, height) or decoded != rgba:
        print(f"FAIL a {width}x{height} PNG of {what} decodes back to its pixels", flush=True)
        return 1
    if compressible and len(png) * COMPRESSED_SHARE > len(rgba):
        print(f"FAIL a {width}x{height} PNG of {what} is compressed: {len(png)} bytes for {len(rgba)} of pixels", flush=True)
        return 1
    print(f"PASS a {width}x{height} PNG of {what} decodes back to its pixels, {len(png)} bytes", flush=True)
    return 0


TEXTURE_FORMATS = [
    "r8unorm", "a8unorm", "rg8unorm", "rgb8unorm", "rgba8unorm", "bgra8unorm", "bgrx8unorm",
    "rgb565", "rgba4444", "argb4444", "rgb5a1", "a1rgb5", "rgb10a2unorm", "rg11b10float", "rgb9e5float",
    "r16unorm", "rg16unorm", "rgba16unorm", "r16float", "rg16float", "rgba16float", "r32float", "rg32float", "rgba32float",
    "bc1", "bc2", "bc3", "bc4unorm", "bc4snorm", "bc5unorm", "bc5snorm", "bc6hufloat", "bc6hsfloat", "bc7",
    "etc2rgb8", "etc2rgb8a1", "etc2rgba8", "eacr11", "eacrg11",
    "astc4x4", "astc5x4", "astc5x5", "astc6x5", "astc6x6", "astc8x5", "astc8x6", "astc8x8",
    "astc10x5", "astc10x6", "astc10x8", "astc10x10", "astc12x10", "astc12x12",
]

PLAIN_FORMATS = {
    "r8unorm": ("R8Unorm", "rrr1", 1),
    "a8unorm": ("A8Unorm", "111a", 1),
    "rg8unorm": ("RG8Unorm", "rg01", 2),
    "rgb8unorm": ("RGBA8Unorm", "rgb1", 3),
    "rgba8unorm": ("RGBA8Unorm", "rgba", 4),
    "bgra8unorm": ("BGRA8Unorm", "rgba", 4),
    "bgrx8unorm": ("BGRA8Unorm", "rgb1", 4),
    "rgb565": ("B5G6R5Unorm", "rgb1", 2),
    "rgba4444": ("ABGR4Unorm", "rgba", 2),
    "argb4444": ("ABGR4Unorm", "gbar", 2),
    "rgb5a1": ("A1BGR5Unorm", "rgba", 2),
    "a1rgb5": ("BGR5A1Unorm", "rgba", 2),
    "rgb10a2unorm": ("RGB10A2Unorm", "rgba", 4),
    "rg11b10float": ("RG11B10Float", "rgb1", 4),
    "rgb9e5float": ("RGB9E5Float", "rgb1", 4),
    "r16unorm": ("R16Unorm", "rrr1", 2),
    "rg16unorm": ("RG16Unorm", "rg01", 4),
    "rgba16unorm": ("RGBA16Unorm", "rgba", 8),
    "r16float": ("R16Float", "rrr1", 2),
    "rg16float": ("RG16Float", "rg01", 4),
    "rgba16float": ("RGBA16Float", "rgba", 8),
    "r32float": ("R32Float", "rrr1", 4),
    "rg32float": ("RG32Float", "rg01", 8),
    "rgba32float": ("RGBA32Float", "rgba", 16),
}

BLOCK_FORMATS = {
    "bc1": ("BC1_RGBA", "rgba", 8, False),
    "bc2": ("BC2_RGBA", "rgba", 16, False),
    "bc3": ("BC3_RGBA", "rgba", 16, False),
    "bc4unorm": ("BC4_RUnorm", "rrr1", 8, False),
    "bc4snorm": ("BC4_RSnorm", "rrr1", 8, True),
    "bc5unorm": ("BC5_RGUnorm", "rg01", 16, False),
    "bc5snorm": ("BC5_RGSnorm", "rg01", 16, True),
    "bc6hufloat": ("BC6H_RGBUfloat", "rgb1", 16, False),
    "bc6hsfloat": ("BC6H_RGBFloat", "rgb1", 16, False),
    "bc7": ("BC7_RGBAUnorm", "rgba", 16, False),
    "etc2rgb8": ("ETC2_RGB8", "rgba", 8, False),
    "etc2rgb8a1": ("ETC2_RGB8A1", "rgba", 8, False),
    "etc2rgba8": ("EAC_RGBA8", "rgba", 16, False),
    "eacr11": ("EAC_R11Unorm", "rrr1", 8, False),
    "eacrg11": ("EAC_RG11Unorm", "rg01", 16, False),
}

BC6H_MODES = [0b00, 0b01, 0b00010, 0b00110, 0b01010, 0b01110, 0b10010, 0b10110, 0b11010, 0b11110, 0b00011, 0b00111, 0b01011,
              0b01111]
BC6H_RESERVED_MODES = [0b10011, 0b10111, 0b11011, 0b11111]
ISE_SHAPES = [(1, 0, 0), (0, 1, 0), (2, 0, 0), (0, 0, 1), (1, 1, 0), (3, 0, 0), (1, 0, 1), (2, 1, 0), (4, 0, 0), (2, 0, 1),
              (3, 1, 0), (5, 0, 0), (3, 0, 1), (4, 1, 0), (6, 0, 0), (4, 0, 1), (5, 1, 0), (7, 0, 0), (5, 0, 1), (6, 1, 0),
              (8, 0, 0)]
ASTC_LDR_MODES_BY_CLASS = [[0, 1], [4, 5, 6], [8, 9, 10], [12, 13]]
ASTC_LDR_MODES = [mode for modes in ASTC_LDR_MODES_BY_CLASS for mode in modes]
ASTC_SMALLEST_COLOR_RANGE = 4
COMPRESSED_SHARE = 4


def describe_texture_format(name):
    if name in PLAIN_FORMATS:
        metal, swizzle, size = PLAIN_FORMATS[name]
        return metal, swizzle, False, 1, 1, size
    if name in BLOCK_FORMATS:
        metal, swizzle, size, snorm = BLOCK_FORMATS[name]
        return metal, swizzle, snorm, 4, 4, size
    width, height = (int(side) for side in name[4:].split("x"))
    return f"ASTC_{width}x{height}_LDR", "rgba", False, width, height, 16


def texture_data(name, rng, columns, rows):
    count = columns * rows
    if name in PLAIN_FORMATS:
        data = plain_texels(name, rng, count, PLAIN_FORMATS[name][2])
        if name == "rgb8unorm":
            return data, b"".join(data[i:i + 3] + b"\xff" for i in range(0, len(data), 3))
        return data, data
    if name == "bc7":
        data = b"".join(bc7_block(rng) for _ in range(count))
    elif name.startswith("bc6h"):
        data = b"".join(bc6h_block(rng) for _ in range(count))
    elif name.startswith("astc"):
        _, _, _, block_width, block_height, _ = describe_texture_format(name)
        modes = astc_block_modes(block_width, block_height)
        data = b"".join(astc_block(rng, modes) for _ in range(count))
    else:
        data = rng.randbytes(count * BLOCK_FORMATS[name][2])
    return data, data


def plain_texels(name, rng, count, size):
    if "float" not in name or name in ("rg11b10float", "rgb9e5float"):
        return rng.randbytes(count * size)
    wide = "32" in name
    out = bytearray()
    for _ in range(count * size // (4 if wide else 2)):
        if rng.random() < 0.25:
            out += rng.randbytes(4 if wide else 2)
        else:
            out += struct.pack("<f" if wide else "<e", rng.uniform(-0.25, 1.25))
    return bytes(out)


def bc7_block(rng):
    block = bytearray(rng.randbytes(16))
    if rng.random() < 1 / 32:
        block[0] = 0
    else:
        mode = rng.randrange(8)
        block[0] = ((block[0] << (mode + 1)) | (1 << mode)) & 0xff
    return bytes(block)


def bc6h_block(rng):
    block = bytearray(rng.randbytes(16))
    mode = rng.choice(BC6H_MODES) if rng.random() > 1 / 32 else rng.choice(BC6H_RESERVED_MODES)
    mode_bits = 2 if mode < 2 else 5
    block[0] = (block[0] & ~((1 << mode_bits) - 1) & 0xff) | mode
    return bytes(block)


def astc_block_modes(block_width, block_height):
    legal = []
    for mode in range(2048):
        grid = astc_weight_grid(mode)
        if mode & 0x1ff == 0x1fc or grid is None:
            continue
        width, height, dual, weight_range = grid
        count = width * height * (2 if dual else 1)
        if width > block_width or height > block_height or count > 64:
            continue
        bits = ise_bit_count(count, weight_range)
        if 24 <= bits <= 96:
            legal.append((mode, dual, bits))
    return legal


def astc_weight_grid(mode):
    weight_range = (mode >> 4) & 1
    high_precision = (mode >> 9) & 1
    dual = (mode >> 10) & 1
    a = (mode >> 5) & 3
    if mode & 3:
        weight_range |= (mode & 3) << 1
        b = (mode >> 7) & 3
        layout = (mode >> 2) & 3
        if layout == 0:
            width, height = b + 4, a + 2
        elif layout == 1:
            width, height = b + 8, a + 2
        elif layout == 2:
            width, height = a + 2, b + 8
        elif mode & 0x100:
            width, height = (b & 1) + 2, a + 2
        else:
            width, height = a + 2, (b & 1) + 6
    else:
        weight_range |= ((mode >> 2) & 3) << 1
        if (mode >> 2) & 3 == 0:
            return None
        b = (mode >> 9) & 3
        layout = (mode >> 7) & 3
        if layout == 0:
            width, height = 12, a + 2
        elif layout == 1:
            width, height = a + 2, 12
        elif layout == 2:
            width, height = a + 6, b + 6
            dual = high_precision = 0
        elif a >= 2:
            return None
        else:
            width, height = (6, 10) if a == 0 else (10, 6)
    return width, height, dual, weight_range - 2 + 6 * high_precision


def ise_bit_count(count, quantization):
    bits, trits, quints = ISE_SHAPES[quantization]
    return count * bits + ((8 * count + 4) // 5 if trits else 0) + ((7 * count + 2) // 3 if quints else 0)


def astc_block(rng, modes):
    roll = rng.random()
    if roll < 0.15:
        return rng.randbytes(16)
    if roll < 0.25:
        return astc_void_extent_block(rng)
    while True:
        block = legal_astc_block(rng, modes)
        if block is not None:
            return block


def astc_void_extent_block(rng):
    value = int.from_bytes(rng.randbytes(16), "little") & ~((1 << 64) - 1)
    value |= 0x1fc | (3 << 10)
    roll = rng.random()
    if roll < 0.3:
        coordinates = [0x1fff] * 4
    else:
        coordinates = []
        for _ in range(2):
            low = rng.randrange(0x1fff)
            coordinates += [low, rng.randrange(low + 1, 0x2000)]
    if roll > 0.8:
        flaw = rng.randrange(3)
        if flaw == 0:
            value |= 1 << 9
        elif flaw == 1:
            value &= ~(1 << rng.choice([10, 11]))
        else:
            coordinates[0], coordinates[1] = max(coordinates[0], coordinates[1]), min(coordinates[0], coordinates[1], 5)
    for i, coordinate in enumerate(coordinates):
        value |= coordinate << (12 + 13 * i)
    return value.to_bytes(16, "little")


def legal_astc_block(rng, modes):
    mode, dual, weight_bits = rng.choice(modes)
    partitions = rng.randint(1, 3 if dual else 4)
    value = (int.from_bytes(rng.randbytes(16), "little") & ~0x1fff) | mode | ((partitions - 1) << 11)
    extra_bits = 0
    if partitions == 1:
        endpoint_modes = [rng.choice(ASTC_LDR_MODES)]
        value = (value & ~(0xf << 13)) | (endpoint_modes[0] << 13)
    elif rng.random() < 0.4:
        endpoint_modes = [rng.choice(ASTC_LDR_MODES)] * partitions
        value = (value & ~(0x3f << 23)) | ((endpoint_modes[0] << 2) << 23)
    else:
        base = rng.randrange(3)
        endpoint_modes = [rng.choice(ASTC_LDR_MODES_BY_CLASS[base + rng.randrange(2)]) for _ in range(partitions)]
        encoded = base + 1
        for p, endpoint_mode in enumerate(endpoint_modes):
            encoded |= ((endpoint_mode >> 2) - base) << (2 + p)
            encoded |= (endpoint_mode & 3) << (2 + partitions + 2 * p)
        extra_bits = 3 * partitions - 4
        below_weights = 128 - weight_bits - extra_bits
        value = (value & ~(0x3f << 23)) | ((encoded & 0x3f) << 23)
        value = (value & ~(((1 << extra_bits) - 1) << below_weights)) | ((encoded >> 6) << below_weights)
    count = sum(((endpoint_mode >> 2) + 1) * 2 for endpoint_mode in endpoint_modes)
    color_bits = (111 if partitions == 1 else 99) - weight_bits - extra_bits - (2 if dual else 0)
    if count > 18 or ise_bit_count(count, ASTC_SMALLEST_COLOR_RANGE) > color_bits:
        return None
    return value.to_bytes(16, "little")


def png_cases():
    rng = random.Random("png")
    yield "noise", 97, 61, rng.randbytes(97 * 61 * 4), False
    yield "noise spanning many deflate blocks", 1024, 768, rng.randbytes(1024 * 768 * 4), False
    yield "one colour", 300, 200, bytes([10, 20, 30, 255]) * (300 * 200), True
    yield "a gradient", 256, 256, bytes(v for y in range(256) for x in range(256) for v in (x, y, (x + y) // 2, 255)), True
    yield "repeating stripes", 640, 480, bytes((x // 7 * 40) & 0xff for y in range(480) for x in range(640 * 4)), True
    yield "a single pixel", 1, 1, bytes([1, 2, 3, 4]), False


def decode_png(png):
    assert png[:8] == b"\x89PNG\r\n\x1a\n", "no PNG signature"
    chunks = []
    position = 8
    while position < len(png):
        length, kind = struct.unpack(">I4s", png[position:position + 8])
        data = png[position + 8:position + 8 + length]
        crc, = struct.unpack(">I", png[position + 8 + length:position + 12 + length])
        assert crc == zlib.crc32(kind + data), f"bad CRC in {kind}"
        chunks.append((kind, data))
        position += 12 + length
    assert chunks[0][0] == b"IHDR" and chunks[-1] == (b"IEND", b""), "not framed by IHDR and IEND"
    width, height, depth, color_type, compression, filtering, interlace = struct.unpack(">IIBBBBB", chunks[0][1])
    assert (depth, color_type, compression, filtering, interlace) == (8, 6, 0, 0, 0), "not plain RGBA8"
    stream = b"".join(data for kind, data in chunks if kind == b"IDAT")
    raw = zlib.decompress(stream)
    stride = width * 4
    assert len(raw) == height * (stride + 1), "wrong amount of image data"
    pixels = bytearray()
    above = bytearray(stride)
    for y in range(height):
        start = y * (stride + 1)
        row = bytearray(raw[start + 1:start + 1 + stride])
        unfilter(raw[start], row, above)
        pixels += row
        above = row
    return width, height, bytes(pixels)


def unfilter(kind, row, above):
    for i in range(len(row)):
        a = row[i - 4] if i >= 4 else 0
        b = above[i]
        c = above[i - 4] if i >= 4 else 0
        if kind == 1:
            row[i] = (row[i] + a) & 0xff
        elif kind == 2:
            row[i] = (row[i] + b) & 0xff
        elif kind == 3:
            row[i] = (row[i] + (a + b) // 2) & 0xff
        elif kind == 4:
            p = a + b - c
            pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
            row[i] = (row[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 0xff
        else:
            assert kind == 0, f"unknown filter {kind}"


def probe(pid, seconds):
    session = frida.attach(pid)
    script = session.create_script(build("draw-probe.ts"))
    script.on("message", print_message)
    script.load()
    script.exports_sync.probe(seconds)
    script.unload()
    session.detach()
    sys.exit(0)


def build(entry):
    compiler = frida.Compiler()
    compiler.on("diagnostics", lambda diagnostics: print("diagnostics", diagnostics, flush=True))
    return compiler.build(str(here / entry), project_root=str(repository), type_check="full")


def print_message(message, data):
    if message["type"] == "log":
        print(message["payload"], flush=True)
    elif message["type"] == "send" and message["payload"]["type"] == "obj":
        path = Path(message["payload"]["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(message["payload"]["text"])
    else:
        print(message, flush=True)


main()
