const BLOCK_IS_GLOBAL = 1 << 28;

const flagsOffset = Process.pointerSize;
const invokeOffset = flagsOffset + 8;
const descriptorOffset = invokeOffset + Process.pointerSize;
const blockSize = descriptorOffset + Process.pointerSize;

const copyBlock = new NativeFunction(Module.getGlobalExportByName("_Block_copy"), "pointer", ["pointer"]);
const releaseBlock = new NativeFunction(Module.getGlobalExportByName("_Block_release"), "void", ["pointer"]);
const globalBlockClass = Module.getGlobalExportByName("_NSConcreteGlobalBlock");
const globalBlockStorage: NativePointer[] = [];

export const blocks = {
    copy(block: NativePointer): NativePointer {
        return copyBlock(block);
    },

    release(block: NativePointer): void {
        releaseBlock(block);
    },

    invokeOf(block: NativePointer): NativePointer {
        return block.add(invokeOffset).readPointer().strip();
    },

    makeGlobal(invoke: NativePointer): NativePointer {
        const descriptor = Memory.alloc(2 * Process.pointerSize);
        descriptor.writeULong(0);
        descriptor.add(Process.pointerSize).writeULong(blockSize);

        const block = Memory.alloc(blockSize);
        block.writePointer(globalBlockClass);
        block.add(flagsOffset).writeU32(BLOCK_IS_GLOBAL);
        block.add(flagsOffset + 4).writeU32(0);
        const invokeSlot = block.add(invokeOffset);
        invokeSlot.writePointer(invoke.strip().sign("ia", invokeSlot));
        block.add(descriptorOffset).writePointer(descriptor);

        globalBlockStorage.push(descriptor, invoke);
        return block;
    },
};
