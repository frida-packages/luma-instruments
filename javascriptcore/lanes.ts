export type LaneKind = "own" | "main";

interface Task {
    work: () => unknown;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
}

const QOS_CLASS_UTILITY = 0x11;

export class Lanes {
    readonly #dispatcher = new Dispatcher();
    readonly #background = new NativeFunction(Module.getGlobalExportByName("dispatch_get_global_queue"), "pointer", ["long", "ulong"])(
        QOS_CLASS_UTILITY, 0);
    readonly #main = new Lane("main", Module.getGlobalExportByName("_dispatch_main_q"), this.#dispatcher);

    get main(): Lane {
        return this.#main;
    }

    create(): Lane {
        return new Lane("own", this.#background, this.#dispatcher);
    }

    dispose(): void {
        this.#dispatcher.dispose();
    }
}

export class Lane {
    readonly kind: LaneKind;
    readonly #queue: NativePointer;
    readonly #dispatcher: Dispatcher;
    #tail: Promise<unknown> = Promise.resolve();

    constructor(kind: LaneKind, queue: NativePointer, dispatcher: Dispatcher) {
        this.kind = kind;
        this.#queue = queue;
        this.#dispatcher = dispatcher;
    }

    run<T>(work: () => T): Promise<T> {
        const result = this.#tail.then(() => this.#dispatcher.dispatch(this.#queue, work));
        this.#tail = result.catch(() => {});
        return result;
    }
}

class Dispatcher {
    readonly #dispatchAsync = new NativeFunction(Module.getGlobalExportByName("dispatch_async_f"), "void", ["pointer", "pointer", "pointer"]);
    readonly #trampoline = new NativeCallback(context => this.#runTask(context.toUInt32()), "void", ["pointer"]);
    readonly #tasks = new Map<number, Task>();
    #nextId = 1;
    #disposed = false;

    dispatch<T>(queue: NativePointer, work: () => T): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const id = this.#nextId++;
            this.#tasks.set(id, { work, resolve: resolve as (value: unknown) => void, reject });
            Script.pin();
            this.#dispatchAsync(queue, ptr(id), this.#trampoline);
        });
    }

    dispose(): void {
        this.#disposed = true;
        this.#tasks.clear();
    }

    #runTask(id: number): void {
        Script.unpin();
        const task = this.#tasks.get(id);
        this.#tasks.delete(id);
        if (task === undefined || this.#disposed) {
            return;
        }
        try {
            task.resolve(task.work());
        } catch (e) {
            task.reject(e);
        }
    }
}
