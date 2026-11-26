import { addressNumber } from "./address-space.js";
import { applyRegisterUpdate, emulationOf, type StoreEmulation } from "./store-emulation.js";
import { sameValue, type ValueType } from "./value-types.js";

const watchpointSlots = 4;
const stepBreakpoint = 0;
const arm64InstructionSize = 4;
const watchedDoubleword = 8;
const flushDelay = 100;
const machineContextOffset = 48;
const syndromeOffset = 8;
const vectorStateOffset = 288;
const exceptionClassShift = 26;
const watchpointClasses = new Set([0x34, 0x35]);
const breakpointClasses = new Set([0x30, 0x31]);

export interface LockRequest {
    address: NativePointer;
    type: ValueType;
    value: number;
    where: string;
}

export interface Lock {
    slot: number;
    address: NativePointer;
    start: number;
    type: ValueType;
    value: number;
    where: string;
    undone: number;
    state: "holding" | "lost";
    log: WriteLog;
}

export interface Writer {
    code: NativePointer;
    target: NativePointer;
    writes: number;
}

export type LockSupport =
    | { kind: "available" }
    | { kind: "unavailable"; reason: string };

export class LockError extends Error {
}

interface Step {
    code: NativePointer;
    resumeAt: number;
    slots: number[];
}

class WatchpointLocks {
    readonly #support: LockSupport = supportHere();
    readonly capacity = watchpointSlots;
    readonly #slots: (Lock | null)[] = new Array(watchpointSlots).fill(null);
    readonly #threads = new Map<ThreadId, StableThreadDetails>();
    readonly #steps = new Map<ThreadId, Step>();
    readonly #everLocked = new Set<number>();
    #tracking: "idle" | "tracking" = "idle";
    readonly #unloadSentinel = {};

    get active(): Lock[] {
        return this.#slots.filter(lock => lock !== null);
    }

    get free(): number {
        return this.#slots.filter(lock => lock === null).length;
    }

    lock(request: LockRequest, log: WriteLog): Lock {
        if (this.#support.kind === "unavailable") {
            throw new LockError(this.#support.reason);
        }
        const start = addressNumber(request.address);
        const existing = this.active.find(lock => lock.start === start && lock.type === request.type);
        if (existing !== undefined) {
            request.type.writeAt(request.address, request.value);
            existing.value = request.value;
            return existing;
        }
        this.#checkPlacement(start, request.type);
        const slot = this.#slots.indexOf(null);
        if (slot === -1) {
            throw new LockError(`All ${watchpointSlots} hardware watchpoints are in use. Unlock a value first.`);
        }
        this.#startTracking();
        request.type.writeAt(request.address, request.value);
        const lock: Lock = { slot, start, undone: 0, state: "holding", log, ...request };
        this.#armEverywhere(lock);
        this.#slots[slot] = lock;
        this.#everLocked.add(start);
        return lock;
    }

    unlock(lock: Lock): void {
        this.#slots[lock.slot] = null;
        for (const thread of this.#threads.values()) {
            whileThreadExists(thread, () => thread.unsetHardwareWatchpoint(lock.slot));
        }
    }

    #checkPlacement(start: number, type: ValueType): void {
        if ((start % watchedDoubleword) + type.size > watchedDoubleword) {
            throw new LockError("This value crosses an 8-byte boundary, which a hardware watchpoint cannot cover.");
        }
        const overlapping = this.active.find(lock => start < lock.start + lock.type.size && lock.start < start + type.size);
        if (overlapping !== undefined) {
            throw new LockError(`Lock ${overlapping.slot + 1} already holds these bytes as ${overlapping.type.name}.`);
        }
    }

    #startTracking(): void {
        if (this.#tracking === "tracking") {
            return;
        }
        this.#tracking = "tracking";
        for (const thread of Process.enumerateThreads()) {
            this.#threads.set(thread.id, thread);
        }
        Process.attachThreadObserver({
            onAdded: thread => {
                this.#threads.set(thread.id, thread);
                for (const lock of this.active) {
                    whileThreadExists(thread, () => arm(thread, lock));
                }
            },
            onRemoved: thread => {
                this.#threads.delete(thread.id);
                this.#steps.delete(thread.id);
            },
        });
        Process.setExceptionHandler(details => this.#onException(details));
        Script.bindWeak(this.#unloadSentinel, () => this.#disarmAll());
    }

    #armEverywhere(lock: Lock): void {
        const armed: StableThreadDetails[] = [];
        try {
            for (const thread of this.#threads.values()) {
                whileThreadExists(thread, () => arm(thread, lock));
                armed.push(thread);
            }
        } catch (e) {
            for (const thread of armed) {
                whileThreadExists(thread, () => thread.unsetHardwareWatchpoint(lock.slot));
            }
            throw new LockError(`Could not set a hardware watchpoint: ${(e as Error).message}`);
        }
    }

    #onException(details: ExceptionDetails): boolean {
        if (details.type !== "breakpoint") {
            return false;
        }
        const machineContext = details.nativeContext.add(machineContextOffset).readPointer();
        const exceptionClass = machineContext.add(syndromeOffset).readU32() >>> exceptionClassShift;
        const threadId = Process.getCurrentThreadId();
        if (watchpointClasses.has(exceptionClass)) {
            const faultAddress = addressNumber(machineContext.readPointer());
            return this.#onWatchpointHit(threadId, details, machineContext.add(vectorStateOffset), faultAddress);
        }
        if (breakpointClasses.has(exceptionClass)) {
            return this.#onStepped(threadId, details.address);
        }
        return false;
    }

    #disarmAll(): void {
        for (const thread of this.#threads.values()) {
            whileThreadExists(thread, () => {
                for (const lock of this.active) {
                    thread.unsetHardwareWatchpoint(lock.slot);
                }
                if (this.#steps.has(thread.id)) {
                    thread.unsetHardwareBreakpoint(stepBreakpoint);
                }
            });
        }
    }

    #onWatchpointHit(threadId: ThreadId, details: ExceptionDetails, vectors: NativePointer, faultAddress: number): boolean {
        const context = details.context as Arm64CpuContext;
        const emulation = emulationOf(details.address, context, vectors);
        if (emulation !== null && this.#touchesLock(emulation)) {
            this.#emulate(emulation, details.address, context);
            return true;
        }
        const lock = this.#lockNear(faultAddress);
        if (lock === null) {
            return this.#wasLocked(faultAddress);
        }
        this.#stepPast(threadId, details.address, lock);
        return true;
    }

    #touchesLock({ pieces }: StoreEmulation): boolean {
        return pieces.some(({ address, bytes }) => {
            const start = addressNumber(address);
            return bytes.some((_, i) => this.#lockHolding(start + i) !== null);
        });
    }

    #emulate(emulation: StoreEmulation, code: NativePointer, context: Arm64CpuContext): void {
        const intended = new Map<Lock, Map<number, number>>();
        for (const { address, bytes } of emulation.pieces) {
            const start = addressNumber(address);
            bytes.forEach((byte, i) => {
                const lock = this.#lockHolding(start + i);
                if (lock !== null) {
                    const bytesForLock = intended.get(lock) ?? new Map<number, number>();
                    bytesForLock.set(start + i, byte);
                    intended.set(lock, bytesForLock);
                } else {
                    address.add(i).writeU8(byte);
                }
            });
        }
        for (const [lock, bytes] of intended) {
            if ([...bytes].some(([at, byte]) => ptr(at).readU8() !== byte)) {
                lock.undone++;
            }
            lock.log.note(code, lock);
        }
        if (emulation.writeBack !== null) {
            applyRegisterUpdate(context, emulation.writeBack);
        }
        context.pc = code.add(arm64InstructionSize);
    }

    #lockHolding(address: number): Lock | null {
        return this.active.find(lock => address >= lock.start && address < lock.start + lock.type.size) ?? null;
    }

    #stepPast(threadId: ThreadId, code: NativePointer, lock: Lock): void {
        const thread = this.#threads.get(threadId)!;
        thread.unsetHardwareWatchpoint(lock.slot);
        let step = this.#steps.get(threadId);
        if (step === undefined) {
            const resumeAt = code.add(arm64InstructionSize);
            step = { code, resumeAt: addressNumber(resumeAt), slots: [] };
            thread.setHardwareBreakpoint(stepBreakpoint, resumeAt);
            this.#steps.set(threadId, step);
        }
        step.slots.push(lock.slot);
    }

    #onStepped(threadId: ThreadId, address: NativePointer): boolean {
        const step = this.#steps.get(threadId);
        if (step === undefined || addressNumber(address) !== step.resumeAt) {
            return false;
        }
        const thread = this.#threads.get(threadId)!;
        thread.unsetHardwareBreakpoint(stepBreakpoint);
        this.#steps.delete(threadId);
        for (const slot of step.slots) {
            const lock = this.#slots[slot];
            if (lock !== null) {
                hold(lock);
                lock.log.note(step.code, lock);
                arm(thread, lock);
            }
        }
        return true;
    }

    #lockNear(faultAddress: number): Lock | null {
        let nearest: Lock | null = null;
        for (const lock of this.active) {
            const distance = Math.abs(lock.start - faultAddress);
            if (distance < watchedDoubleword && (nearest === null || distance < Math.abs(nearest.start - faultAddress))) {
                nearest = lock;
            }
        }
        return nearest;
    }

    #wasLocked(faultAddress: number): boolean {
        for (const start of this.#everLocked) {
            if (Math.abs(start - faultAddress) < watchedDoubleword) {
                return true;
            }
        }
        return false;
    }
}

function supportHere(): LockSupport {
    if (Process.platform === "darwin" && Process.arch === "arm64") {
        return { kind: "available" };
    }
    return {
        kind: "unavailable",
        reason: `Locking uses hardware watchpoints, and how to step past a trapped write has only been worked out and tested for arm64 on `
            + `Apple platforms. This process is ${Process.platform} ${Process.arch}, so values cannot be locked here.`,
    };
}

function arm(thread: StableThreadDetails, lock: Lock): void {
    thread.setHardwareWatchpoint(lock.slot, lock.address, lock.type.size, "w");
}

function hold(lock: Lock): void {
    try {
        if (!sameValue(lock.type.readAt(lock.address), lock.value)) {
            lock.type.writeAt(lock.address, lock.value);
            lock.undone++;
        }
    } catch (e) {
        lock.state = "lost";
    }
}

function whileThreadExists(thread: StableThreadDetails, operation: () => void): void {
    try {
        operation();
    } catch (e) {
        if (Process.findThreadById(thread.id) !== null) {
            throw e;
        }
    }
}

export class WriteLog {
    readonly writers = new Map<string, Writer>();
    readonly #onChange: () => void;
    #flush: "idle" | "scheduled" = "idle";

    constructor(onChange: () => void) {
        this.#onChange = onChange;
    }

    note(code: NativePointer, lock: Lock): void {
        const key = `${code}:${lock.start}`;
        const writer = this.writers.get(key);
        if (writer !== undefined) {
            writer.writes++;
        } else {
            this.writers.set(key, { code, target: lock.address, writes: 1 });
        }
        this.#changed();
    }

    #changed(): void {
        if (this.#flush === "idle") {
            this.#flush = "scheduled";
            setTimeout(() => {
                this.#flush = "idle";
                this.#onChange();
            }, flushDelay);
        }
    }
}

export const watchpointLocks = new WatchpointLocks();
