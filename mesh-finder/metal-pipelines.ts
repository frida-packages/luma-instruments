import type { PositionLayout } from "./graphics-backend.js";
import { implementationOf, objcSend, selector, stringFrom } from "./objc.js";
import { positionFormat, type ComponentType, type PositionFormat } from "./vertex-format.js";

export type PipelineLayout = PositionLayout | "no-vertex-descriptor";

interface DescribedAttribute {
    index: number;
    format: PositionFormat;
    offset: number;
    bufferIndex: number;
}

const ATTRIBUTE_COUNT = 31;
const PER_VERTEX = 1;
const positionNames = /pos/i;

const metalFormats = new Map<number, [ComponentType, number]>([
    [7, ["unorm8", 2]], [8, ["unorm8", 3]], [9, ["unorm8", 4]],
    [10, ["snorm8", 2]], [11, ["snorm8", 3]], [12, ["snorm8", 4]],
    [13, ["uint16", 2]], [14, ["uint16", 3]], [15, ["uint16", 4]],
    [16, ["sint16", 2]], [17, ["sint16", 3]], [18, ["sint16", 4]],
    [19, ["unorm16", 2]], [20, ["unorm16", 3]], [21, ["unorm16", 4]],
    [22, ["snorm16", 2]], [23, ["snorm16", 3]], [24, ["snorm16", 4]],
    [25, ["float16", 2]], [26, ["float16", 3]], [27, ["float16", 4]],
    [29, ["float32", 2]], [30, ["float32", 3]], [31, ["float32", 4]],
]);

let selectorTable: ReturnType<typeof selectorsByName> | null = null;

export class PipelineWatch {
    readonly #layouts = new Map<string, PipelineLayout>();
    readonly #listeners: InvocationListener[] = [];

    constructor(pipelineClasses: NativePointer[], learned: (pipeline: NativePointer, layout: PipelineLayout) => void) {
        const watch = this;
        const hooked = new Set<string>();
        for (const cls of pipelineClasses) {
            const implementation = implementationOf(cls, "initWithDevice:pipelineStateDescriptor:");
            if (implementation === null || hooked.has(implementation.toString())) {
                continue;
            }
            hooked.add(implementation.toString());
            this.#listeners.push(Interceptor.attach(implementation, {
                onEnter(args) {
                    this.layout = layoutOfDescriptor(args[3]);
                },
                onLeave(pipeline) {
                    if (!pipeline.isNull()) {
                        watch.#layouts.set(pipeline.toString(), this.layout);
                        learned(pipeline, this.layout);
                    }
                },
            }));
        }
    }

    layoutOf(pipeline: NativePointer): PipelineLayout | undefined {
        return this.#layouts.get(pipeline.toString());
    }

    dispose(): void {
        for (const listener of this.#listeners) {
            listener.detach();
        }
    }
}

function layoutOfDescriptor(descriptor: NativePointer): PipelineLayout {
    const vertexDescriptor = objcSend.pointer(descriptor, selectors().vertexDescriptor);
    if (vertexDescriptor.isNull()) {
        return "no-vertex-descriptor";
    }
    const attributes = describedAttributes(vertexDescriptor);
    if (attributes.length === 0) {
        return "no-vertex-descriptor";
    }
    const names = attributeNames(objcSend.pointer(descriptor, selectors().vertexFunction));
    const named = attributes.find(attribute => positionNames.test(names.get(attribute.index) ?? ""));
    const position = named ?? attributes.find(attribute => attribute.index === 0)
        ?? attributes.find(attribute => attribute.format.count >= 3) ?? attributes[0];
    const layout = objcSend.pointerAtIndex(objcSend.pointer(vertexDescriptor, selectors().layouts), selectors().objectAtIndexedSubscript,
        position.bufferIndex);
    if (objcSend.uint64(layout, selectors().stepFunction).toNumber() !== PER_VERTEX) {
        return "no-vertex-descriptor";
    }
    const name = names.get(position.index);
    return {
        slot: position.bufferIndex,
        stride: objcSend.uint64(layout, selectors().stride).toNumber(),
        offset: position.offset,
        format: position.format,
        source: `MTLVertexDescriptor attribute ${position.index}${(name !== undefined) ? ` "${name}"` : ""}`,
    };
}

function describedAttributes(vertexDescriptor: NativePointer): DescribedAttribute[] {
    const attributes = objcSend.pointer(vertexDescriptor, selectors().attributes);
    const described: DescribedAttribute[] = [];
    for (let index = 0; index !== ATTRIBUTE_COUNT; index++) {
        const attribute = objcSend.pointerAtIndex(attributes, selectors().objectAtIndexedSubscript, index);
        const known = metalFormats.get(objcSend.uint64(attribute, selectors().format).toNumber());
        if (known === undefined) {
            continue;
        }
        described.push({
            index,
            format: positionFormat(known[0], known[1])!,
            offset: objcSend.uint64(attribute, selectors().offset).toNumber(),
            bufferIndex: objcSend.uint64(attribute, selectors().bufferIndex).toNumber(),
        });
    }
    return described;
}

function attributeNames(vertexFunction: NativePointer): Map<number, string> {
    const names = new Map<number, string>();
    if (vertexFunction.isNull()) {
        return names;
    }
    const attributes = objcSend.pointer(vertexFunction, selectors().vertexAttributes);
    if (attributes.isNull()) {
        return names;
    }
    const count = objcSend.uint64(attributes, selectors().count).toNumber();
    for (let i = 0; i !== count; i++) {
        const attribute = objcSend.pointerAtIndex(attributes, selectors().objectAtIndex, i);
        const name = stringFrom(objcSend.pointer(attribute, selectors().name));
        if (name !== null) {
            names.set(objcSend.uint64(attribute, selectors().attributeIndex).toNumber(), name);
        }
    }
    return names;
}

function selectors() {
    selectorTable ??= selectorsByName();
    return selectorTable;
}

function selectorsByName() {
    return {
        vertexDescriptor: selector("vertexDescriptor"),
        vertexFunction: selector("vertexFunction"),
        vertexAttributes: selector("vertexAttributes"),
        attributes: selector("attributes"),
        layouts: selector("layouts"),
        objectAtIndexedSubscript: selector("objectAtIndexedSubscript:"),
        objectAtIndex: selector("objectAtIndex:"),
        count: selector("count"),
        format: selector("format"),
        offset: selector("offset"),
        bufferIndex: selector("bufferIndex"),
        stride: selector("stride"),
        stepFunction: selector("stepFunction"),
        name: selector("name"),
        attributeIndex: selector("attributeIndex"),
    };
}
