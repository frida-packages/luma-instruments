import type { PositionLayout } from "./graphics-backend.js";
import { positionAttribute } from "./position-attribute.js";
import { vertexInputNames, type InputNames, type VertexInputNames } from "./spirv-inputs.js";
import { positionFormat, type ComponentType, type PositionFormat } from "./vertex-format.js";
import type { VulkanDriver } from "./vulkan-driver.js";

export interface VertexBindingInfo {
    binding: number;
    stride: number;
    rate: InputRate;
}

export interface VertexAttributeInfo {
    location: number;
    binding: number;
    format: PositionFormat | null;
    offset: number;
}

export interface VertexInputInfo {
    bindings: VertexBindingInfo[];
    attributes: VertexAttributeInfo[];
}

export interface PipelineDescription {
    topology: number | "dynamic" | null;
    vertexInput: VertexInputInfo | "dynamic" | null;
    strides: Strides;
    names: InputNames | null;
}

export type InputRate = "per-vertex" | "per-instance";

export type Strides = "declared" | "dynamic";

export const pipelineEntryPointNames = ["vkCreateGraphicsPipelines", "vkCreateShaderModule", "vkDestroyShaderModule"];

const VERTEX_STAGE = 1;
const PER_VERTEX = 0;
const SHADER_MODULE_CREATE_INFO = 16;
const PIPELINE_LIBRARY_CREATE_INFO = 1000290000;
const DYNAMIC_PRIMITIVE_TOPOLOGY = 1000267000;
const DYNAMIC_VERTEX_INPUT_BINDING_STRIDE = 1000267005;
const DYNAMIC_VERTEX_INPUT = 1000352000;
const LARGEST_PARSED_SHADER = 16 * 1048576;
const GRAPHICS_PIPELINE_INFO_SIZE = 144;
const STAGE_INFO_SIZE = 48;

const vulkanFormats = new Map<number, [ComponentType, number]>([
    [16, ["unorm8", 2]], [17, ["snorm8", 2]], [23, ["unorm8", 3]], [24, ["snorm8", 3]], [37, ["unorm8", 4]], [38, ["snorm8", 4]],
    [77, ["unorm16", 2]], [78, ["snorm16", 2]], [79, ["uint16", 2]], [80, ["sint16", 2]], [81, ["uint16", 2]], [82, ["sint16", 2]],
    [83, ["float16", 2]],
    [84, ["unorm16", 3]], [85, ["snorm16", 3]], [86, ["uint16", 3]], [87, ["sint16", 3]], [88, ["uint16", 3]], [89, ["sint16", 3]],
    [90, ["float16", 3]],
    [91, ["unorm16", 4]], [92, ["snorm16", 4]], [93, ["uint16", 4]], [94, ["sint16", 4]], [95, ["uint16", 4]], [96, ["sint16", 4]],
    [97, ["float16", 4]],
    [103, ["float32", 2]], [106, ["float32", 3]], [109, ["float32", 4]],
]);

export class PipelineLayouts {
    private readonly pipelines = new Map<string, PipelineDescription>();
    private readonly modules = new Map<string, VertexInputNames>();
    private readonly listeners: InvocationListener[] = [];

    constructor(drivers: VulkanDriver[], learned: (pipeline: UInt64, description: PipelineDescription) => void) {
        const layouts = this;
        const hooked = new Set<string>();
        const hook = (target: NativePointer | undefined, callbacks: InvocationListenerCallbacks) => {
            if (target !== undefined && !hooked.has(target.toString())) {
                hooked.add(target.toString());
                this.listeners.push(Interceptor.attach(target, callbacks));
            }
        };
        for (const driver of drivers) {
            hook(driver.entryPoints.get("vkCreateGraphicsPipelines"), {
                onEnter(args) {
                    const count = args[2].toUInt32();
                    this.descriptions = Array.from({ length: count },
                        (_, i) => layouts.describeCreateInfo(args[3].add(i * GRAPHICS_PIPELINE_INFO_SIZE)));
                    this.pipelines = args[5];
                },
                onLeave() {
                    (this.descriptions as PipelineDescription[]).forEach((description, i) => {
                        const pipeline = (this.pipelines as NativePointer).add(i * 8).readU64();
                        if (!pipeline.equals(0)) {
                            layouts.pipelines.set(pipeline.toString(), description);
                            learned(pipeline, description);
                        }
                    });
                },
            });
            hook(driver.entryPoints.get("vkCreateShaderModule"), {
                onEnter(args) {
                    this.names = namesOfModuleInfo(args[1]);
                    this.module = args[3];
                },
                onLeave(result) {
                    if (result.toInt32() === 0 && this.names.size !== 0) {
                        layouts.modules.set((this.module as NativePointer).readPointer().toString(), this.names);
                    }
                },
            });
            hook(driver.entryPoints.get("vkDestroyShaderModule"), {
                onEnter(args) {
                    layouts.modules.delete(args[1].toString());
                },
            });
        }
    }

    describe(pipeline: UInt64): PipelineDescription | undefined {
        return this.pipelines.get(pipeline.toString());
    }

    dispose(): void {
        for (const listener of this.listeners) {
            listener.detach();
        }
    }

    private describeCreateInfo(info: NativePointer): PipelineDescription {
        const dynamicStates = dynamicStatesOf(info.add(96).readPointer());
        const vertexInputState = info.add(32).readPointer();
        const assembly = info.add(40).readPointer();
        const own: PipelineDescription = {
            topology: dynamicStates.has(DYNAMIC_PRIMITIVE_TOPOLOGY) ? "dynamic" : (assembly.isNull() ? null : assembly.add(20).readU32()),
            vertexInput: dynamicStates.has(DYNAMIC_VERTEX_INPUT) ? "dynamic" : (vertexInputState.isNull() ? null
                : vertexInputOf(vertexInputState)),
            strides: dynamicStates.has(DYNAMIC_VERTEX_INPUT_BINDING_STRIDE) ? "dynamic" : "declared",
            names: this.vertexNamesOf(info.add(24).readPointer(), info.add(20).readU32()),
        };
        return librariesOf(info).reduce((merged, library) => {
            const linked = this.pipelines.get(library.toString());
            return (linked === undefined) ? merged : {
                topology: merged.topology ?? linked.topology,
                vertexInput: merged.vertexInput ?? linked.vertexInput,
                strides: (merged.strides === "dynamic" || linked.strides === "dynamic") ? "dynamic" : "declared",
                names: merged.names ?? linked.names,
            };
        }, own);
    }

    private vertexNamesOf(stages: NativePointer, count: number): InputNames | null {
        for (let i = 0; i !== count; i++) {
            const stage = stages.add(i * STAGE_INFO_SIZE);
            if (stage.add(20).readU32() !== VERTEX_STAGE) {
                continue;
            }
            const entry = stage.add(32).readPointer().readUtf8String()!;
            const module = stage.add(24).readPointer();
            const names = module.isNull() ? inlineModuleNames(stage) : this.modules.get(module.toString());
            return names?.get(entry) ?? null;
        }
        return null;
    }
}

export function dynamicVertexInputOf(bindings: NativePointer, bindingCount: number, attributes: NativePointer,
    attributeCount: number): VertexInputInfo {
    return {
        bindings: Array.from({ length: bindingCount }, (_, i) => {
            const binding = bindings.add(i * 32);
            return {
                binding: binding.add(16).readU32(),
                stride: binding.add(20).readU32(),
                rate: rateOf(binding.add(24).readU32()),
            };
        }),
        attributes: Array.from({ length: attributeCount }, (_, i) => {
            const attribute = attributes.add(i * 32);
            return {
                location: attribute.add(16).readU32(),
                binding: attribute.add(20).readU32(),
                format: formatOf(attribute.add(24).readU32()),
                offset: attribute.add(28).readU32(),
            };
        }),
    };
}

export function positionLayoutOf(input: VertexInputInfo, names: InputNames | null, origin: string): PositionLayout | null {
    const perVertex = input.attributes.filter(attribute =>
        input.bindings.find(binding => binding.binding === attribute.binding)?.rate === "per-vertex");
    const chosen = positionAttribute(perVertex, names ?? new Map());
    if (chosen === undefined) {
        return null;
    }
    const name = names?.get(chosen.location);
    return {
        slot: chosen.binding,
        stride: input.bindings.find(binding => binding.binding === chosen.binding)!.stride,
        offset: chosen.offset,
        format: chosen.format!,
        source: `${origin} location ${chosen.location}${(name !== undefined) ? ` "${name}"` : ""}`,
    };
}

function dynamicStatesOf(state: NativePointer): Set<number> {
    if (state.isNull()) {
        return new Set();
    }
    const count = state.add(20).readU32();
    const states = state.add(24).readPointer();
    return new Set(Array.from({ length: count }, (_, i) => states.add(i * 4).readU32()));
}

function vertexInputOf(state: NativePointer): VertexInputInfo {
    const bindingCount = state.add(20).readU32();
    const bindings = state.add(24).readPointer();
    const attributeCount = state.add(32).readU32();
    const attributes = state.add(40).readPointer();
    return {
        bindings: Array.from({ length: bindingCount }, (_, i) => {
            const binding = bindings.add(i * 12);
            return { binding: binding.readU32(), stride: binding.add(4).readU32(), rate: rateOf(binding.add(8).readU32()) };
        }),
        attributes: Array.from({ length: attributeCount }, (_, i) => {
            const attribute = attributes.add(i * 16);
            return {
                location: attribute.readU32(),
                binding: attribute.add(4).readU32(),
                format: formatOf(attribute.add(8).readU32()),
                offset: attribute.add(12).readU32(),
            };
        }),
    };
}

function librariesOf(info: NativePointer): UInt64[] {
    for (let next = info.add(8).readPointer(); !next.isNull(); next = next.add(8).readPointer()) {
        if (next.readU32() === PIPELINE_LIBRARY_CREATE_INFO) {
            const libraries = next.add(24).readPointer();
            return Array.from({ length: next.add(16).readU32() }, (_, i) => libraries.add(i * 8).readU64());
        }
    }
    return [];
}

function inlineModuleNames(stage: NativePointer): VertexInputNames | undefined {
    for (let next = stage.add(8).readPointer(); !next.isNull(); next = next.add(8).readPointer()) {
        if (next.readU32() === SHADER_MODULE_CREATE_INFO) {
            return namesOfModuleInfo(next);
        }
    }
    return undefined;
}

function namesOfModuleInfo(info: NativePointer): VertexInputNames {
    const size = info.add(24).readU64().toNumber();
    return (size <= LARGEST_PARSED_SHADER) ? vertexInputNames(info.add(32).readPointer().readByteArray(size)!) : new Map();
}

function rateOf(rate: number): InputRate {
    return (rate === PER_VERTEX) ? "per-vertex" : "per-instance";
}

function formatOf(format: number): PositionFormat | null {
    const known = vulkanFormats.get(format);
    return (known !== undefined) ? positionFormat(known[0], known[1]) : null;
}
