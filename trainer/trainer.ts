import { RegionNames } from "./address-space.js";
import { readCandidates, CandidateSet, type CandidateTest } from "./candidates.js";
import { CommandError, parseCommand, type Command, type LockSelection, type Relation, type Rows } from "./commands.js";
import { matchLimit, scanMemory, TooManyMatches } from "./first-scan.js";
import { Cancelled, Job, type Phase } from "./job.js";
import { watchpointLocks, WriteLog, type Lock } from "./locks.js";
import type { Settings } from "./settings.js";
import { grouped, listLimit, type ListedCandidate, type TrainerView } from "./trainer-view.js";
import { queryFor, type ValueQuery } from "./value-query.js";
import { sameValue, type ValueType } from "./value-types.js";

type Responder = Pick<CustomInstrumentConsoleResponder, "output" | "error">;

interface Step {
    set: CandidateSet;
    label: string;
}

const helpText = [
    "Type the value you see, such as 100, to find where it is kept. Each time it changes, type the new value.",
    "  + or -        it went up or down since the last step; inc 5 or dec 13 says by how much",
    "  changed, same it changed, or stayed the same",
    "  set 999       write 999 to every listed row; set 3 999 writes row 3 only; rows can be 1,4 or 2-5",
    "  lock 3        hold row 3 where it is; lock 3 999 holds it at 999; lock with no rows holds every listed row",
    "  unlock 1      release lock 1; unlock alone releases them all",
    "  undo          go back one step",
    "  reset         forget everything and start over",
    "  stop          stop a scan that is running",
].join("\n");

const openingHint = "Type the value you see in the game, such as your health, and press Scan.\nType help for everything else.";

const phaseNames: Record<Phase, string> = { scanning: "scanning", reading: "reading candidates" };

const relationWords: Record<Relation, string> = {
    increased: "went up",
    decreased: "went down",
    changed: "changed",
    unchanged: "stayed the same",
};

export class Trainer {
    readonly #view: TrainerView;
    readonly #settings: Settings;
    #steps: Step[] = [];
    #job: Job | null = null;
    #jobPhase: Phase = "scanning";
    #regionNames: RegionNames | null = null;
    readonly #writeLog = new WriteLog(() => this.#showLocks());

    constructor(view: TrainerView, settings: Settings) {
        this.#view = view;
        this.#settings = settings;
        view.say(openingHint);
    }

    act(chosen: CustomInstrumentAction): void {
        switch (chosen.widget) {
            case "console":
                this.#view.clearConsole();
                return;
            case "writers":
                this.#forgetWriters();
                return;
        }
        if (this.#job !== null) {
            this.#view.complain(this.#busyMessage());
            return;
        }
        if (chosen.widget === "list") {
            this.#actOnCandidate(chosen.action, chosen.item, this.#viewResponder());
        } else {
            this.#actOnLock(chosen.action, chosen.item, this.#viewResponder());
        }
    }

    async input(text: string, respond: Responder): Promise<void> {
        let command: Command;
        try {
            command = parseCommand(text);
        } catch (e) {
            respond.error((e as CommandError).message);
            return;
        }
        if (this.#job !== null) {
            this.#answerWhileBusy(command, respond);
            return;
        }
        await this.#perform(command, respond);
    }

    dispose(): void {
        this.#job?.cancel();
        this.#releaseLocks();
    }

    #forgetWriters(): void {
        this.#writeLog.writers.clear();
        this.#view.clearWriters();
    }

    #actOnCandidate(action: "keep" | "discard" | "lock" | "memory", item: string, respond: Responder): void {
        const candidate = this.#view.listed.find(listed => listed.id === item);
        if (candidate === undefined) {
            respond.error("That row is no longer listed.");
            return;
        }
        switch (action) {
            case "keep":
                this.#narrowTo(this.#current!.only([candidate]), `keep row ${candidate.row}`, respond);
                break;
            case "discard":
                this.#narrowTo(this.#current!.without([candidate]), `discard row ${candidate.row}`, respond);
                break;
            case "lock":
                this.#lockRows([candidate], null, respond);
                break;
            case "memory":
                this.#view.showMemory(candidate.address);
                break;
        }
    }

    #actOnLock(action: "unlock" | "memory", item: string, respond: Responder): void {
        const lock = this.#ownLocks().find(own => String(own.slot) === item);
        if (lock === undefined) {
            return;
        }
        if (action === "unlock") {
            this.#unlock([lock], respond);
        } else {
            this.#view.showMemory(lock.address);
        }
    }

    #answerWhileBusy(command: Command, respond: Responder): void {
        if (command.kind === "stop") {
            this.#job!.cancel();
            respond.output("Stopping…");
        } else {
            respond.error(this.#busyMessage());
        }
    }

    async #perform(command: Command, respond: Responder): Promise<void> {
        switch (command.kind) {
            case "value":
                if (this.#current === null) {
                    await this.#firstScan(command.text, respond);
                } else {
                    await this.#narrow(command.text, valueTest(queryFor(command.text, this.#typesInPlay())), respond);
                }
                break;
            case "compare":
                await this.#narrow(describeRelation(command.relation, command.amount), relationTest(command.relation, command.amount),
                    respond);
                break;
            case "set":
                await this.#set(command.rows, command.value, respond);
                break;
            case "lock":
                this.#lockRows(this.#rowsOf(command.rows, respond), command.value, respond);
                break;
            case "unlock":
                this.#unlock(this.#locksOf(command.locks, respond), respond);
                break;
            case "undo":
                this.#undo(respond);
                break;
            case "reset":
                this.#reset(respond);
                break;
            case "list":
                await this.#refresh(respond);
                break;
            case "stop":
                respond.output("Nothing is running.");
                break;
            case "help":
                respond.output(helpText);
                break;
        }
    }

    #narrowTo(set: CandidateSet, label: string, respond: Responder): void {
        const before = this.#current!.count;
        this.#steps.push({ set, label });
        respond.output(`${label}: ${grouped(before)} → ${grouped(set.count)}. ${this.#guidance(set)}`);
        this.#showCandidates();
    }

    #lockRows(rows: ListedCandidate[], text: string | null, respond: Responder): void {
        for (const candidate of rows) {
            const value = (text !== null) ? Number(text) : candidate.value;
            if (!fits(candidate.type, value)) {
                respond.error(`Row ${candidate.row} is ${candidate.type.name} and cannot hold ${value}.`);
                continue;
            }
            try {
                const request = { address: candidate.address, type: candidate.type, value, where: candidate.where };
                const lock = watchpointLocks.lock(request, this.#writeLog);
                const what = `row ${candidate.row} (${candidate.address}, ${candidate.type.name})`;
                respond.output(`Lock ${lock.slot + 1} holds ${what} at ${value}. ${this.#freeWatchpoints()}`);
            } catch (e) {
                respond.error((e as Error).message);
                break;
            }
        }
        this.#showLocks();
    }

    #unlock(locks: Lock[], respond: Responder): void {
        for (const lock of locks) {
            watchpointLocks.unlock(lock);
            respond.output(`Lock ${lock.slot + 1} released ${lock.address} after undoing ${grouped(lock.undone)} writes.`);
        }
        this.#showLocks();
    }

    async #firstScan(text: string, respond: Responder): Promise<void> {
        const types = this.#settings.types;
        const query = queryFor(text, types);
        if (query.targets.length === 0) {
            respond.error(`${text} cannot be stored as ${typeList(types)}. Choose other types in the settings.`);
            return;
        }
        respond.output(`Looking for ${text} as ${typeList(query.targets.map(target => target.type))}…`);
        const started = Date.now();
        const set = await this.#run(respond, async job => {
            const scan = await scanMemory(query.targets, this.#settings.alignment, job);
            const found = await readCandidates(scan.blocks, valueTest(query), job);
            respond.output(`Scanned ${formatBytes(scan.scannedBytes)} in ${seconds(Date.now() - started)}.`);
            return found;
        });
        if (set === null) {
            return;
        }
        this.#regionNames = null;
        this.#steps.push({ set, label: text });
        respond.output(`${grouped(set.count)} candidates${breakdown(set)}. ${this.#guidance(set)}`);
        this.#showCandidates();
    }

    async #narrow(label: string, test: CandidateTest, respond: Responder): Promise<void> {
        const current = this.#current;
        if (current === null) {
            respond.error("Type the value you see first, such as 100.");
            return;
        }
        const set = await this.#run(respond, job => readCandidates(current.blocks, test, job));
        if (set === null) {
            return;
        }
        this.#steps.push({ set, label });
        respond.output(`${label}: ${grouped(current.count)} → ${grouped(set.count)}${breakdown(set)}. ${this.#guidance(set)}`);
        this.#showCandidates();
    }

    async #set(rows: Rows, text: string, respond: Responder): Promise<void> {
        const targets = this.#rowsOf(rows, respond);
        if (targets.length === 0) {
            return;
        }
        const value = Number(text);
        let written = 0;
        for (const candidate of targets) {
            if (!fits(candidate.type, value)) {
                respond.error(`Row ${candidate.row} is ${candidate.type.name} and cannot hold ${text}.`);
                continue;
            }
            const lock = this.#ownLocks().find(own => own.address.equals(candidate.address) && own.type === candidate.type);
            try {
                if (lock !== undefined) {
                    watchpointLocks.lock({ ...lock, value }, this.#writeLog);
                } else {
                    candidate.type.writeAt(candidate.address, value);
                }
                written++;
            } catch (e) {
                respond.error(`Row ${candidate.row} at ${candidate.address} cannot be written: ${(e as Error).message}`);
            }
        }
        if (written !== 0) {
            respond.output(`Wrote ${text} to ${written === 1 ? "1 address" : `${written} addresses`}.`);
        }
        this.#showLocks();
        await this.#refresh(respond);
    }

    #undo(respond: Responder): void {
        if (this.#steps.length <= 1) {
            respond.error((this.#steps.length === 0) ? "There is nothing to undo." : "That was the first scan. Type reset to start over.");
            return;
        }
        const undone = this.#steps.pop()!;
        respond.output(`Undid ${undone.label}: back to ${grouped(this.#current!.count)} candidates.`);
        this.#showCandidates();
    }

    #reset(respond: Responder): void {
        this.#releaseLocks();
        this.#steps = [];
        this.#regionNames = null;
        this.#forgetWriters();
        this.#view.clearCandidates();
        this.#showLocks();
        respond.output("Starting over. Type the value you see.");
    }

    async #refresh(respond: Responder): Promise<void> {
        const current = this.#current;
        if (current === null) {
            respond.output("No candidates yet. Type the value you see.");
            return;
        }
        const set = await this.#run(respond, job => readCandidates(current.blocks, () => true, job));
        if (set !== null) {
            this.#steps[this.#steps.length - 1].set = set;
            this.#showCandidates();
        }
    }

    #busyMessage(): string {
        return `Still ${phaseNames[this.#jobPhase]} (${Math.floor(this.#job!.progress * 100)}%). Type stop to stop.`;
    }

    #viewResponder(): Responder {
        return { output: text => this.#view.say(text), error: text => this.#view.complain(text) };
    }

    #releaseLocks(): void {
        for (const lock of this.#ownLocks()) {
            watchpointLocks.unlock(lock);
        }
    }

    #typesInPlay(): ValueType[] {
        return [...new Set(this.#current!.blocks.map(block => block.type))];
    }

    #rowsOf(rows: Rows, respond: Responder): ListedCandidate[] {
        const count = this.#current?.count ?? 0;
        if (count === 0 || count > listLimit) {
            respond.error((count === 0)
                ? "There are no candidates."
                : `There are ${grouped(count)} candidates. Narrow them down to ${listLimit} first.`);
            return [];
        }
        if (rows === "listed") {
            return this.#view.listed;
        }
        const chosen = rows.map(row => this.#view.listed[row - 1]);
        const missing = rows.filter((_row, index) => chosen[index] === undefined);
        if (missing.length !== 0) {
            respond.error(`There is no row ${missing.join(", ")}; rows run from 1 to ${this.#view.listed.length}.`);
            return [];
        }
        return chosen;
    }

    #locksOf(selection: LockSelection, respond: Responder): Lock[] {
        const own = this.#ownLocks();
        if (selection === "all") {
            if (own.length === 0) {
                respond.output("Nothing is locked.");
            }
            return own;
        }
        const chosen = own.filter(lock => selection.includes(lock.slot + 1));
        if (chosen.length !== selection.length) {
            respond.error(`Locked now: ${own.map(lock => lock.slot + 1).join(", ") || "nothing"}.`);
        }
        return chosen;
    }

    #freeWatchpoints(): string {
        return `${watchpointLocks.free} of ${watchpointLocks.capacity} watchpoints left.`;
    }

    async #run(respond: Responder, work: (job: Job) => Promise<CandidateSet>): Promise<CandidateSet | null> {
        const job = new Job((phase, fraction) => {
            this.#jobPhase = phase;
            this.#view.showProgress(phase, fraction);
        });
        this.#job = job;
        this.#jobPhase = "scanning";
        try {
            return await work(job);
        } catch (e) {
            if (e instanceof Cancelled) {
                respond.output("Stopped. Nothing changed.");
                this.#showCandidates();
                return null;
            }
            if (e instanceof TooManyMatches) {
                respond.error(`More than ${grouped(matchLimit)} places match. Wait until the value changes and type the new one, `
                    + "or look for fewer types in the settings.");
                this.#showCandidates();
                return null;
            }
            throw e;
        } finally {
            this.#job = null;
        }
    }

    #guidance(set: CandidateSet): string {
        if (set.count === 0) {
            return "Type undo to go back a step, or reset to start over.";
        }
        if (set.count > listLimit) {
            return "When the value changes, type the new one, or + - changed same.";
        }
        return (set.count === 1)
            ? "Listed below: set 999 changes it, lock holds it."
            : "Listed below: set 999 changes them all, set 2 999 changes row 2, lock 2 holds it.";
    }

    #showCandidates(): void {
        const current = this.#current;
        if (current === null) {
            this.#view.clearCandidates();
            return;
        }
        this.#view.showCandidates(current, this.#previous, () => this.#regionNames ??= new RegionNames());
    }

    #showLocks(): void {
        this.#view.showLocks(this.#ownLocks(), [...this.#writeLog.writers.values()]);
    }

    #ownLocks(): Lock[] {
        return watchpointLocks.active.filter(lock => lock.log === this.#writeLog);
    }

    get #current(): CandidateSet | null {
        return this.#steps.at(-1)?.set ?? null;
    }

    get #previous(): CandidateSet | null {
        return this.#steps.at(-2)?.set ?? null;
    }
}

function valueTest(query: ValueQuery): CandidateTest {
    const intervals = new Map(query.targets.map(target => [target.type, target.interval]));
    return (type, current) => intervals.get(type)?.contains(current) ?? false;
}

function describeRelation(relation: Relation, amount: string | null): string {
    return (amount !== null) ? `${relationWords[relation]} by ${amount}` : relationWords[relation];
}

function relationTest(relation: Relation, amount: string | null): CandidateTest {
    switch (relation) {
        case "increased":
            return (amount === null) ? (_type, current, previous) => current > previous : byAmount(Number(amount), amount);
        case "decreased":
            return (amount === null) ? (_type, current, previous) => current < previous : byAmount(-Number(amount), amount);
        case "changed":
            return (_type, current, previous) => !sameValue(current, previous);
        case "unchanged":
            return (_type, current, previous) => sameValue(current, previous);
    }
}

function byAmount(change: number, text: string): CandidateTest {
    const decimals = text.split(".")[1]?.length ?? 0;
    const tolerance = 0.5 * 10 ** -decimals;
    return (type, current, previous) => (type.numeric === "integer")
        ? current - previous === change
        : Math.abs(current - previous - change) <= tolerance;
}

function fits(type: ValueType, value: number): boolean {
    const whole = type.numeric === "real" || Number.isInteger(value);
    return whole && value >= type.lowest && value <= type.highest;
}

function typeList(types: ValueType[]): string {
    const names = types.map(type => type.name);
    return (names.length > 1) ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0];
}

function formatBytes(byteCount: number): string {
    const units = ["bytes", "KiB", "MiB", "GiB", "TiB"];
    let value = byteCount;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${(unit === 0) ? value : value.toFixed(1)} ${units[unit]}`;
}

function seconds(milliseconds: number): string {
    return `${(milliseconds / 1000).toFixed(1)} s`;
}

function breakdown(set: CandidateSet): string {
    const counts = [...set.countsByType()];
    if (counts.length < 2) {
        return (counts.length === 1) ? ` (${counts[0][0]})` : "";
    }
    return ` (${counts.map(([name, count]) => `${grouped(count)} ${name}`).join(", ")})`;
}
