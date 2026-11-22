import type { ValueType } from "./value-types.js";

export interface ValueQuery {
    text: string;
    targets: TypeTarget[];
}

export interface TypeTarget {
    type: ValueType;
    interval: Interval;
}

export type Bound = "inclusive" | "exclusive";

export interface MaskedBits {
    values: bigint[];
    mask: bigint;
}

const numberSyntax = /^-?(\d+(\.\d*)?|\.\d+)$/;

export function isNumber(text: string): boolean {
    return numberSyntax.test(text);
}

export function queryFor(text: string, types: ValueType[]): ValueQuery {
    const value = Number(text);
    const fraction = text.split(".")[1] ?? null;
    const targets: TypeTarget[] = [];
    for (const type of types) {
        const interval = (type.numeric === "integer") ? integerInterval(value, fraction) : realInterval(value, fraction);
        if (interval !== null && interval.high >= type.lowest && interval.low <= type.highest) {
            targets.push({ type, interval });
        }
    }
    return { text, targets };
}

function integerInterval(value: number, fraction: string | null): Interval | null {
    const whole = fraction === null || /^0*$/.test(fraction);
    return whole ? Interval.exactly(value) : null;
}

function realInterval(value: number, fraction: string | null): Interval {
    if (fraction !== null) {
        const halfStep = 0.5 * 10 ** -fraction.length;
        return new Interval(value - halfStep, value + halfStep, "inclusive", "inclusive");
    }
    return (value >= 0)
        ? new Interval(value - 0.5, value + 1, "inclusive", "exclusive")
        : new Interval(value - 1, value + 0.5, "exclusive", "inclusive");
}

export function maskedBitsOf({ type, interval }: TypeTarget): MaskedBits[] {
    if (type.numeric === "integer") {
        return [{ values: [type.bitsOf(interval.low)], mask: allOnes(type.size) }];
    }
    const ranges: [bigint, bigint][] = [];
    if (interval.high >= 0) {
        ranges.push([type.bitsOf(Math.max(interval.low, 0)), type.bitsOf(interval.high)]);
    }
    if (interval.low < 0) {
        ranges.push([type.bitsOf(Math.min(interval.high, -0)), type.bitsOf(interval.low)]);
    }
    return ranges.map(([first, last]) => coveringBits(first, last, type.size));
}

function coveringBits(first: bigint, last: bigint, size: number): MaskedBits {
    let freeBits = 0n;
    while ((last >> freeBits) - (first >> freeBits) > 1n) {
        freeBits++;
    }
    const mask = allOnes(size) ^ ((1n << freeBits) - 1n);
    const values = [...new Set([first & mask, last & mask])];
    return { values, mask };
}

function allOnes(size: number): bigint {
    return (1n << BigInt(size * 8)) - 1n;
}

export class Interval {
    constructor(
        readonly low: number,
        readonly high: number,
        readonly lowBound: Bound,
        readonly highBound: Bound,
    ) {
    }

    static exactly(value: number): Interval {
        return new Interval(value, value, "inclusive", "inclusive");
    }

    contains(value: number): boolean {
        const aboveLow = (this.lowBound === "inclusive") ? value >= this.low : value > this.low;
        const belowHigh = (this.highBound === "inclusive") ? value <= this.high : value < this.high;
        return aboveLow && belowHigh;
    }
}
