import type {
    BufferSearch,
    DrawCall,
    GeometryObserver,
    GraphicsBackend,
    GraphicsBackendFactory,
    IndexFormat,
    Topology,
    VertexStream,
} from "./graphics-backend.js";
import { vulkanLibraries } from "./graphics-libraries.js";
import { VulkanContents } from "./vulkan-buffers.js";
import { findVulkanDrivers, type VulkanDriver } from "./vulkan-driver.js";
import {
    dynamicVertexInputOf,
    pipelineEntryPointNames,
    PipelineLayouts,
    positionLayoutOf,
    type PipelineDescription,
    type VertexInputInfo,
} from "./vulkan-pipelines.js";
import { tapEntryPointNames, VulkanTap, type RecordedDraw } from "./vulkan-tap.js";

export const vulkan: GraphicsBackendFactory = {
    api: "Vulkan",
    libraries: vulkanLibraries.loader,
    activation: "after-loading",
    create: observer => new VulkanBackend(observer),
};

interface DeclaredInput {
    info: VertexInputInfo;
    origin: string;
}

interface Hooks {
    drivers: VulkanDriver[];
    tap: VulkanTap;
    pipelines: PipelineLayouts;
    contents: VulkanContents;
}

const topologies = new Map<number, Topology>([[0, "point-list"], [3, "triangle-list"], [4, "triangle-strip"], [5, "triangle-fan"]]);
const indexFormats = new Map<number, IndexFormat>([[0, "uint16"], [1, "uint32"], [1000265000, "uint8"]]);
const indexWidths: Record<IndexFormat, number> = { uint8: 1, uint16: 2, uint32: 4 };
const INDIRECT_SIZE = 16;
const INDEXED_INDIRECT_SIZE = 20;
const LARGEST_INDIRECT_DRAWS = 64;
const MEMORY_REQUIREMENTS = "vkGetBufferMemoryRequirements";

class VulkanBackend implements GraphicsBackend {
    readonly api = "Vulkan";
    readonly #observer: GeometryObserver;
    readonly #vertexInputs = new Map<string, VertexInputInfo>();
    #hooks: Hooks | null = null;

    constructor(observer: GeometryObserver) {
        this.#observer = observer;
        if (Process.pointerSize !== 8) {
            throw new Error("Vulkan is only followed in 64-bit processes");
        }
        this.#hooks = this.#start();
    }

    watchDraws(): void {
        this.#hooks?.tap.observeDraws("observed");
    }

    unwatchDraws(): void {
        this.#hooks?.tap.observeDraws("ignored");
    }

    async findBuffers(): Promise<BufferSearch> {
        const hooks = this.#hooks;
        if (hooks === null) {
            return { buffers: 0, detail: "no Vulkan driver could be reached" };
        }
        const tracked = hooks.contents.readableBuffers();
        const mapped = hooks.contents.mappedDeviceMemory();
        this.#observer.observeBuffers([...tracked, ...mapped]);
        const drivers = hooks.drivers.map(driver => driver.name).join(", ");
        return {
            buffers: tracked.length + mapped.length,
            detail: `${tracked.length} buffers whose contents were seen and ${mapped.length} ranges of device memory mapped before, `
                + `through ${drivers}`,
        };
    }

    dispose(): void {
        if (this.#hooks !== null) {
            this.#hooks.pipelines.dispose();
            this.#hooks.tap.dispose();
            this.#hooks.contents.dispose();
            this.#hooks = null;
        }
    }

    #start(): Hooks | null {
        const drivers = findVulkanDrivers([...tapEntryPointNames, ...pipelineEntryPointNames, MEMORY_REQUIREMENTS]);
        if (drivers.length === 0) {
            return null;
        }
        let tap: VulkanTap | null = null;
        const contents = new VulkanContents(() => tap!, drivers, buffers => this.#observer.observeBuffers(buffers));
        const pipelines = new PipelineLayouts(drivers, (pipeline, description) => this.#learned(pipeline, description));
        tap = new VulkanTap(drivers, {
            newDraw: draw => this.#onDraw(draw),
            vertexInput: (id, bindings, bindingCount, attributes, attributeCount) =>
                this.#vertexInputs.set(id.toString(), dynamicVertexInputOf(bindings, bindingCount, attributes, attributeCount)),
            copied: (source, destination, sourceOffset, destinationOffset, size) =>
                contents.copied(source, destination, sourceOffset, destinationOffset, size),
            updated: (destination, offset, size, data) => contents.updated(destination, offset, size, data),
            unmapping: (memory, mapped, offset, size) => contents.unmapping(memory, mapped, offset, size),
            named: (buffer, name) => contents.named(buffer, name),
            forgotten: (kind, handle) => contents.forgotten(kind, handle),
        });
        return { drivers, tap, pipelines, contents };
    }

    #learned(pipeline: UInt64, description: PipelineDescription): void {
        const input = description.vertexInput;
        const position = (input !== null && input !== "dynamic")
            ? positionLayoutOf(input, description.names, "pipeline vertex input")
            : null;
        this.#hooks?.tap.renewPipeline(pipeline, position?.slot ?? null);
    }

    #onDraw(draw: RecordedDraw): void {
        if (this.#hooks === null) {
            return;
        }
        for (const call of this.#drawCallsOf(draw, this.#hooks)) {
            this.#observer.observeDraw(call);
        }
    }

    #drawCallsOf(draw: RecordedDraw, hooks: Hooks): DrawCall[] {
        const description = hooks.pipelines.describe(draw.pipeline);
        const topology = topologyOf(draw, description);
        const indexed = draw.elements === "indexed";
        const indexFormat = indexed ? indexFormats.get(draw.indexType) : undefined;
        if (topology === null || (indexed && indexFormat === undefined)) {
            return [];
        }
        const input = this.#declaredInputOf(draw, description);
        const position = (input !== null) ? positionLayoutOf(input.info, description?.names ?? null, input.origin) : null;
        const streams: VertexStream[] = draw.bindings.map(binding => ({
            slot: binding.index,
            buffer: hooks.contents.bufferOf(binding.buffer, draw.commandBuffer),
            offset: binding.offset,
            stride: binding.stride ?? ((description?.strides === "dynamic")
                ? null
                : input?.info.bindings.find(declared => declared.binding === binding.index)?.stride ?? null),
        }));
        const tap = hooks.tap;
        const call: DrawCall = {
            api: this.api,
            topology,
            streams,
            bystanders: [],
            position,
            texcoord: null,
            textures: [],
            indices: null,
            firstVertex: 0,
            vertexCount: 0,
            baseVertex: 0,
            noteSlotGuess(slot) {
                if (position === null) {
                    tap.narrowPipeline(draw.pipeline, 1 << slot);
                }
            },
        };
        const indexBuffer = (indexFormat !== undefined) ? hooks.contents.bufferOf(draw.indexBuffer, draw.commandBuffer) : null;
        const withIndices = (count: number, first: number, vertexOffset: number): DrawCall => ({
            ...call,
            indices: { buffer: indexBuffer!, offset: draw.indexOffset + first * indexWidths[indexFormat!], format: indexFormat!, count },
            baseVertex: vertexOffset,
        });
        const direct = (count: number, first: number): DrawCall => ({ ...call, firstVertex: first, vertexCount: count });

        if (draw.indirectBuffer.equals(0)) {
            return [indexed ? withIndices(draw.count, draw.first, draw.vertexOffset) : direct(draw.count, draw.first)];
        }
        const argumentsBuffer = hooks.contents.bufferOf(draw.indirectBuffer, draw.commandBuffer);
        if (argumentsBuffer.access !== "cpu-readable") {
            return [];
        }
        const size = indexed ? INDEXED_INDIRECT_SIZE : INDIRECT_SIZE;
        const stride = (draw.indirectStride !== 0) ? draw.indirectStride : size;
        const calls: DrawCall[] = [];
        for (let i = 0; i !== Math.min(draw.drawCount, LARGEST_INDIRECT_DRAWS); i++) {
            let args: DataView;
            try {
                args = new DataView(argumentsBuffer.read(draw.indirectOffset + i * stride, size));
            } catch {
                break;
            }
            if (args.getUint32(4, true) === 0) {
                continue;
            }
            calls.push(indexed
                ? withIndices(args.getUint32(0, true), args.getUint32(8, true), args.getInt32(12, true))
                : direct(args.getUint32(0, true), args.getUint32(8, true)));
        }
        return calls;
    }

    #declaredInputOf(draw: RecordedDraw, description: PipelineDescription | undefined): DeclaredInput | null {
        const dynamic = (description === undefined) ? draw.latestVertexInput === "command" : description.vertexInput === "dynamic";
        if (dynamic) {
            const info = (draw.vertexInput !== null) ? this.#vertexInputs.get(draw.vertexInput.toString()) : undefined;
            return (info !== undefined) ? { info, origin: "vkCmdSetVertexInputEXT" } : null;
        }
        const declared = description?.vertexInput;
        return (declared !== undefined && declared !== null && declared !== "dynamic")
            ? { info: declared, origin: "pipeline vertex input" }
            : null;
    }
}

function topologyOf(draw: RecordedDraw, description: PipelineDescription | undefined): Topology | null {
    if (draw.topology !== null) {
        return topologies.get(draw.topology) ?? null;
    }
    if (typeof description?.topology === "number") {
        return topologies.get(description.topology) ?? null;
    }
    return (draw.elements === "vertices" && draw.indirectBuffer.equals(0) && draw.count % 3 !== 0) ? "triangle-strip" : "triangle-list";
}
