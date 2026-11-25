import { BlockDescriptor, BlockLiteral } from "./apple-blocks.pat";

const BLOCK_IS_GLOBAL = 1 << 28;

export class RunLoopWaker {
    readonly #pthreadFromMachThread = new NativeFunction(
        Module.getGlobalExportByName("pthread_from_mach_thread_np"), "pointer", ["uint"]);
    readonly #runLoopOf = new NativeFunction(Module.getGlobalExportByName("_CFRunLoopGet0"), "pointer", ["pointer"]);
    readonly #performBlock = new NativeFunction(
        Module.getGlobalExportByName("CFRunLoopPerformBlock"), "void", ["pointer", "pointer", "pointer"]);
    readonly #wakeUp = new NativeFunction(Module.getGlobalExportByName("CFRunLoopWakeUp"), "void", ["pointer"]);
    readonly #commonModes = Module.getGlobalExportByName("kCFRunLoopCommonModes").readPointer();
    readonly #invoke = new NativeCallback(() => this.#runQueued(), "void", ["pointer"]);
    readonly #descriptor = BlockDescriptor.at(Memory.alloc(BlockDescriptor.size));
    readonly #block = BlockLiteral.at(Memory.alloc(BlockLiteral.size));
    readonly #queued = new Map<ThreadId, (() => void)[]>();
    #disposed = false;

    constructor() {
        this.#descriptor.size = uint64(BlockLiteral.size);
        this.#block.isa = Module.getGlobalExportByName("_NSConcreteGlobalBlock");
        this.#block.flags = BLOCK_IS_GLOBAL;
        this.#block.invoke = this.#invoke;
        this.#block.descriptor = this.#descriptor.$address;
    }

    wake(thread: ThreadId, task: () => void): boolean {
        const pthread = this.#pthreadFromMachThread(thread);
        if (this.#disposed || pthread.isNull()) {
            return false;
        }
        const runLoop = this.#runLoopOf(pthread);
        if (runLoop.isNull()) {
            return false;
        }
        const queue = this.#queued.get(thread) ?? [];
        queue.push(task);
        this.#queued.set(thread, queue);
        Script.pin();
        this.#performBlock(runLoop, this.#commonModes, this.#block.$address);
        this.#wakeUp(runLoop);
        return true;
    }

    dispose(): void {
        this.#disposed = true;
        this.#queued.clear();
    }

    #runQueued(): void {
        Script.unpin();
        const thread = Process.getCurrentThreadId();
        const tasks = this.#queued.get(thread) ?? [];
        this.#queued.delete(thread);
        for (const task of tasks) {
            task();
        }
    }
}
