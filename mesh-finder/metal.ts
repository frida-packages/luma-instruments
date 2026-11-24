import type {
    BufferSearch,
    DrawCall,
    GeometryObserver,
    GpuBuffer,
    GraphicsBackend,
    GraphicsBackendFactory,
    IndexBinding,
    Topology,
    VertexStream,
} from "./graphics-backend.js";
import { metalLibraries } from "./graphics-libraries.js";
import { BytesBuffer, findMetalBuffers, metalBufferId, MetalBufferDescriber } from "./metal-buffers.js";
import { EncoderTap, type EncodedDraw, type EncodedSlot } from "./metal-encoder-tap.js";
import { PipelineWatch } from "./metal-pipelines.js";
import { classesConformingTo, type DriverClasses } from "./objc.js";

export const metal: GraphicsBackendFactory = {
    api: "Metal",
    libraries: metalLibraries.framework,
    activation: "while-loading",
    create: observer => new MetalBackend(observer),
};

const DRIVER_IMAGES = "/System/Library/Extensions/";
const BUFFER_PROTOCOL = "MTLBuffer";
const ENCODER_PROTOCOL = "MTLRenderCommandEncoder";
const PIPELINE_PROTOCOL = "MTLRenderPipelineState";
const INDEXED_INDIRECT_ARGUMENTS_SIZE = 20;
const INDIRECT_ARGUMENTS_SIZE = 16;
const TRANSLATION_LAYERS = /^AppleMetalOpenGLRenderer$/;
const TRANSLATION_LAYER_LABELS = /^com\.apple\.metal\.gl/;

const topologies: (Topology | null)[] = ["point-list", null, null, "triangle-list", "triangle-strip"];

class MetalBackend implements GraphicsBackend {
    readonly api = "Metal";
    readonly #observer: GeometryObserver;
    readonly #classes: DriverClasses =
        classesConformingTo([BUFFER_PROTOCOL, ENCODER_PROTOCOL, PIPELINE_PROTOCOL], DRIVER_IMAGES);
    readonly #describer = new MetalBufferDescriber();
    #pipelines: PipelineWatch | null = null;
    #encoders: EncoderTap | null = null;
    #translationLayers: ModuleObserver | null = null;

    constructor(observer: GeometryObserver) {
        this.#observer = observer;
    }

    watchDraws(): void {
        const encoders = new EncoderTap(draw => this.#onDraw(draw), buffer => this.#observer.observeScratchBuffer(metalBufferId(buffer)));
        this.#encoders = encoders;
        this.#pipelines = new PipelineWatch(this.#classes[PIPELINE_PROTOCOL], (pipeline, layout) => {
            if (layout !== "no-vertex-descriptor") {
                encoders.narrowPipeline(pipeline, 1 << layout.slot);
            }
        });
        this.#translationLayers = Process.attachModuleObserver({
            onAdded(module) {
                if (TRANSLATION_LAYERS.test(module.name)) {
                    encoders.ignoreCallsFrom(module);
                }
            },
        });
        encoders.start(this.#classes[ENCODER_PROTOCOL]);
    }

    unwatchDraws(): void {
        this.#translationLayers?.detach();
        this.#pipelines?.dispose();
        this.#encoders?.dispose();
        this.#translationLayers = null;
        this.#pipelines = null;
        this.#encoders = null;
    }

    async findBuffers(): Promise<BufferSearch> {
        const found = findMetalBuffers(this.#classes[BUFFER_PROTOCOL], this.#describer);
        const buffers = found.filter(buffer => !TRANSLATION_LAYER_LABELS.test(buffer.label ?? ""));
        this.#observer.observeBuffers(buffers);
        const layered = (found.length !== buffers.length)
            ? `, leaving out ${found.length - buffers.length} that OpenGL keeps for itself`
            : "";
        return { buffers: buffers.length, detail: `instances of ${this.#classes[BUFFER_PROTOCOL].length} driver buffer classes${layered}` };
    }

    dispose(): void {
        this.unwatchDraws();
    }

    #onDraw(draw: EncodedDraw): void {
        const call = this.#drawCallOf(draw);
        if (call !== null) {
            this.#observer.observeDraw(call);
        }
    }

    #drawCallOf(draw: EncodedDraw): DrawCall | null {
        const topology = topologies[draw.primitive] ?? null;
        if (topology === null) {
            return null;
        }
        const layout = this.#pipelines!.layoutOf(draw.pipeline);
        const encoders = this.#encoders!;
        const call: DrawCall = {
            api: this.api,
            topology,
            streams: draw.slots.filter(slot => slot.role === "may-hold-vertices").flatMap(slot => this.#streamsOf(slot)),
            bystanders: draw.slots.filter(slot => slot.role === "bystander").flatMap(slot => this.#buffersOf(slot)),
            position: (layout !== undefined && layout !== "no-vertex-descriptor") ? layout : null,
            indices: null,
            firstVertex: draw.vertexStart,
            vertexCount: draw.vertexCount,
            baseVertex: draw.baseVertex,
            noteSlotGuess(slot) {
                encoders.noteGuessedSlot(draw.pipeline, slot);
            },
        };
        return draw.indexBuffer.isNull() ? this.#withIndirectVertices(call, draw) : this.#withIndices(call, draw);
    }

    #streamsOf(slot: EncodedSlot): VertexStream[] {
        const buffer: GpuBuffer | null = (slot.bytesLength !== 0)
            ? new BytesBuffer(slot.bytes, slot.bytesLength, slot.bytesDigest)
            : this.#describer.describeLive(slot.buffer);
        return (buffer !== null) ? [{ slot: slot.index, buffer, offset: slot.offset, stride: slot.stride }] : [];
    }

    #buffersOf(slot: EncodedSlot): GpuBuffer[] {
        const buffer = (slot.bytesLength === 0) ? this.#describer.describeLive(slot.buffer) : null;
        return (buffer !== null) ? [buffer] : [];
    }

    #withIndirectVertices(call: DrawCall, draw: EncodedDraw): DrawCall | null {
        if (draw.indirectBuffer.isNull()) {
            return call;
        }
        const args = this.#indirectArguments(draw);
        if (args === null) {
            return null;
        }
        return { ...call, vertexCount: args.getUint32(0, true), firstVertex: args.getUint32(8, true) };
    }

    #withIndices(call: DrawCall, draw: EncodedDraw): DrawCall | null {
        const buffer = this.#describer.describeLive(draw.indexBuffer);
        if (buffer === null) {
            return null;
        }
        const indices: IndexBinding = {
            buffer,
            offset: draw.indexOffset,
            format: (draw.indexType === 0) ? "uint16" : "uint32",
            count: draw.indexCount,
        };
        if (!draw.indirectBuffer.isNull()) {
            const args = this.#indirectArguments(draw);
            if (args === null) {
                return null;
            }
            indices.count = args.getUint32(0, true);
            indices.offset += args.getUint32(8, true) * ((indices.format === "uint16") ? 2 : 4);
            call.baseVertex = args.getInt32(12, true);
        }
        return { ...call, indices };
    }

    #indirectArguments(draw: EncodedDraw): DataView | null {
        const buffer = this.#describer.describeLive(draw.indirectBuffer);
        if (buffer === null || buffer.access !== "cpu-readable") {
            return null;
        }
        const size = draw.indexBuffer.isNull() ? INDIRECT_ARGUMENTS_SIZE : INDEXED_INDIRECT_ARGUMENTS_SIZE;
        return new DataView(buffer.read(draw.indirectOffset, size));
    }
}
