export type InputNames = Map<number, string>;

export type VertexInputNames = Map<string, InputNames>;

const SPIRV_MAGIC = 0x07230203;
const HEADER_WORDS = 5;
const OP_NAME = 5;
const OP_ENTRY_POINT = 15;
const OP_VARIABLE = 59;
const OP_DECORATE = 71;
const OP_FUNCTION = 54;
const VERTEX_EXECUTION_MODEL = 0;
const INPUT_STORAGE = 1;
const LOCATION_DECORATION = 30;

interface EntryPoint {
    name: string;
    interface: number[];
}

export function vertexInputNames(code: ArrayBuffer): VertexInputNames {
    const words = new Uint32Array(code, 0, code.byteLength >> 2);
    const found: VertexInputNames = new Map();
    if (words.length < HEADER_WORDS || words[0] !== SPIRV_MAGIC) {
        return found;
    }
    const entryPoints: EntryPoint[] = [];
    const names = new Map<number, string>();
    const locations = new Map<number, number>();
    const inputs = new Set<number>();
    for (let at = HEADER_WORDS; at < words.length;) {
        const opcode = words[at] & 0xffff;
        const length = words[at] >>> 16;
        if (length === 0 || opcode === OP_FUNCTION) {
            break;
        }
        const operands = words.subarray(at + 1, Math.min(at + length, words.length));
        if (opcode === OP_ENTRY_POINT && operands[0] === VERTEX_EXECUTION_MODEL) {
            const name = literalString(operands, 2);
            entryPoints.push({ name: name.text, interface: Array.from(operands.subarray(2 + name.words)) });
        } else if (opcode === OP_NAME) {
            names.set(operands[0], literalString(operands, 1).text);
        } else if (opcode === OP_DECORATE && operands[1] === LOCATION_DECORATION) {
            locations.set(operands[0], operands[2]);
        } else if (opcode === OP_VARIABLE && operands[2] === INPUT_STORAGE) {
            inputs.add(operands[1]);
        }
        at += length;
    }
    for (const entryPoint of entryPoints) {
        const inputNames: InputNames = new Map();
        for (const id of entryPoint.interface) {
            const location = locations.get(id);
            const name = names.get(id);
            if (inputs.has(id) && location !== undefined && name !== undefined && name !== "") {
                inputNames.set(location, name);
            }
        }
        found.set(entryPoint.name, inputNames);
    }
    return found;
}

function literalString(operands: Uint32Array, start: number): { text: string; words: number } {
    const bytes: number[] = [];
    for (let i = start; i < operands.length; i++) {
        for (let shift = 0; shift !== 32; shift += 8) {
            const byte = (operands[i] >>> shift) & 0xff;
            if (byte === 0) {
                return { text: String.fromCharCode(...bytes), words: i - start + 1 };
            }
            bytes.push(byte);
        }
    }
    return { text: String.fromCharCode(...bytes), words: operands.length - start };
}
