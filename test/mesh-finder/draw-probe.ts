import { backends } from "../../mesh-finder/backends.js";
import type { DrawCall, GeometryObserver, GraphicsBackend, TextureBinding } from "../../mesh-finder/graphics-backend.js";

const SAMPLED_BYTES = 16;
const SAMPLED_TEXCOORDS = 3;

const seen = new Set<string>();

const observer: GeometryObserver = {
    observeDraw(draw) {
        const key = keyOf(draw);
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        console.log(describeDraw(draw));
    },
    observeBuffers() {
    },
    observeScratchBuffer() {
    },
};

rpc.exports = {
    async probe(seconds: number): Promise<void> {
        const started = startBackends();
        await new Promise(resolve => setTimeout(resolve, seconds * 1000));
        for (const backend of started) {
            backend.dispose();
        }
        console.log(`${seen.size} distinct draws`);
    },
};

function startBackends(): GraphicsBackend[] {
    const modules = Process.enumerateModules();
    const factories = backends.filter(factory => modules.some(module => factory.libraries.test(module.name)));
    return factories.map(factory => {
        const backend = factory.create(observer);
        backend.watchDraws();
        console.log(`watching ${backend.api}`);
        return backend;
    });
}

function keyOf(draw: DrawCall): string {
    const streams = draw.streams.map(stream => `${stream.buffer.id}+${stream.offset}`).join(",");
    const textures = draw.textures.map(binding => binding.texture.id).join(",");
    return `${draw.api}|${streams}|${draw.indices?.buffer.id ?? "-"}|${textures}`;
}

function describeDraw(draw: DrawCall): string {
    const lines = [`draw ${draw.api} ${draw.topology}, streams ${draw.streams.map(stream => `${stream.slot}:${stream.buffer.id}`).join(" ")}`];
    lines.push(`  position: ${JSON.stringify(draw.position)}`);
    lines.push(`  texcoord: ${JSON.stringify(draw.texcoord)}${sampledTexcoords(draw)}`);
    for (const binding of draw.textures) {
        lines.push(`  ${describeBinding(binding)}`);
    }
    return lines.join("\n");
}

function sampledTexcoords(draw: DrawCall): string {
    const layout = draw.texcoord;
    const stream = draw.streams.find(candidate => candidate.slot === layout?.slot);
    if (layout === null || stream === undefined || stream.buffer.access !== "cpu-readable" || layout.format.component !== "float32") {
        return "";
    }
    const stride = stream.stride ?? layout.stride;
    const first = draw.firstVertex + draw.baseVertex;
    const samples: string[] = [];
    for (let i = 0; i !== SAMPLED_TEXCOORDS; i++) {
        const bytes = stream.buffer.read(stream.offset + (first + i) * stride + layout.offset, 8);
        const [u, v] = new Float32Array(bytes);
        samples.push(`(${u}, ${v})`);
    }
    return ` first ${samples.join(" ")}`;
}

function describeBinding(binding: TextureBinding): string {
    const { texture } = binding;
    const head = `texture slot ${binding.slot} "${binding.name ?? ""}" ${texture.id} ${texture.address} "${texture.label ?? ""}" `
        + `${texture.width}x${texture.height} ${texture.format ?? "unsupported"} (${texture.formatName}) ${texture.access}`;
    if (texture.access !== "cpu-readable") {
        return head;
    }
    try {
        const bytes = new Uint8Array(texture.read());
        const sample = [...bytes.slice(0, SAMPLED_BYTES)].map(byte => byte.toString(16).padStart(2, "0")).join(" ");
        return `${head}, ${bytes.byteLength} bytes: ${sample}`;
    } catch (error) {
        return `${head}, read failed: ${(error as Error).message}`;
    }
}
