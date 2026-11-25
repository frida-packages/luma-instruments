import { utf8Text } from "./utf8.js";

export class CustomValue {
    readonly type: number;
    readonly undecoded: Uint8Array;

    constructor(type: number, undecoded: Uint8Array) {
        this.type = type;
        this.undecoded = undecoded;
    }
}

export interface StandardReading {
    values: unknown[];
    complete: boolean;
    halted: boolean;
    decodedBytes: number;
}

const enum ValueType {
    Null = 0,
    True = 1,
    False = 2,
    Int32 = 3,
    Int64 = 4,
    LargeInt = 5,
    Float64 = 6,
    String = 7,
    Uint8List = 8,
    Int32List = 9,
    Int64List = 10,
    Float64List = 11,
    List = 12,
    Map = 13,
    Float32List = 14,
}

const FIRST_CUSTOM_TYPE = 128;
const TWO_BYTE_SIZE = 254;
const FOUR_BYTE_SIZE = 255;

export function readStandardValues(bytes: Uint8Array, count: number, start = 0): StandardReading {
    const reader = new StandardReader(bytes, start);
    const values: unknown[] = [];
    while (values.length < count && !reader.halted && !reader.atEnd) {
        values.push(reader.readValue());
    }
    const complete = values.length === count && reader.atEnd && !reader.halted;
    return { values, complete, halted: reader.halted, decodedBytes: reader.decodedBytes };
}

class StandardReader {
    halted = false;
    decodedBytes = 0;

    readonly #bytes: Uint8Array;
    readonly #view: DataView;
    #position = 0;

    constructor(bytes: Uint8Array, start: number) {
        this.#bytes = bytes;
        this.#position = start;
        this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    get atEnd(): boolean {
        return this.#position === this.#bytes.byteLength;
    }

    readValue(): unknown {
        const value = this.#readTypedValue();
        if (!this.halted) {
            this.decodedBytes = this.#position;
        }
        return value;
    }

    #readTypedValue(): unknown {
        const type = this.#readU8();
        switch (type) {
            case ValueType.Null:
                return null;
            case ValueType.True:
                return true;
            case ValueType.False:
                return false;
            case ValueType.Int32:
                return this.#readInt32();
            case ValueType.Int64:
                return this.#readInt64();
            case ValueType.LargeInt:
                return largeInt(this.#readString());
            case ValueType.Float64:
                this.#alignTo(8);
                return this.#readFloat64();
            case ValueType.String:
                return this.#readString();
            case ValueType.Uint8List:
                return this.#take(this.#readSize()).slice();
            case ValueType.Int32List:
                return new Int32Array(this.#alignedElements(this.#readSize(), 4));
            case ValueType.Int64List:
                return new BigInt64Array(this.#alignedElements(this.#readSize(), 8));
            case ValueType.Float64List:
                return new Float64Array(this.#alignedElements(this.#readSize(), 8));
            case ValueType.List:
                return this.#readList(this.#readSize());
            case ValueType.Map:
                return this.#readMap(this.#readSize());
            case ValueType.Float32List:
                return new Float32Array(this.#alignedElements(this.#readSize(), 4));
            default:
                return this.#haltAt(type);
        }
    }

    #readList(length: number): unknown[] {
        const list: unknown[] = [];
        while (list.length < length && !this.halted) {
            list.push(this.readValue());
        }
        return list;
    }

    #readMap(length: number): Map<unknown, unknown> {
        const map = new Map<unknown, unknown>();
        while (map.size < length && !this.halted) {
            const key = this.readValue();
            map.set(key, this.halted ? undefined : this.readValue());
        }
        return map;
    }

    #haltAt(type: number): CustomValue {
        if (type < FIRST_CUSTOM_TYPE) {
            throw new RangeError(`${type} is not a value type of the standard codec`);
        }
        this.halted = true;
        this.decodedBytes = this.#position - 1;
        const value = new CustomValue(type, this.#bytes.slice(this.#position));
        this.#position = this.#bytes.byteLength;
        return value;
    }

    #readSize(): number {
        const first = this.#readU8();
        if (first < TWO_BYTE_SIZE) {
            return first;
        }
        if (first === TWO_BYTE_SIZE) {
            return this.#view.getUint16(this.#advance(2), true);
        }
        return this.#view.getUint32(this.#advance(4), true);
    }

    #readString(): string {
        const text = utf8Text(this.#take(this.#readSize()));
        if (text === null) {
            throw new RangeError("a string that is not UTF-8");
        }
        return text;
    }

    #alignedElements(count: number, elementSize: number): ArrayBuffer {
        this.#alignTo(elementSize);
        return this.#take(count * elementSize).slice().buffer;
    }

    #alignTo(alignment: number): void {
        const misalignment = this.#position % alignment;
        if (misalignment !== 0) {
            this.#advance(alignment - misalignment);
        }
    }

    #readU8(): number {
        return this.#view.getUint8(this.#advance(1));
    }

    #readInt32(): number {
        return this.#view.getInt32(this.#advance(4), true);
    }

    #readInt64(): number | bigint {
        const value = this.#view.getBigInt64(this.#advance(8), true);
        return (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) ? Number(value) : value;
    }

    #readFloat64(): number {
        return this.#view.getFloat64(this.#advance(8), true);
    }

    #take(length: number): Uint8Array {
        const start = this.#advance(length);
        return this.#bytes.subarray(start, start + length);
    }

    #advance(length: number): number {
        const start = this.#position;
        if (start + length > this.#bytes.byteLength) {
            throw new RangeError("the message ends inside a value");
        }
        this.#position += length;
        return start;
    }
}

const HEX_INTEGER = /^-?[0-9a-f]+$/i;

function largeInt(hexDigits: string): bigint {
    if (!HEX_INTEGER.test(hexDigits)) {
        throw new RangeError("a large integer that is not hexadecimal");
    }
    return hexDigits.startsWith("-") ? -BigInt(`0x${hexDigits.slice(1)}`) : BigInt(`0x${hexDigits}`);
}
