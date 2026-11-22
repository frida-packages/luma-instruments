import type { BufferAccess, GpuBuffer } from "./graphics-backend.js";
import { vulkanLibraries } from "./graphics-libraries.js";
import type { VulkanDriver } from "./vulkan-driver.js";
import type { BufferFacts, KnownMapping, ObjectKind, VulkanTap } from "./vulkan-tap.js";

interface MemoryShadow {
    offset: number;
    bytes: ArrayBuffer;
}

interface Region {
    offset: number;
    bytes: Uint8Array;
}

const LARGEST_SHADOW = 64 * 1048576;
const SHADOW_BUDGET = 512 * 1048576;
const LARGEST_MAPPED_RANGE = 64 * 1048576;
const SMALLEST_MAPPED_RANGE = 36;
const SETTLE_MS = 250;

const usedLengthSource = `
#include <glib.h>

guint64 used_length (const guint8 * data, guint64 length)
{
  while (length >= 8 && *(const guint64 *) (data + length - 8) == 0)
    length -= 8;
  while (length != 0 && data[length - 1] == 0)
    length--;
  return length;
}
`;

export class VulkanContents {
    private readonly bufferShadows = new Map<string, ShadowRegions>();
    private readonly memoryShadows = new Map<string, MemoryShadow>();
    private readonly labels = new Map<string, string>();
    private readonly requiredSizes = new Map<string, number>();
    private readonly memoryRequirements: Map<number, NativeFunction<void, [NativePointerValue, number | UInt64, NativePointerValue]>>;
    private readonly requirements = Memory.alloc(24);
    private readonly usedLengthKernel = new CModule(usedLengthSource);
    private readonly usedLength = new NativeFunction(this.usedLengthKernel.used_length, "uint64", ["pointer", "uint64"]);
    private readonly changedBuffers = new Set<string>();
    private readonly changedMemories = new Set<string>();
    private shadowBytes = 0;
    private settle: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private readonly tap: () => VulkanTap,
        drivers: VulkanDriver[],
        private readonly settled: (buffers: GpuBuffer[]) => void,
    ) {
        this.memoryRequirements = new Map(drivers.flatMap(driver => {
            const entry = driver.entryPoints.get("vkGetBufferMemoryRequirements");
            return (entry !== undefined) ? [[driver.index, new NativeFunction(entry, "void", ["pointer", "uint64", "pointer"])]] : [];
        }));
    }

    bufferOf(handle: UInt64, user: NativePointer | null): VulkanBuffer {
        const key = handle.toString();
        const facts = this.tap().describeBuffer(handle);
        const shadow = this.bufferShadows.get(key) ?? null;
        const memoryShadow = (facts?.backing === "tracked") ? this.memoryShadows.get(facts.memory.toString()) ?? null : null;
        const byteLength = (facts !== null && facts.size !== 0) ? facts.size : this.requiredSize(handle, user) ?? shadow?.extent ?? 0;
        return new VulkanBuffer(handle, facts, shadow, memoryShadow, this.labels.get(key) ?? null, byteLength);
    }

    copied(source: UInt64, destination: UInt64, sourceOffset: number, destinationOffset: number, size: number): void {
        if (size > LARGEST_SHADOW || this.shadowBytes + size > SHADOW_BUDGET) {
            return;
        }
        const from = this.bufferOf(source, null);
        if (from.access !== "cpu-readable") {
            return;
        }
        try {
            this.shadow(destination, destinationOffset, new Uint8Array(from.read(sourceOffset, size)));
        } catch {
        }
    }

    updated(destination: UInt64, offset: number, size: number, data: NativePointer): void {
        if (this.shadowBytes + size <= SHADOW_BUDGET) {
            this.shadow(destination, offset, new Uint8Array(data.readByteArray(size)!));
        }
    }

    unmapping(memory: UInt64, mapped: NativePointer, offset: number, size: number): void {
        const key = memory.toString();
        const previous = this.memoryShadows.get(key)?.bytes.byteLength ?? 0;
        if (this.shadowBytes - previous + size > SHADOW_BUDGET) {
            return;
        }
        this.memoryShadows.set(key, { offset, bytes: mapped.readByteArray(size)! });
        this.shadowBytes += size - previous;
        this.changedMemories.add(key);
        this.scheduleSettle();
    }

    named(buffer: UInt64, name: string): void {
        this.labels.set(buffer.toString(), name);
    }

    forgotten(kind: ObjectKind, handle: UInt64): void {
        const key = handle.toString();
        if (kind === "buffer") {
            this.shadowBytes -= this.bufferShadows.get(key)?.size ?? 0;
            this.bufferShadows.delete(key);
            this.labels.delete(key);
            this.requiredSizes.delete(key);
            this.changedBuffers.delete(key);
        } else {
            this.shadowBytes -= this.memoryShadows.get(key)?.bytes.byteLength ?? 0;
            this.memoryShadows.delete(key);
            this.changedMemories.delete(key);
        }
    }

    readableBuffers(): VulkanBuffer[] {
        const shadowed = [...this.bufferShadows.keys()].map(key => uint64(key));
        const handles = new Map([...this.tap().buffers(), ...shadowed].map(handle => [handle.toString(), handle]));
        return [...handles.values()].map(handle => this.bufferOf(handle, null)).filter(buffer => buffer.access === "cpu-readable");
    }

    mappedDeviceMemory(): GpuBuffer[] {
        const known = this.tap().mappings();
        const ranges = mappedDeviceRanges()
            .filter(range => range.size <= LARGEST_MAPPED_RANGE && !known.some(mapping => overlaps(mapping, range)));
        return ranges.flatMap((range, order) => {
            let used: number;
            try {
                used = this.usedLength(range.base, range.size).toNumber();
            } catch {
                return [];
            }
            return (used >= SMALLEST_MAPPED_RANGE) ? [new MappedDeviceMemory(range.base, (used + 3) & ~3, order)] : [];
        });
    }

    dispose(): void {
        if (this.settle !== null) {
            clearTimeout(this.settle);
            this.settle = null;
        }
    }

    private requiredSize(handle: UInt64, user: NativePointer | null): number | null {
        const key = handle.toString();
        const cached = this.requiredSizes.get(key);
        if (cached !== undefined || user === null) {
            return cached ?? null;
        }
        const owner = this.tap().deviceOf(user);
        const query = (owner !== null) ? this.memoryRequirements.get(owner.driver) : undefined;
        if (owner === null || query === undefined) {
            return null;
        }
        query(owner.device, handle, this.requirements);
        const size = this.requirements.readU64().toNumber();
        this.requiredSizes.set(key, size);
        this.tap().rememberBuffer(handle);
        return size;
    }

    private shadow(destination: UInt64, offset: number, bytes: Uint8Array): void {
        const key = destination.toString();
        let regions = this.bufferShadows.get(key);
        if (regions === undefined) {
            regions = new ShadowRegions();
            this.bufferShadows.set(key, regions);
            this.tap().rememberBuffer(destination);
        }
        const before = regions.size;
        regions.write(offset, bytes);
        this.shadowBytes += regions.size - before;
        this.changedBuffers.add(key);
        this.scheduleSettle();
    }

    private scheduleSettle(): void {
        if (this.settle !== null) {
            clearTimeout(this.settle);
        }
        this.settle = setTimeout(() => {
            this.settle = null;
            const handles = new Map<string, UInt64>([...this.changedBuffers].map(key => [key, uint64(key)]));
            for (const memory of this.changedMemories) {
                for (const handle of this.tap().buffers(uint64(memory))) {
                    handles.set(handle.toString(), handle);
                }
            }
            this.changedBuffers.clear();
            this.changedMemories.clear();
            const buffers = [...handles.values()].map(handle => this.bufferOf(handle, null));
            this.settled(buffers.filter(buffer => buffer.access === "cpu-readable"));
        }, SETTLE_MS);
    }
}

export class VulkanBuffer implements GpuBuffer {
    readonly api = "Vulkan";
    readonly id: string;
    readonly address: string;
    readonly label: string | null;
    readonly byteLength: number;
    readonly access: BufferAccess;
    readonly creationOrder: number;

    constructor(
        handle: UInt64,
        private readonly facts: BufferFacts | null,
        private readonly shadow: ShadowRegions | null,
        private readonly memoryShadow: MemoryShadow | null,
        label: string | null,
        byteLength: number,
    ) {
        const hex = `0x${handle.toString(16)}`;
        const order = facts?.order ?? 0;
        this.id = (order !== 0) ? `Vulkan:${hex}#${order}` : `Vulkan:${hex}`;
        this.address = `VkBuffer ${hex}`;
        this.label = label;
        this.byteLength = byteLength;
        this.access = accessOf(facts, shadow, memoryShadow);
        this.creationOrder = order;
    }

    read(offset: number, length: number): ArrayBuffer {
        if (offset < 0 || length < 0 || (this.byteLength !== 0 && offset + length > this.byteLength)) {
            throw new Error(`read of ${length} bytes at ${offset} is outside ${this.address}, which holds ${this.byteLength}`);
        }
        const shadowed = this.shadow?.read(offset, length) ?? null;
        if (shadowed !== null) {
            return shadowed;
        }
        const facts = this.facts;
        if (facts !== null && !facts.mapped.isNull()) {
            const start = facts.memoryOffset - facts.mappedOffset + offset;
            if (start >= 0 && (facts.mappedSize === null || start + length <= facts.mappedSize)) {
                return facts.mapped.add(start).readByteArray(length)!;
            }
        }
        if (facts !== null && this.memoryShadow !== null) {
            const start = facts.memoryOffset - this.memoryShadow.offset + offset;
            if (start >= 0 && start + length <= this.memoryShadow.bytes.byteLength) {
                return this.memoryShadow.bytes.slice(start, start + length);
            }
        }
        throw new Error(`${this.address} holds no contents Mesh Finder has seen at ${offset}..${offset + length}`);
    }
}

class MappedDeviceMemory implements GpuBuffer {
    readonly api = "Vulkan";
    readonly id: string;
    readonly address: string;
    readonly label = null;
    readonly byteLength: number;
    readonly access: BufferAccess = "cpu-readable";
    readonly creationOrder: number;

    constructor(private readonly base: NativePointer, byteLength: number, creationOrder: number) {
        this.id = `Vulkan:mapped:${base}`;
        this.address = `device memory mapped at ${base}`;
        this.byteLength = byteLength;
        this.creationOrder = creationOrder;
    }

    read(offset: number, length: number): ArrayBuffer {
        if (offset < 0 || length < 0 || offset + length > this.byteLength) {
            throw new Error(`read of ${length} bytes at ${offset} is outside ${this.address}, which holds ${this.byteLength}`);
        }
        return this.base.add(offset).readByteArray(length)!;
    }
}

class ShadowRegions {
    private regions: Region[] = [];

    get size(): number {
        return this.regions.reduce((sum, region) => sum + region.bytes.length, 0);
    }

    get extent(): number {
        return this.regions.reduce((end, region) => Math.max(end, region.offset + region.bytes.length), 0);
    }

    write(offset: number, bytes: Uint8Array): void {
        const end = offset + bytes.length;
        const touching = this.regions.filter(region => region.offset <= end && region.offset + region.bytes.length >= offset);
        const start = Math.min(offset, ...touching.map(region => region.offset));
        const stop = Math.max(end, ...touching.map(region => region.offset + region.bytes.length));
        const merged = new Uint8Array(stop - start);
        for (const region of touching) {
            merged.set(region.bytes, region.offset - start);
        }
        merged.set(bytes, offset - start);
        this.regions = [...this.regions.filter(region => !touching.includes(region)), { offset: start, bytes: merged }]
            .sort((a, b) => a.offset - b.offset);
    }

    read(offset: number, length: number): ArrayBuffer | null {
        const region = this.regions.find(candidate =>
            candidate.offset <= offset && candidate.offset + candidate.bytes.length >= offset + length);
        if (region === undefined) {
            return null;
        }
        const start = offset - region.offset;
        return region.bytes.slice(start, start + length).buffer;
    }
}

function mappedDeviceRanges(): MemoryRange[] {
    if (Process.platform !== "linux") {
        return [];
    }
    return File.readAllText("/proc/self/maps").split("\n").flatMap(line => {
        const [span, protection, , , , path] = line.split(/\s+/);
        if (path === undefined || !protection.startsWith("rw") || !vulkanLibraries.mappedDeviceMemory.test(path)) {
            return [];
        }
        const [start, end] = span.split("-").map(bound => parseInt(bound, 16));
        return [{ base: ptr(start), size: end - start }];
    });
}

function overlaps(mapping: KnownMapping, range: MemoryRange): boolean {
    const end = mapping.mapped.add(mapping.mappedSize ?? 1);
    return mapping.mapped.compare(range.base.add(range.size)) < 0 && end.compare(range.base) > 0;
}

function accessOf(facts: BufferFacts | null, shadow: ShadowRegions | null, memoryShadow: MemoryShadow | null): BufferAccess {
    if (shadow !== null || (facts?.backing === "tracked" && (!facts.mapped.isNull() || memoryShadow !== null))) {
        return "cpu-readable";
    }
    return (facts?.backing === "tracked") ? "gpu-only" : "unlocated";
}
