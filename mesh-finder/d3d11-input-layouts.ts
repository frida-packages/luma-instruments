import { InputElementDesc } from "./d3d11-descriptions.pat";
import { attributeFormat, type ComponentType, type AttributeFormat } from "./vertex-format.js";

export interface DeclaredAttributes {
    position: DeclaredAttribute | null;
    texcoord: DeclaredAttribute | null;
}

export interface DeclaredAttribute {
    slot: number;
    offset: number;
    format: AttributeFormat;
    source: string;
}

interface InputElement {
    semantic: string;
    semanticIndex: number;
    format: number;
    slot: number;
    alignedOffset: number;
    perVertex: boolean;
}

interface PlacedElement {
    element: InputElement;
    offset: number | null;
}

const APPEND_ALIGNED_ELEMENT = 0xffffffff;
const PER_VERTEX_DATA = 0;
const positionSemantics = /pos/i;
const texcoordSemantic = /^texcoord$/i;

const formatSizes = new Map<number, number>([
    ...range(1, 4, 16), ...range(5, 8, 12), ...range(9, 22, 8), ...range(23, 47, 4), ...range(48, 52, 2), ...range(53, 59, 2),
    ...range(60, 64, 1), ...range(87, 88, 4),
]);

const attributeFormats = new Map<number, [ComponentType, number]>([
    [2, ["float32", 4]], [6, ["float32", 3]], [16, ["float32", 2]],
    [10, ["float16", 4]], [11, ["unorm16", 4]], [12, ["uint16", 4]], [13, ["snorm16", 4]], [14, ["sint16", 4]],
    [34, ["float16", 2]], [35, ["unorm16", 2]], [36, ["uint16", 2]], [37, ["snorm16", 2]], [38, ["sint16", 2]],
    [28, ["unorm8", 4]], [31, ["snorm8", 4]], [49, ["unorm8", 2]], [51, ["snorm8", 2]],
]);

export class InputLayouts {
    readonly #attributes = new Map<string, DeclaredAttributes>();

    learn(layout: NativePointer, elements: NativePointer, count: number): DeclaredAttributes {
        const attributes = declaredAttributes(readElements(elements, count));
        this.#attributes.set(layout.toString(), attributes);
        return attributes;
    }

    attributesOf(layout: NativePointer): DeclaredAttributes | undefined {
        return this.#attributes.get(layout.toString());
    }
}

function readElements(elements: NativePointer, count: number): InputElement[] {
    return Array.from({ length: count }, (_, i) => {
        const element = InputElementDesc.at(elements.add(i * InputElementDesc.size));
        return {
            semantic: element.semanticName.readCString()!,
            semanticIndex: element.semanticIndex,
            format: element.format,
            slot: element.inputSlot,
            alignedOffset: element.alignedByteOffset,
            perVertex: element.inputSlotClass === PER_VERTEX_DATA,
        };
    });
}

function declaredAttributes(elements: InputElement[]): DeclaredAttributes {
    const offsets = resolvedOffsets(elements);
    const usable = elements
        .map((element, i) => ({ element, offset: offsets[i] }))
        .filter(({ element, offset }) => element.perVertex && offset !== null && attributeFormats.has(element.format));
    const positions = usable.filter(({ element }) => positionSemantics.test(element.semantic));
    const position = positions.find(({ element }) => element.semanticIndex === 0) ?? positions[0];
    const texcoord = usable.find(({ element }) => texcoordSemantic.test(element.semantic) && element.semanticIndex === 0);
    return { position: declaredAttribute(position), texcoord: declaredAttribute(texcoord) };
}

function declaredAttribute(chosen: PlacedElement | undefined): DeclaredAttribute | null {
    if (chosen === undefined) {
        return null;
    }
    const [component, count] = attributeFormats.get(chosen.element.format)!;
    const { semantic, semanticIndex, slot } = chosen.element;
    return {
        slot,
        offset: chosen.offset!,
        format: attributeFormat(component, count)!,
        source: `input layout element ${semantic}${(semanticIndex !== 0) ? semanticIndex : ""}`,
    };
}

function resolvedOffsets(elements: InputElement[]): (number | null)[] {
    const ends = new Map<number, number | null>();
    return elements.map(element => {
        const end = ends.has(element.slot) ? ends.get(element.slot)! : 0;
        const offset = (element.alignedOffset !== APPEND_ALIGNED_ELEMENT) ? element.alignedOffset : end;
        const size = formatSizes.get(element.format);
        ends.set(element.slot, (offset !== null && size !== undefined) ? offset + size : null);
        return offset;
    });
}

function range(first: number, last: number, size: number): [number, number][] {
    return Array.from({ length: last - first + 1 }, (_, i) => [first + i, size]);
}
