import type { Call, CallLog } from "./call-log.js";
import { CallShape } from "./call-shape.js";
import type { Settings } from "./settings.js";
import type { StatusLine } from "./status-line.js";
import type { ValueText } from "./value-text.js";

interface Target {
    label: string;
    method: Il2Cpp.Method;
}

interface Selection {
    targets: Target[];
    sharing: number;
    withoutCode: number;
    overCap: number;
}

export class MethodTrace {
    readonly #log: CallLog;
    readonly #values: ValueText;
    readonly #status: StatusLine;
    readonly #listeners: InvocationListener[] = [];
    #catalog: Target[] | null = null;

    constructor(log: CallLog, values: ValueText, status: StatusLine) {
        this.#log = log;
        this.#values = values;
        this.#status = status;
    }

    apply(settings: Settings): void {
        this.#detach();
        this.#log.perSecond = settings.callsPerSecond;
        const pattern = settings.traceMethods;
        if (pattern === null) {
            this.#status.note("trace", "No methods traced", "Turn on “Trace methods matching” with a pattern such as ^PlayerController:: to trace calls.");
            return;
        }
        const selection = this.#select(pattern, settings.mostTraced);
        const failures: string[] = [];
        for (const target of selection.targets) {
            try {
                this.#listeners.push(this.#attach(target));
            } catch (e) {
                failures.push(`${target.label}: ${(e as Error).message}`);
            }
        }
        this.#status.note("trace", `Tracing ${this.#listeners.length} method${(this.#listeners.length === 1) ? "" : "s"} matching /${pattern.source}/`,
            detailsOf(selection, failures));
    }

    dispose(): void {
        this.#detach();
    }

    #detach(): void {
        for (const listener of this.#listeners.splice(0)) {
            listener.detach();
        }
        Interceptor.flush();
    }

    #select(pattern: RegExp, most: number): Selection {
        const selection: Selection = { targets: [], sharing: 0, withoutCode: 0, overCap: 0 };
        const addresses = new Set<string>();
        for (const target of this.#catalogOfMethods().filter(each => pattern.test(each.label))) {
            const address = target.method.virtualAddress;
            if (address.isNull()) {
                selection.withoutCode++;
            } else if (addresses.has(address.toString())) {
                selection.sharing++;
            } else if (selection.targets.length === most) {
                selection.overCap++;
            } else {
                addresses.add(address.toString());
                selection.targets.push(target);
            }
        }
        return selection;
    }

    #catalogOfMethods(): Target[] {
        if (this.#catalog === null) {
            this.#catalog = Il2Cpp.domain.assemblies.flatMap(assembly => assembly.image.classes.flatMap(klass => {
                const owner = klass.type.name;
                return klass.methods.map(method => ({ label: `${owner}::${method.name}`, method }));
            }));
        }
        return this.#catalog;
    }

    #attach({ label, method }: Target): InvocationListener {
        const shape = new CallShape(method);
        const log = this.#log;
        const values = this.#values;
        return Interceptor.attach(method.virtualAddress, {
            onEnter(args) {
                const call = log.admit(label);
                this.call = call;
                if (call !== null) {
                    call.args = describing(() => shape.describeArguments(this.context, args, values));
                    call.resultPointer = shape.resultPointerAt(this.context);
                    log.show(call, "…");
                }
            },
            onLeave(retval) {
                const call: Call | null = this.call;
                if (call !== null) {
                    log.show(call, describing(() => shape.describeResult(this.context, retval, call.resultPointer, values)));
                }
            },
        });
    }
}

function describing(describe: () => string): string {
    try {
        return describe();
    } catch (e) {
        return `(unreadable: ${(e as Error).message})`;
    }
}

function detailsOf(selection: Selection, failures: string[]): string {
    const notes = [
        (selection.sharing !== 0) ? `${selection.sharing} more share code with a traced one, which their calls are counted as` : null,
        (selection.withoutCode !== 0) ? `${selection.withoutCode} have no code of their own, such as abstract and generic definitions` : null,
        (selection.overCap !== 0) ? `${selection.overCap} over “Most methods traced” are left out` : null,
        (failures.length !== 0) ? `${failures.length} could not be hooked, the first ${failures[0]}` : null,
    ].filter(each => each !== null);
    return (notes.length === 0) ? "Every method that matched is traced." : `Of the others that matched, ${notes.join("; ")}.`;
}
