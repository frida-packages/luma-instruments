export type ValueTypeName = "byte" | "int16" | "int32" | "int64" | "float" | "double";
export type TypeSelection = CustomInstrumentFeatureMap["types"];
export type Numeric = "integer" | "real";
export type ValueArray = Uint8Array | Int16Array | Int32Array | Float32Array | Float64Array;

export interface ValueType {
    name: ValueTypeName;
    size: 1 | 2 | 4 | 8;
    numeric: Numeric;
    lowest: number;
    highest: number;
    createArray(length: number): ValueArray;
    read(view: DataView, offset: number): number;
    readAt(address: NativePointer): number;
    writeAt(address: NativePointer, value: number): void;
    bitsOf(value: number): bigint;
}

const scratch = new DataView(new ArrayBuffer(8));

const byte: ValueType = {
    name: "byte",
    size: 1,
    numeric: "integer",
    lowest: 0,
    highest: 0xff,
    createArray: length => new Uint8Array(length),
    read: (view, offset) => view.getUint8(offset),
    readAt: address => address.readU8(),
    writeAt: (address, value) => address.writeU8(value),
    bitsOf: value => BigInt(value),
};

const int16: ValueType = {
    name: "int16",
    size: 2,
    numeric: "integer",
    lowest: -0x8000,
    highest: 0x7fff,
    createArray: length => new Int16Array(length),
    read: (view, offset) => view.getInt16(offset, true),
    readAt: address => address.readS16(),
    writeAt: (address, value) => address.writeS16(value),
    bitsOf: value => BigInt.asUintN(16, BigInt(value)),
};

const int32: ValueType = {
    name: "int32",
    size: 4,
    numeric: "integer",
    lowest: -0x80000000,
    highest: 0x7fffffff,
    createArray: length => new Int32Array(length),
    read: (view, offset) => view.getInt32(offset, true),
    readAt: address => address.readS32(),
    writeAt: (address, value) => address.writeS32(value),
    bitsOf: value => BigInt.asUintN(32, BigInt(value)),
};

const int64: ValueType = {
    name: "int64",
    size: 8,
    numeric: "integer",
    lowest: Number.MIN_SAFE_INTEGER,
    highest: Number.MAX_SAFE_INTEGER,
    createArray: length => new Float64Array(length),
    read: (view, offset) => Number(view.getBigInt64(offset, true)),
    readAt: address => address.readS64().valueOf(),
    writeAt: (address, value) => address.writeS64(value),
    bitsOf: value => BigInt.asUintN(64, BigInt(value)),
};

const float: ValueType = {
    name: "float",
    size: 4,
    numeric: "real",
    lowest: -3.4028234663852886e38,
    highest: 3.4028234663852886e38,
    createArray: length => new Float32Array(length),
    read: (view, offset) => view.getFloat32(offset, true),
    readAt: address => address.readFloat(),
    writeAt: (address, value) => address.writeFloat(value),
    bitsOf: value => {
        scratch.setFloat32(0, value, true);
        return BigInt(scratch.getUint32(0, true));
    },
};

const double: ValueType = {
    name: "double",
    size: 8,
    numeric: "real",
    lowest: -Number.MAX_VALUE,
    highest: Number.MAX_VALUE,
    createArray: length => new Float64Array(length),
    read: (view, offset) => view.getFloat64(offset, true),
    readAt: address => address.readDouble(),
    writeAt: (address, value) => address.writeDouble(value),
    bitsOf: value => {
        scratch.setFloat64(0, value, true);
        return scratch.getBigUint64(0, true);
    },
};

const selections: Record<TypeSelection, ValueType[]> = {
    common: [int32, float, double],
    all: [byte, int16, int32, int64, float, double],
    byte: [byte],
    int16: [int16],
    int32: [int32],
    int64: [int64],
    float: [float],
    double: [double],
};

export function typesSelectedBy(selection: TypeSelection): ValueType[] {
    return selections[selection];
}

export function sameValue(a: number, b: number): boolean {
    return a === b || (a !== a && b !== b);
}
