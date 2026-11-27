import type { AttributeLayout } from "./graphics-backend.js";
import { positionAttribute, texcoordAttribute } from "./vertex-attributes.js";
import { shaderInterfaces, type InputNames, type SampledImage, type ShaderInterfaces } from "./spirv-inputs.js";
import { attributeFormat, type ComponentType, type AttributeFormat } from "./vertex-format.js";
import type { VulkanDriver } from "./vulkan-driver.js";
import {
    BaseInStructure,
    GraphicsPipelineCreateInfo,
    PipelineDynamicStateCreateInfo,
    PipelineLibraryCreateInfo,
    PipelineShaderStageCreateInfo,
    PipelineVertexInputStateCreateInfo,
    ShaderModuleCreateInfo,
} from "./vulkan-pipeline-info.pat";
import {
    VertexInputAttributeDescription,
    VertexInputAttributeDescription2,
    VertexInputBindingDescription,
    VertexInputBindingDescription2,
} from "./vulkan-vertex-input.pat";

export interface VertexBindingInfo {
    binding: number;
    stride: number;
    rate: InputRate;
}

export interface VertexAttributeInfo {
    location: number;
    binding: number;
    format: AttributeFormat | null;
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
    sampledImages: SampledImage[] | null;
}

export type InputRate = "per-vertex" | "per-instance";

export type Strides = "declared" | "dynamic";

export const pipelineEntryPointNames = ["vkCreateGraphicsPipelines", "vkCreateShaderModule", "vkDestroyShaderModule"];

const VERTEX_STAGE = 1;
const FRAGMENT_STAGE = 0x10;
const PER_VERTEX = 0;
const SHADER_MODULE_CREATE_INFO = 16;
const PIPELINE_LIBRARY_CREATE_INFO = 1000290000;
const DYNAMIC_PRIMITIVE_TOPOLOGY = 1000267000;
const DYNAMIC_VERTEX_INPUT_BINDING_STRIDE = 1000267005;
const DYNAMIC_VERTEX_INPUT = 1000352000;
const LARGEST_PARSED_SHADER = 16 * 1048576;

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
    readonly #pipelines = new Map<string, PipelineDescription>();
    readonly #modules = new Map<string, ShaderInterfaces>();
    readonly #listeners: InvocationListener[] = [];

    constructor(drivers: VulkanDriver[], learned: (pipeline: UInt64, description: PipelineDescription) => void) {
        const layouts = this;
        const hooked = new Set<string>();
        const hook = (target: NativePointer | undefined, callbacks: InvocationListenerCallbacks) => {
            if (target !== undefined && !hooked.has(target.toString())) {
                hooked.add(target.toString());
                this.#listeners.push(Interceptor.attach(target, callbacks));
            }
        };
        for (const driver of drivers) {
            hook(driver.entryPoints.get("vkCreateGraphicsPipelines"), {
                onEnter(args) {
                    const count = args[2].toUInt32();
                    const infos = args[3];
                    this.descriptions = Array.from({ length: count },
                        (_, i) => layouts.#describeCreateInfo(GraphicsPipelineCreateInfo.at(infos.add(i * GraphicsPipelineCreateInfo.size))));
                    this.pipelines = args[5];
                },
                onLeave() {
                    (this.descriptions as PipelineDescription[]).forEach((description, i) => {
                        const pipeline = (this.pipelines as NativePointer).add(i * 8).readU64();
                        if (!pipeline.equals(0)) {
                            layouts.#pipelines.set(pipeline.toString(), description);
                            learned(pipeline, description);
                        }
                    });
                },
            });
            hook(driver.entryPoints.get("vkCreateShaderModule"), {
                onEnter(args) {
                    this.interfaces = interfacesOfModuleInfo(ShaderModuleCreateInfo.at(args[1]));
                    this.module = args[3];
                },
                onLeave(result) {
                    const interfaces = this.interfaces as ShaderInterfaces;
                    if (result.toInt32() === 0 && (interfaces.vertexInputs.size !== 0 || interfaces.fragmentImages.size !== 0)) {
                        layouts.#modules.set((this.module as NativePointer).readPointer().toString(), interfaces);
                    }
                },
            });
            hook(driver.entryPoints.get("vkDestroyShaderModule"), {
                onEnter(args) {
                    layouts.#modules.delete(args[1].toString());
                },
            });
        }
    }

    describe(pipeline: UInt64): PipelineDescription | undefined {
        return this.#pipelines.get(pipeline.toString());
    }

    dispose(): void {
        for (const listener of this.#listeners) {
            listener.detach();
        }
    }

    #describeCreateInfo(info: GraphicsPipelineCreateInfo): PipelineDescription {
        const dynamicStates = dynamicStatesOf(info.dynamicState);
        const vertexInputState = info.vertexInputState;
        const assembly = info.inputAssemblyState;
        const own: PipelineDescription = {
            topology: dynamicStates.has(DYNAMIC_PRIMITIVE_TOPOLOGY) ? "dynamic" : (assembly?.topology ?? null),
            vertexInput: dynamicStates.has(DYNAMIC_VERTEX_INPUT) ? "dynamic" : (vertexInputState === null ? null
                : vertexInputOf(vertexInputState)),
            strides: dynamicStates.has(DYNAMIC_VERTEX_INPUT_BINDING_STRIDE) ? "dynamic" : "declared",
            names: this.#stageInterfaceOf(info, VERTEX_STAGE, interfaces => interfaces.vertexInputs),
            sampledImages: this.#stageInterfaceOf(info, FRAGMENT_STAGE, interfaces => interfaces.fragmentImages),
        };
        return librariesOf(info).reduce((merged, library) => {
            const linked = this.#pipelines.get(library.toString());
            return (linked === undefined) ? merged : {
                topology: merged.topology ?? linked.topology,
                vertexInput: merged.vertexInput ?? linked.vertexInput,
                strides: (merged.strides === "dynamic" || linked.strides === "dynamic") ? "dynamic" : "declared",
                names: merged.names ?? linked.names,
                sampledImages: merged.sampledImages ?? linked.sampledImages,
            };
        }, own);
    }

    #stageInterfaceOf<T>(info: GraphicsPipelineCreateInfo, stageBit: number, pick: (interfaces: ShaderInterfaces) => Map<string, T>):
        T | null {
        for (let i = 0; i !== info.stageCount; i++) {
            const stage = PipelineShaderStageCreateInfo.at(info.stages.add(i * PipelineShaderStageCreateInfo.size));
            if (stage.stage !== stageBit) {
                continue;
            }
            const entry = stage.name.readUtf8String()!;
            const module = stage.module;
            const interfaces = module.isNull() ? inlineModuleInterfaces(stage) : this.#modules.get(module.toString());
            return (interfaces !== undefined) ? pick(interfaces).get(entry) ?? null : null;
        }
        return null;
    }
}

export function dynamicVertexInputOf(bindings: NativePointer, bindingCount: number, attributes: NativePointer,
    attributeCount: number): VertexInputInfo {
    return {
        bindings: Array.from({ length: bindingCount }, (_, i) => {
            const binding = VertexInputBindingDescription2.at(bindings.add(i * VertexInputBindingDescription2.size));
            return { binding: binding.binding, stride: binding.stride, rate: rateOf(binding.inputRate) };
        }),
        attributes: Array.from({ length: attributeCount }, (_, i) => {
            const attribute = VertexInputAttributeDescription2.at(attributes.add(i * VertexInputAttributeDescription2.size));
            return {
                location: attribute.location,
                binding: attribute.binding,
                format: formatOf(attribute.format),
                offset: attribute.offset,
            };
        }),
    };
}

export function positionLayoutOf(input: VertexInputInfo, names: InputNames | null, origin: string): AttributeLayout | null {
    return layoutOf(input, names, origin, positionAttribute);
}

export function texcoordLayoutOf(input: VertexInputInfo, names: InputNames | null, origin: string): AttributeLayout | null {
    return layoutOf(input, names, origin, texcoordAttribute);
}

function dynamicStatesOf(state: PipelineDynamicStateCreateInfo | null): Set<number> {
    if (state === null) {
        return new Set();
    }
    const { dynamicStateCount, dynamicStates } = state;
    return new Set(Array.from({ length: dynamicStateCount }, (_, i) => dynamicStates.add(i * 4).readU32()));
}

function vertexInputOf(state: PipelineVertexInputStateCreateInfo): VertexInputInfo {
    const bindings = state.vertexBindingDescriptions;
    const attributes = state.vertexAttributeDescriptions;
    return {
        bindings: Array.from({ length: state.vertexBindingDescriptionCount }, (_, i) => {
            const binding = VertexInputBindingDescription.at(bindings.add(i * VertexInputBindingDescription.size));
            return { binding: binding.binding, stride: binding.stride, rate: rateOf(binding.inputRate) };
        }),
        attributes: Array.from({ length: state.vertexAttributeDescriptionCount }, (_, i) => {
            const attribute = VertexInputAttributeDescription.at(attributes.add(i * VertexInputAttributeDescription.size));
            return {
                location: attribute.location,
                binding: attribute.binding,
                format: formatOf(attribute.format),
                offset: attribute.offset,
            };
        }),
    };
}

function librariesOf(info: GraphicsPipelineCreateInfo): UInt64[] {
    const chained = chainedInfo(info.next, PIPELINE_LIBRARY_CREATE_INFO);
    if (chained === null) {
        return [];
    }
    const { libraryCount, libraries } = PipelineLibraryCreateInfo.at(chained);
    return Array.from({ length: libraryCount }, (_, i) => libraries.add(i * 8).readU64());
}

function inlineModuleInterfaces(stage: PipelineShaderStageCreateInfo): ShaderInterfaces | undefined {
    const chained = chainedInfo(stage.next, SHADER_MODULE_CREATE_INFO);
    return (chained !== null) ? interfacesOfModuleInfo(ShaderModuleCreateInfo.at(chained)) : undefined;
}

function chainedInfo(first: NativePointer, type: number): NativePointer | null {
    for (let next = first; !next.isNull(); next = BaseInStructure.at(next).next) {
        if (BaseInStructure.at(next).sType === type) {
            return next;
        }
    }
    return null;
}

function interfacesOfModuleInfo(info: ShaderModuleCreateInfo): ShaderInterfaces {
    const size = info.codeSize.toNumber();
    return (size <= LARGEST_PARSED_SHADER)
        ? shaderInterfaces(info.code.readByteArray(size)!)
        : { vertexInputs: new Map(), fragmentImages: new Map() };
}

function rateOf(rate: number): InputRate {
    return (rate === PER_VERTEX) ? "per-vertex" : "per-instance";
}

function formatOf(format: number): AttributeFormat | null {
    const known = vulkanFormats.get(format);
    return (known !== undefined) ? attributeFormat(known[0], known[1]) : null;
}

function layoutOf(input: VertexInputInfo, names: InputNames | null, origin: string,
    choose: (attributes: VertexAttributeInfo[], names: InputNames) => VertexAttributeInfo | undefined): AttributeLayout | null {
    const perVertex = input.attributes.filter(attribute =>
        input.bindings.find(binding => binding.binding === attribute.binding)?.rate === "per-vertex");
    const chosen = choose(perVertex, names ?? new Map());
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
