import type { ContextRegistry, Vm } from "./contexts.js";
import type { JscApi } from "./jsc-api.js";

export interface HotFunction {
    label: string;
    count: number;
}

export interface ProfilerObserver {
    onHotFunctions(functions: HotFunction[]): void;
}

interface SampleFrame {
    sourceID: number;
    name: string;
    line: number;
    column: number;
}

interface Samples {
    traces: { frames: SampleFrame[] }[];
}

const POLL_INTERVAL_MS = 1000;
const FUNCTIONS_SHOWN = 40;
const NO_SOURCE = 4294967295;

export class Profiler {
    readonly #api: JscApi;
    readonly #registry: ContextRegistry;
    readonly #observer: ProfilerObserver;
    readonly #counts = new Map<string, number>();
    readonly #profiled = new Set<Vm>();
    readonly #polling = new Set<Vm>();
    #timer: ReturnType<typeof setInterval> | null = null;

    constructor(api: JscApi, registry: ContextRegistry, observer: ProfilerObserver) {
        this.#api = api;
        this.#registry = registry;
        this.#observer = observer;
    }

    async start(vm: Vm): Promise<boolean> {
        const started = await vm.lane.run(() => this.#api.startProfiler(vm.group));
        if (started) {
            vm.profiling = true;
            this.#profiled.add(vm);
            this.#timer ??= setInterval(() => this.#pollAll(), POLL_INTERVAL_MS);
            this.#registry.vmChanged(vm);
        }
        return started;
    }

    async stop(vm: Vm): Promise<void> {
        if (!this.#profiled.has(vm)) {
            return;
        }
        this.#profiled.delete(vm);
        const samples = (vm.live.length !== 0) ? await vm.lane.run(() => {
            const text = this.#api.takeSamples(vm.group);
            this.#api.stopProfiler(vm.group);
            return text;
        }) : null;
        vm.profiling = false;
        this.#count(vm, samples);
        this.#stopTimerWhenIdle();
    }

    clear(): void {
        this.#counts.clear();
        this.#observer.onHotFunctions([]);
    }

    async dispose(): Promise<void> {
        await Promise.all([...this.#profiled].map(vm => this.stop(vm)));
        this.#stopTimerWhenIdle();
    }

    #pollAll(): void {
        for (const vm of this.#profiled) {
            if (vm.live.length === 0) {
                this.#profiled.delete(vm);
                vm.profiling = false;
                this.#registry.vmChanged(vm);
            } else if (!this.#polling.has(vm)) {
                this.#poll(vm);
            }
        }
        this.#stopTimerWhenIdle();
    }

    #poll(vm: Vm): void {
        this.#polling.add(vm);
        void vm.lane.run(() => this.#api.takeSamples(vm.group))
            .then(samples => this.#count(vm, samples))
            .finally(() => this.#polling.delete(vm));
    }

    #count(vm: Vm, text: string | null): void {
        const samples = (text !== null) ? JSON.parse(text) as Samples : { traces: [] };
        for (const { frames } of samples.traces) {
            if (frames.length !== 0) {
                const label = labelOf(frames);
                this.#counts.set(label, (this.#counts.get(label) ?? 0) + 1);
            }
        }
        vm.samples += samples.traces.length;
        this.#registry.vmChanged(vm);
        this.#observer.onHotFunctions([...this.#counts]
            .map(([label, count]) => ({ label, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, FUNCTIONS_SHOWN));
    }

    #stopTimerWhenIdle(): void {
        if (this.#profiled.size === 0 && this.#timer !== null) {
            clearInterval(this.#timer);
            this.#timer = null;
        }
    }
}

function labelOf(frames: SampleFrame[]): string {
    const innermost = frames.find(frame => frame.sourceID !== NO_SOURCE);
    if (innermost === undefined) {
        return `${nameOf(frames[0])} (native)`;
    }
    const where = `${nameOf(innermost)} ${innermost.sourceID}:${innermost.line}:${innermost.column}`;
    return (innermost === frames[0]) ? where : `${where} in ${nameOf(frames[0])}`;
}

function nameOf(frame: SampleFrame): string {
    return (frame.name.length !== 0) ? frame.name : "(anonymous)";
}
