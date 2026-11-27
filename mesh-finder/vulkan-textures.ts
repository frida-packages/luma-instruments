import type { BufferAccess, GpuTexture, TextureBinding } from "./graphics-backend.js";
import type { SampledImage } from "./spirv-inputs.js";
import type { TextureFormat } from "./texture-format.js";
import type { MemoryShadow, VulkanContents } from "./vulkan-buffers.js";
import type { VulkanDriver } from "./vulkan-driver.js";
import { vulkanFormatName, vulkanTextureFormats, type VulkanTextureFormat } from "./vulkan-formats.js";
import { SubresourceLayout } from "./vulkan-subresource-layout.pat";
import type { ImageFacts, RecordedDraw, RecordedImageCopy, VulkanTap } from "./vulkan-tap.js";

interface ImageShadow {
    bytes: Uint8Array;
    generation: number;
}

interface TextureDescription {
    id: string;
    address: string;
    label: string | null;
    width: number;
    height: number;
    format: number;
    access: BufferAccess;
    texels: Texels | null;
}

interface LinearLayout {
    offset: number;
    rowPitch: number;
}

type Texels = () => ArrayBuffer;

type SubresourceLayoutQuery = NativeFunction<void, [NativePointerValue, number | UInt64, NativePointerValue, NativePointerValue]>;

export const SUBRESOURCE_LAYOUT = "vkGetImageSubresourceLayout";

const LARGEST_SHADOW = 64 * 1048576;
const SHADOW_BUDGET = 256 * 1048576;
const SET_BINDING_COUNT = 32;
const COLOR_ASPECT = 1;
const IMAGE_SUBRESOURCE_SIZE = 12;
const MIP_LEVEL_OFFSET = 4;
const ARRAY_LAYER_OFFSET = 8;
const UNDEFINED_FORMAT = 0;

export class VulkanTextures {
    readonly #tap: () => VulkanTap;
    readonly #contents: VulkanContents;
    readonly #shadows = new Map<string, ImageShadow>();
    readonly #labels = new Map<string, string>();
    readonly #subresourceLayouts: Map<number, SubresourceLayoutQuery>;
    readonly #subresource = colorSubresource();
    readonly #layout = SubresourceLayout.at(Memory.alloc(SubresourceLayout.size));
    #shadowBytes = 0;

    constructor(tap: () => VulkanTap, drivers: VulkanDriver[], contents: VulkanContents) {
        this.#tap = tap;
        this.#contents = contents;
        this.#subresourceLayouts = new Map(drivers.flatMap(driver => {
            const entry = driver.entryPoints.get(SUBRESOURCE_LAYOUT);
            return (entry !== undefined)
                ? [[driver.index, new NativeFunction(entry, "void", ["pointer", "uint64", "pointer", "pointer"])]]
                : [];
        }));
    }

    bindingsOf(draw: RecordedDraw, images: SampledImage[] | null): TextureBinding[] {
        const tap = this.#tap();
        const sets = new Map(draw.descriptorSets.map(bound => [bound.index, { set: bound.set, views: tap.describeDescriptorSet(bound.set) }]));
        return (images ?? []).flatMap(image => {
            const bound = sets.get(image.set);
            if (bound === undefined || image.binding >= SET_BINDING_COUNT) {
                return [];
            }
            const view = bound.views?.[image.binding];
            const texture = (view !== undefined && !view.equals(0))
                ? this.#textureOfView(view, draw.commandBuffer)
                : unseenDescriptor(bound.set, image.binding);
            return [{ slot: image.set * SET_BINDING_COUNT + image.binding, name: image.name, texture }];
        }).sort((a, b) => a.slot - b.slot);
    }

    imageCopied(copy: RecordedImageCopy): void {
        const facts = this.#tap().describeImage(copy.image);
        const layout = (facts !== null) ? vulkanTextureFormats.get(facts.format) : undefined;
        const source = this.#contents.bufferOf(copy.source, null);
        if (facts === null || facts.order === 0 || layout === undefined || source.access !== "cpu-readable") {
            return;
        }
        const shadow = this.#shadowOf(copy.image, facts, layout);
        if (shadow === null) {
            return;
        }
        const rowBytes = blocksAcross(facts.width, layout) * layout.blockBytes;
        const sourceRowBytes = blocksAcross((copy.rowLength !== 0) ? copy.rowLength : copy.width, layout) * layout.blockBytes;
        const copiedRowBytes = blocksAcross(copy.width, layout) * layout.blockBytes;
        const rows = blocksDown(copy.height, layout);
        let region: Uint8Array;
        try {
            region = new Uint8Array(source.read(copy.bufferOffset, sourceRowBytes * (rows - 1) + copiedRowBytes));
        } catch {
            return;
        }
        const firstRow = copy.y / layout.blockHeight;
        const firstByte = copy.x / layout.blockWidth * layout.blockBytes;
        for (let row = 0; row !== rows; row++) {
            const start = row * sourceRowBytes;
            shadow.bytes.set(region.subarray(start, start + copiedRowBytes), (firstRow + row) * rowBytes + firstByte);
        }
        shadow.generation++;
    }

    named(image: UInt64, name: string): void {
        this.#labels.set(image.toString(), name);
    }

    forgotten(image: UInt64): void {
        const key = image.toString();
        this.#shadowBytes -= this.#shadows.get(key)?.bytes.byteLength ?? 0;
        this.#shadows.delete(key);
        this.#labels.delete(key);
    }

    #textureOfView(view: UInt64, user: NativePointer): VulkanTexture {
        const facts = this.#tap().describeView(view);
        if (facts === null) {
            return new VulkanTexture({
                id: `Vulkan:view:${hexOf(view)}`,
                address: `VkImageView ${hexOf(view)}`,
                label: null,
                width: 0,
                height: 0,
                format: UNDEFINED_FORMAT,
                access: "unlocated",
                texels: null,
            });
        }
        return this.#textureOfImage(facts.image, facts.format, user);
    }

    #textureOfImage(image: UInt64, viewFormat: number, user: NativePointer): VulkanTexture {
        const key = image.toString();
        const facts = this.#tap().describeImage(image);
        const label = this.#labels.get(key) ?? null;
        if (facts === null || facts.order === 0) {
            return new VulkanTexture({
                id: `Vulkan:image:${hexOf(image)}`,
                address: `VkImage ${hexOf(image)}`,
                label,
                width: 0,
                height: 0,
                format: viewFormat,
                access: "unlocated",
                texels: null,
            });
        }
        const shadow = this.#shadows.get(key);
        const texels = (shadow !== undefined) ? () => shadow.bytes.slice().buffer : this.#linearTexelsOf(image, facts, user);
        return new VulkanTexture({
            id: `Vulkan:image:${hexOf(image)}#${facts.order}${(shadow !== undefined) ? `/${shadow.generation}` : ""}`,
            address: `VkImage ${hexOf(image)}`,
            label,
            width: facts.width,
            height: facts.height,
            format: facts.format,
            access: (texels !== null) ? "cpu-readable" : (facts.backing === "tracked") ? "gpu-only" : "unlocated",
            texels,
        });
    }

    #linearTexelsOf(image: UInt64, facts: ImageFacts, user: NativePointer): Texels | null {
        const format = vulkanTextureFormats.get(facts.format);
        const memory = facts.mapped.isNull() ? this.#contents.memoryShadowOf(facts.memory) : null;
        if (facts.tiling !== "linear" || facts.backing !== "tracked" || format === undefined
            || (facts.mapped.isNull() && memory === null)) {
            return null;
        }
        const layout = this.#linearLayoutOf(image, user);
        if (layout === null) {
            return null;
        }
        const rowBytes = blocksAcross(facts.width, format) * format.blockBytes;
        const rows = blocksDown(facts.height, format);
        const readRow = (row: number): ArrayBuffer => {
            const offset = facts.memoryOffset + layout.offset + row * layout.rowPitch;
            if (memory === null) {
                return facts.mapped.add(offset - facts.mappedOffset).readByteArray(rowBytes)!;
            }
            return memory.bytes.slice(offset - memory.offset, offset - memory.offset + rowBytes);
        };
        return () => {
            const packed = new Uint8Array(rowBytes * rows);
            for (let row = 0; row !== rows; row++) {
                packed.set(new Uint8Array(readRow(row)), row * rowBytes);
            }
            return packed.buffer;
        };
    }

    #linearLayoutOf(image: UInt64, user: NativePointer): LinearLayout | null {
        const owner = this.#tap().deviceOf(user);
        const query = (owner !== null) ? this.#subresourceLayouts.get(owner.driver) : undefined;
        if (owner === null || query === undefined) {
            return null;
        }
        query(owner.device, image, this.#subresource, this.#layout.$address);
        return { offset: this.#layout.offset.toNumber(), rowPitch: this.#layout.rowPitch.toNumber() };
    }

    #shadowOf(image: UInt64, facts: ImageFacts, layout: VulkanTextureFormat): ImageShadow | null {
        const key = image.toString();
        const existing = this.#shadows.get(key);
        if (existing !== undefined) {
            return existing;
        }
        const size = blocksAcross(facts.width, layout) * blocksDown(facts.height, layout) * layout.blockBytes;
        if (size > LARGEST_SHADOW || this.#shadowBytes + size > SHADOW_BUDGET) {
            return null;
        }
        const shadow = { bytes: new Uint8Array(size), generation: 0 };
        this.#shadows.set(key, shadow);
        this.#shadowBytes += size;
        this.#tap().rememberImage(image);
        return shadow;
    }
}

class VulkanTexture implements GpuTexture {
    readonly api = "Vulkan";
    readonly id: string;
    readonly address: string;
    readonly label: string | null;
    readonly width: number;
    readonly height: number;
    readonly format: TextureFormat | null;
    readonly formatName: string;
    readonly access: BufferAccess;
    readonly #texels: Texels | null;

    constructor(description: TextureDescription) {
        this.id = description.id;
        this.address = description.address;
        this.label = description.label;
        this.width = description.width;
        this.height = description.height;
        this.format = vulkanTextureFormats.get(description.format)?.format ?? null;
        this.formatName = vulkanFormatName(description.format);
        this.access = description.access;
        this.#texels = description.texels;
    }

    read(): ArrayBuffer {
        if (this.#texels === null) {
            throw new Error(`${this.address} holds no contents Mesh Finder has seen`);
        }
        return this.#texels();
    }
}

function unseenDescriptor(set: UInt64, binding: number): VulkanTexture {
    return new VulkanTexture({
        id: `Vulkan:descriptor:${hexOf(set)}:${binding}`,
        address: `binding ${binding} of VkDescriptorSet ${hexOf(set)}`,
        label: null,
        width: 0,
        height: 0,
        format: UNDEFINED_FORMAT,
        access: "unlocated",
        texels: null,
    });
}

function colorSubresource(): NativePointer {
    const subresource = Memory.alloc(IMAGE_SUBRESOURCE_SIZE);
    subresource.writeU32(COLOR_ASPECT);
    subresource.add(MIP_LEVEL_OFFSET).writeU32(0);
    subresource.add(ARRAY_LAYER_OFFSET).writeU32(0);
    return subresource;
}

function hexOf(handle: UInt64): string {
    return `0x${handle.toString(16)}`;
}

function blocksAcross(width: number, format: VulkanTextureFormat): number {
    return Math.ceil(width / format.blockWidth);
}

function blocksDown(height: number, format: VulkanTextureFormat): number {
    return Math.ceil(height / format.blockHeight);
}
