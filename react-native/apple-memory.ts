import { VmRegionSubmapInfo } from "./apple-vm.pat";

const KERN_SUCCESS = 0;
const VM_PROT_READ = 1;
const MALLOC_TAGS = new Set([1, 2, 3, 4, 6, 7, 8, 9, 11, 12]);

export class AppleMemory {
    readonly #task = Module.getGlobalExportByName("mach_task_self_").readU32();
    readonly #readOverwrite = new NativeFunction(Module.getGlobalExportByName("mach_vm_read_overwrite"), "int",
        ["uint", "pointer", "size_t", "pointer", "pointer"]);
    readonly #regionRecurse = new NativeFunction(Module.getGlobalExportByName("mach_vm_region_recurse"), "int",
        ["uint", "pointer", "pointer", "pointer", "pointer", "pointer"]);
    readonly #copied = Memory.alloc(8);

    copy(destination: NativePointer, source: NativePointer, size: number): boolean {
        return this.#readOverwrite(this.#task, source, size, destination, this.#copied) === KERN_SUCCESS;
    }

    mallocRegions(): MemoryRange[] {
        const regions: MemoryRange[] = [];
        const address = Memory.alloc(8);
        const size = Memory.alloc(8);
        const depth = Memory.alloc(4);
        const count = Memory.alloc(4);
        const info = VmRegionSubmapInfo.at(Memory.alloc(VmRegionSubmapInfo.size));
        for (;;) {
            count.writeU32(VmRegionSubmapInfo.size / 4);
            if (this.#regionRecurse(this.#task, address, size, depth, info.$address, count) !== KERN_SUCCESS) {
                return regions;
            }
            if (info.isSubmap !== 0) {
                depth.writeU32(depth.readU32() + 1);
                continue;
            }
            const region = { base: address.readPointer(), size: size.readU64().toNumber() };
            if ((info.protection & VM_PROT_READ) !== 0 && MALLOC_TAGS.has(info.userTag)) {
                regions.push(region);
            }
            address.writePointer(region.base.add(region.size));
        }
    }
}
