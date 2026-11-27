export type InputNames = Map<number, string>;

export interface SampledImage {
    set: number;
    binding: number;
    name: string | null;
}

export interface ShaderInterfaces {
    vertexInputs: Map<string, InputNames>;
    fragmentImages: Map<string, SampledImage[]>;
}

const SPIRV_MAGIC = 0x07230203;
const HEADER_WORDS = 5;
const FIRST_FULL_INTERFACE_VERSION = 0x00010400;
const OP_NAME = 5;
const OP_ENTRY_POINT = 15;
const OP_TYPE_IMAGE = 25;
const OP_TYPE_SAMPLED_IMAGE = 27;
const OP_TYPE_ARRAY = 28;
const OP_TYPE_RUNTIME_ARRAY = 29;
const OP_TYPE_POINTER = 32;
const OP_VARIABLE = 59;
const OP_DECORATE = 71;
const OP_FUNCTION = 54;
const VERTEX_EXECUTION_MODEL = 0;
const FRAGMENT_EXECUTION_MODEL = 4;
const UNIFORM_CONSTANT_STORAGE = 0;
const INPUT_STORAGE = 1;
const LOCATION_DECORATION = 30;
const BINDING_DECORATION = 33;
const DESCRIPTOR_SET_DECORATION = 34;
const STORAGE_IMAGE_SAMPLING = 2;
const sampledDimensions = new Set([1, 3]);
const typeOpcodes = new Set([OP_TYPE_IMAGE, OP_TYPE_SAMPLED_IMAGE, OP_TYPE_ARRAY, OP_TYPE_RUNTIME_ARRAY, OP_TYPE_POINTER]);

interface EntryPoint {
    model: number;
    name: string;
    interface: number[];
}

interface Module {
    entryPoints: EntryPoint[];
    names: Map<number, string>;
    decorations: Map<number, Map<number, number>>;
    types: Map<number, Uint32Array>;
    variables: Map<number, Variable>;
}

interface Variable {
    type: number;
    storage: number;
}

export function shaderInterfaces(code: ArrayBuffer): ShaderInterfaces {
    const words = new Uint32Array(code, 0, code.byteLength >> 2);
    const found: ShaderInterfaces = { vertexInputs: new Map(), fragmentImages: new Map() };
    if (words.length < HEADER_WORDS || words[0] !== SPIRV_MAGIC) {
        return found;
    }
    const module = parse(words);
    const listsAllGlobals = words[1] >= FIRST_FULL_INTERFACE_VERSION;
    for (const entryPoint of module.entryPoints) {
        if (entryPoint.model === VERTEX_EXECUTION_MODEL) {
            found.vertexInputs.set(entryPoint.name, inputNamesOf(module, entryPoint));
        } else if (entryPoint.model === FRAGMENT_EXECUTION_MODEL) {
            const candidates = listsAllGlobals ? entryPoint.interface : [...module.variables.keys()];
            found.fragmentImages.set(entryPoint.name, sampledImagesOf(module, candidates));
        }
    }
    return found;
}

function parse(words: Uint32Array): Module {
    const module: Module = { entryPoints: [], names: new Map(), decorations: new Map(), types: new Map(), variables: new Map() };
    for (let at = HEADER_WORDS; at < words.length;) {
        const opcode = words[at] & 0xffff;
        const length = words[at] >>> 16;
        if (length === 0 || opcode === OP_FUNCTION) {
            break;
        }
        const instruction = words.subarray(at, Math.min(at + length, words.length));
        const operands = instruction.subarray(1);
        if (opcode === OP_ENTRY_POINT) {
            const name = literalString(operands, 2);
            module.entryPoints.push({ model: operands[0], name: name.text, interface: Array.from(operands.subarray(2 + name.words)) });
        } else if (opcode === OP_NAME) {
            module.names.set(operands[0], literalString(operands, 1).text);
        } else if (opcode === OP_DECORATE) {
            decorationsOf(module, operands[0]).set(operands[1], operands[2]);
        } else if (typeOpcodes.has(opcode)) {
            module.types.set(operands[0], instruction);
        } else if (opcode === OP_VARIABLE) {
            module.variables.set(operands[1], { type: operands[0], storage: operands[2] });
        }
        at += length;
    }
    return module;
}

function inputNamesOf(module: Module, entryPoint: EntryPoint): InputNames {
    const inputNames: InputNames = new Map();
    for (const id of entryPoint.interface) {
        const location = module.decorations.get(id)?.get(LOCATION_DECORATION);
        const name = module.names.get(id);
        if (module.variables.get(id)?.storage === INPUT_STORAGE && location !== undefined && name !== undefined && name !== "") {
            inputNames.set(location, name);
        }
    }
    return inputNames;
}

function sampledImagesOf(module: Module, candidates: number[]): SampledImage[] {
    return candidates.flatMap(id => {
        const variable = module.variables.get(id);
        const decorations = module.decorations.get(id);
        const set = decorations?.get(DESCRIPTOR_SET_DECORATION);
        const binding = decorations?.get(BINDING_DECORATION);
        if (variable?.storage !== UNIFORM_CONSTANT_STORAGE || set === undefined || binding === undefined
            || !isSampledImage(module, pointeeOf(module, variable.type))) {
            return [];
        }
        const name = module.names.get(id);
        return [{ set, binding, name: (name !== undefined && name !== "") ? name : null }];
    });
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

function decorationsOf(module: Module, id: number): Map<number, number> {
    let decorations = module.decorations.get(id);
    if (decorations === undefined) {
        decorations = new Map();
        module.decorations.set(id, decorations);
    }
    return decorations;
}

function pointeeOf(module: Module, pointer: number): number {
    const type = module.types.get(pointer);
    return (type !== undefined && (type[0] & 0xffff) === OP_TYPE_POINTER) ? type[3] : 0;
}

function isSampledImage(module: Module, id: number): boolean {
    const type = module.types.get(id);
    switch ((type !== undefined) ? type[0] & 0xffff : 0) {
        case OP_TYPE_ARRAY:
        case OP_TYPE_RUNTIME_ARRAY:
        case OP_TYPE_SAMPLED_IMAGE:
            return isSampledImage(module, type![2]);
        case OP_TYPE_IMAGE:
            return sampledDimensions.has(type![3]) && type![7] !== STORAGE_IMAGE_SAMPLING;
        default:
            return false;
    }
}
