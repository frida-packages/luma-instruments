import { type Flavor, threadTagOf } from "./lua-flavor.js";

export interface StateLayout {
    globalOffset: number;
    mainDistance: number;
}

export interface StatePair {
    main: NativePointer;
    global: NativePointer;
}

const MAX_MAIN_DISTANCE = 0x400;
const GLOBAL_STATE_SPAN = 0x800;
const GLOBAL_OFFSET_CANDIDATES = [1, 2, 3, 4, 5, 6].map(slot => slot * Process.pointerSize);

export function deriveLayout(flavor: Flavor, state: NativePointer): StateLayout | null {
    for (const globalOffset of GLOBAL_OFFSET_CANDIDATES) {
        const global = peekPointer(state.add(globalOffset));
        if (global === null || !isPointerAligned(global)) {
            continue;
        }
        for (let mainDistance = Process.pointerSize; mainDistance <= MAX_MAIN_DISTANCE; mainDistance += Process.pointerSize) {
            const layout = { globalOffset, mainDistance };
            if (isMainState(flavor, layout, global.sub(mainDistance), global)) {
                return layout;
            }
        }
    }
    return null;
}

export function pairOf(flavor: Flavor, layout: StateLayout, state: NativePointer): StatePair | null {
    const global = peekPointer(state.add(layout.globalOffset));
    if (global === null) {
        return null;
    }
    const main = global.sub(layout.mainDistance);
    return isThreadWithGlobal(flavor, layout, main, global) ? { main, global } : null;
}

export interface LocatedState {
    pair: StatePair;
    layout: StateLayout;
}

export function locateStateAround(flavor: Flavor, known: StateLayout | null, anchorSlot: NativePointer): LocatedState | null {
    return (known !== null) ? locateWithLayout(flavor, known, anchorSlot) : locateWithoutLayout(flavor, anchorSlot);
}

export function codePointersIn(global: NativePointer, isCode: (address: NativePointer) => boolean): NativePointer[] {
    const found: NativePointer[] = [];
    for (let offset = 0; offset < GLOBAL_STATE_SPAN; offset += Process.pointerSize) {
        const value = peekPointer(global.add(offset));
        if (value === null) {
            break;
        }
        if (isCode(value)) {
            found.push(value);
        }
    }
    return found;
}

function locateWithLayout(flavor: Flavor, layout: StateLayout, anchorSlot: NativePointer): LocatedState | null {
    for (let back = 0; back <= GLOBAL_STATE_SPAN; back += Process.pointerSize) {
        const global = anchorSlot.sub(back);
        const main = global.sub(layout.mainDistance);
        if (isMainState(flavor, layout, main, global)) {
            return { pair: { main, global }, layout };
        }
    }
    return null;
}

function locateWithoutLayout(flavor: Flavor, anchorSlot: NativePointer): LocatedState | null {
    const windowStart = anchorSlot.sub(GLOBAL_STATE_SPAN + MAX_MAIN_DISTANCE);
    for (let slot = windowStart; slot.compare(anchorSlot) < 0; slot = slot.add(Process.pointerSize)) {
        const global = peekPointer(slot);
        if (global === null || global.compare(slot) <= 0 || global.compare(anchorSlot) > 0
            || global.sub(slot).compare(ptr(MAX_MAIN_DISTANCE)) > 0) {
            continue;
        }
        for (const globalOffset of GLOBAL_OFFSET_CANDIDATES) {
            const main = slot.sub(globalOffset);
            const layout = { globalOffset, mainDistance: global.sub(main).toUInt32() };
            if (layout.mainDistance <= MAX_MAIN_DISTANCE && isMainState(flavor, layout, main, global)) {
                return { pair: { main, global }, layout };
            }
        }
    }
    return null;
}

function isMainState(flavor: Flavor, layout: StateLayout, main: NativePointer, global: NativePointer): boolean {
    return isThreadWithGlobal(flavor, layout, main, global) && globalStateRefersTo(global, main);
}

function isThreadWithGlobal(flavor: Flavor, layout: StateLayout, state: NativePointer, global: NativePointer): boolean {
    const tag = threadTagOf(flavor);
    const linked = peekPointer(state.add(layout.globalOffset));
    return linked !== null && linked.equals(global) && peekByte(state.add(tag.offset)) === tag.value;
}

function globalStateRefersTo(global: NativePointer, main: NativePointer): boolean {
    for (let offset = 0; offset < GLOBAL_STATE_SPAN; offset += Process.pointerSize) {
        const value = peekPointer(global.add(offset));
        if (value === null) {
            return false;
        }
        if (value.equals(main)) {
            return true;
        }
    }
    return false;
}

export function peekPointer(address: NativePointer): NativePointer | null {
    try {
        return address.readPointer().strip();
    } catch (e) {
        return null;
    }
}

function peekByte(address: NativePointer): number | null {
    try {
        return address.readU8();
    } catch (e) {
        return null;
    }
}

function isPointerAligned(address: NativePointer): boolean {
    return address.and(Process.pointerSize - 1).isNull();
}
