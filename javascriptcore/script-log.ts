import { KIT_URL } from "./context-sessions.js";
import type { JscApi } from "./jsc-api.js";

export type ScriptVia = "JSEvaluateScript" | "JSScriptEvaluate";
export type ScriptOutcome = "running" | "returned" | "threw";

export interface ScriptRecord {
    serial: number;
    firstRun: Date;
    context: NativePointer;
    via: ScriptVia;
    url: string | null;
    length: number | null;
    lines: number | null;
    source: string | null;
    sourceDropped: boolean;
    runs: number;
    outcome: ScriptOutcome;
    ms: number | null;
}

export interface ScriptObserver {
    onScriptChanged(record: ScriptRecord): void;
    onScriptRemoved(record: ScriptRecord): void;
}

interface ScriptSource {
    url: string | null;
    source: string | null;
}

interface Run {
    record: ScriptRecord;
    startedAt: number;
}

const MOST_RECORDS = 1000;
const MOST_SCRIPT_REFS = 1000;
const BYTES_PER_CHARACTER = 2;

export class ScriptLog {
    readonly #api: JscApi;
    readonly #module: Module;
    readonly #observer: ScriptObserver;
    readonly #records: ScriptRecord[] = [];
    readonly #byKey = new Map<string, ScriptRecord[]>();
    readonly #scriptRefs = new Map<string, ScriptSource>();
    #listeners: InvocationListener[] = [];
    #keptBytes = 0;
    #budgetBytes = 0;
    #nextSerial = 1;

    constructor(api: JscApi, module: Module, observer: ScriptObserver) {
        this.#api = api;
        this.#module = module;
        this.#observer = observer;
    }

    configure(enabled: boolean, sourceMegabytes: number): void {
        this.#budgetBytes = sourceMegabytes * 1048576;
        this.#dropSourcesOverBudget();
        if (enabled && this.#listeners.length === 0) {
            this.#listeners = this.#attach();
        } else if (!enabled) {
            this.#detach();
        }
    }

    recordNumbered(serial: number): ScriptRecord | undefined {
        return this.#records.find(record => record.serial === serial);
    }

    clear(): void {
        for (const record of this.#records.splice(0)) {
            this.#observer.onScriptRemoved(record);
        }
        this.#byKey.clear();
        this.#keptBytes = 0;
    }

    dispose(): void {
        this.#detach();
    }

    #attach(): InvocationListener[] {
        const log = this;
        const api = this.#api;
        const address = (name: string) => this.#module.getExportByName(name);
        return [
            Interceptor.attach(address("JSEvaluateScript"), {
                onEnter(args) {
                    const url = args[3].isNull() ? null : api.readString(args[3]);
                    this.run = (url === KIT_URL) ? null : log.#begin(args[0], "JSEvaluateScript", { url, source: api.readString(args[1]) });
                },
                onLeave(retval) {
                    log.#finish(this.run as Run | null, retval);
                },
            }),
            Interceptor.attach(address("JSScriptCreateFromString"), {
                onEnter(args) {
                    this.script = { url: args[1].isNull() ? null : api.readString(args[1]), source: api.readString(args[3]) };
                },
                onLeave(retval) {
                    log.#noteScriptRef(retval, this.script as ScriptSource);
                },
            }),
            Interceptor.attach(address("JSScriptCreateReferencingImmortalASCIIText"), {
                onEnter(args) {
                    const url = args[1].isNull() ? null : api.readString(args[1]);
                    this.script = { url, source: args[3].readUtf8String(args[4].toInt32()) };
                },
                onLeave(retval) {
                    log.#noteScriptRef(retval, this.script as ScriptSource);
                },
            }),
            Interceptor.attach(address("JSScriptEvaluate"), {
                onEnter(args) {
                    this.run = log.#begin(args[0], "JSScriptEvaluate", log.#scriptRefs.get(args[1].toString()) ?? { url: null, source: null });
                },
                onLeave(retval) {
                    log.#finish(this.run as Run | null, retval);
                },
            }),
        ];
    }

    #detach(): void {
        for (const listener of this.#listeners) {
            listener.detach();
        }
        this.#listeners = [];
    }

    #begin(context: NativePointer, via: ScriptVia, script: ScriptSource): Run {
        const record = this.#recordFor(context, via, script);
        record.runs++;
        record.outcome = "running";
        this.#observer.onScriptChanged(record);
        return { record, startedAt: Date.now() };
    }

    #finish(run: Run | null, retval: NativePointer): void {
        if (run === null) {
            return;
        }
        run.record.outcome = retval.isNull() ? "threw" : "returned";
        run.record.ms = Date.now() - run.startedAt;
        this.#observer.onScriptChanged(run.record);
    }

    #noteScriptRef(script: NativePointer, source: ScriptSource): void {
        if (script.isNull()) {
            return;
        }
        this.#scriptRefs.delete(script.toString());
        this.#scriptRefs.set(script.toString(), source);
        if (this.#scriptRefs.size > MOST_SCRIPT_REFS) {
            this.#scriptRefs.delete(this.#scriptRefs.keys().next().value!);
        }
    }

    #recordFor(context: NativePointer, via: ScriptVia, { url, source }: ScriptSource): ScriptRecord {
        const key = keyOf(context, via, url, source?.length ?? null);
        const candidates = this.#byKey.get(key) ?? [];
        const known = candidates.find(record => record.sourceDropped || record.source === source);
        if (known !== undefined) {
            return known;
        }
        const record: ScriptRecord = {
            serial: this.#nextSerial++,
            firstRun: new Date(),
            context,
            via,
            url,
            length: source?.length ?? null,
            lines: (source !== null) ? source.split("\n").length : null,
            source,
            sourceDropped: false,
            runs: 0,
            outcome: "running",
            ms: null,
        };
        candidates.push(record);
        this.#byKey.set(key, candidates);
        this.#records.push(record);
        this.#keptBytes += (source?.length ?? 0) * BYTES_PER_CHARACTER;
        this.#dropSourcesOverBudget();
        this.#dropOldestOverLimit();
        return record;
    }

    #dropSourcesOverBudget(): void {
        for (const record of this.#records) {
            if (this.#keptBytes <= this.#budgetBytes) {
                return;
            }
            if (record.source !== null) {
                this.#keptBytes -= record.source.length * BYTES_PER_CHARACTER;
                record.source = null;
                record.sourceDropped = true;
                this.#observer.onScriptChanged(record);
            }
        }
    }

    #dropOldestOverLimit(): void {
        if (this.#records.length <= MOST_RECORDS) {
            return;
        }
        const oldest = this.#records.shift()!;
        this.#keptBytes -= (oldest.source?.length ?? 0) * BYTES_PER_CHARACTER;
        const key = keyOf(oldest.context, oldest.via, oldest.url, oldest.length);
        this.#byKey.set(key, this.#byKey.get(key)!.filter(record => record !== oldest));
        this.#observer.onScriptRemoved(oldest);
    }
}

function keyOf(context: NativePointer, via: ScriptVia, url: string | null, length: number | null): string {
    return `${context} ${via} ${url} ${length}`;
}
