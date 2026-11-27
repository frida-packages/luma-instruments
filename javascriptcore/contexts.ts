import type { JscApi } from "./jsc-api.js";
import type { Lane, Lanes } from "./lanes.js";

export type ContextKind = "JSContext" | "Window" | "Worker" | "Other";
export type Discovery = "scan" | "creation";

export interface MemoryStatistics {
    heapSize: number;
    heapCapacity: number;
    extraMemorySize: number;
    objectCount: number;
    protectedObjectCount: number;
    globalObjectCount: number;
    protectedGlobalObjectCount: number;
    objectTypeCounts: Record<string, number>;
}

export interface ContextObserver {
    onContextChanged(context: Context): void;
    onContextRemoved(context: Context): void;
}

export interface VmObserver {
    onVmChanged(vm: Vm): void;
    onVmRemoved(vm: Vm): void;
}

const API_CLASS_NAMES = new Set(["JSGlobalObject", "JSAPIGlobalObject", "CallbackGlobalObject"]);
const DESTROYED_KEPT = 8;

export class ContextRegistry {
    readonly #api: JscApi;
    readonly #lanes: Lanes;
    readonly #contextObservers: ContextObserver[] = [];
    readonly #vmObservers: VmObserver[] = [];
    readonly #live = new Map<string, Context>();
    readonly #contexts: Context[] = [];
    readonly #vms: Vm[] = [];
    #nextContext = 1;
    #nextVm = 1;

    constructor(api: JscApi, lanes: Lanes) {
        this.#api = api;
        this.#lanes = lanes;
    }

    observeContexts(observer: ContextObserver): void {
        this.#contextObservers.push(observer);
    }

    observeVms(observer: VmObserver): void {
        this.#vmObservers.push(observer);
    }

    get contexts(): readonly Context[] {
        return this.#contexts;
    }

    get vms(): readonly Vm[] {
        return this.#vms;
    }

    get liveCount(): number {
        return this.#live.size;
    }

    admit(address: NativePointer, classChain: string[] | null, discovery: Discovery): Context {
        const known = this.#live.get(address.toString());
        if (known !== undefined) {
            return known;
        }
        const vm = this.#vmFor(this.#api.groupOf(address));
        const kind = kindOf(classChain);
        const lane = (kind === "Window") ? this.#lanes.main : vm.lane;
        const context = new Context(this.#nextContext++, address, vm, classChain, kind, lane, discovery);
        this.#live.set(address.toString(), context);
        this.#contexts.push(context);
        vm.contexts.add(context);
        this.changed(context);
        return context;
    }

    destroy(address: NativePointer): void {
        const context = this.#live.get(address.toString());
        if (context === undefined) {
            return;
        }
        this.#live.delete(address.toString());
        context.destroyed = true;
        this.changed(context);
        if (context.vm.live.length === 0) {
            this.#removeVm(context.vm);
        }
        this.#pruneDestroyed();
    }

    contextNumbered(serial: number): Context | undefined {
        return this.#contexts.find(context => context.serial === serial);
    }

    liveContextAt(address: NativePointer): Context | undefined {
        return this.#live.get(address.toString());
    }

    vmNumbered(serial: number): Vm | undefined {
        return this.#vms.find(vm => vm.serial === serial);
    }

    changed(context: Context): void {
        for (const observer of this.#contextObservers) {
            observer.onContextChanged(context);
        }
        this.vmChanged(context.vm);
    }

    vmChanged(vm: Vm): void {
        if (!this.#vms.includes(vm)) {
            return;
        }
        for (const observer of this.#vmObservers) {
            observer.onVmChanged(vm);
        }
    }

    #vmFor(group: NativePointer): Vm {
        const known = this.#vms.find(vm => vm.group.equals(group));
        if (known !== undefined) {
            return known;
        }
        const serial = this.#nextVm++;
        const vm = new Vm(serial, group, this.#lanes.create());
        this.#vms.push(vm);
        return vm;
    }

    #pruneDestroyed(): void {
        const destroyed = this.#contexts.filter(context => context.destroyed);
        for (const context of destroyed.slice(0, Math.max(0, destroyed.length - DESTROYED_KEPT))) {
            this.#contexts.splice(this.#contexts.indexOf(context), 1);
            context.vm.contexts.delete(context);
            for (const observer of this.#contextObservers) {
                observer.onContextRemoved(context);
            }
        }
    }

    #removeVm(vm: Vm): void {
        this.#vms.splice(this.#vms.indexOf(vm), 1);
        for (const observer of this.#vmObservers) {
            observer.onVmRemoved(vm);
        }
    }
}

export class Context {
    readonly serial: number;
    readonly address: NativePointer;
    readonly vm: Vm;
    readonly classChain: string[] | null;
    readonly kind: ContextKind;
    readonly lane: Lane;
    readonly discovery: Discovery;
    name: string | null = null;
    inspectable: boolean | null = null;
    destroyed = false;

    constructor(serial: number, address: NativePointer, vm: Vm, classChain: string[] | null, kind: ContextKind, lane: Lane,
        discovery: Discovery) {
        this.serial = serial;
        this.address = address;
        this.vm = vm;
        this.classChain = classChain;
        this.kind = kind;
        this.lane = lane;
        this.discovery = discovery;
    }

    get evaluable(): boolean {
        return this.kind === "JSContext" || this.kind === "Window";
    }

    get className(): string {
        return this.classChain?.[0] ?? "unknown";
    }

    get title(): string {
        return (this.name !== null && this.name.length !== 0) ? `#${this.serial} ${this.name}` : `#${this.serial} ${this.kind}`;
    }

    get runsOn(): string {
        if (!this.evaluable) {
            return "not evaluated";
        }
        return (this.lane.kind === "main") ? "main thread" : "a background thread";
    }
}

export class Vm {
    readonly serial: number;
    readonly group: NativePointer;
    readonly lane: Lane;
    readonly contexts = new Set<Context>();
    statistics: MemoryStatistics | null = null;
    profiling = false;
    samples = 0;

    constructor(serial: number, group: NativePointer, lane: Lane) {
        this.serial = serial;
        this.group = group;
        this.lane = lane;
    }

    get live(): Context[] {
        return [...this.contexts].filter(context => !context.destroyed);
    }
}

function kindOf(classChain: string[] | null): ContextKind {
    if (classChain === null) {
        return (Process.findModuleByName("WebCore") === null) ? "JSContext" : "Other";
    }
    if (API_CLASS_NAMES.has(classChain[0])) {
        return "JSContext";
    }
    if (/Window/.test(classChain[0])) {
        return "Window";
    }
    return /Worker|Worklet/.test(classChain[0]) ? "Worker" : "Other";
}
