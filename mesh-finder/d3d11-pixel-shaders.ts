import { DxbcChunk, DxbcHeader, ResourceBinding, ResourceDefinitions } from "./d3d11-shader-reflection.pat";

export type TextureNames = Map<number, string>;

const RESOURCE_DEFINITIONS = 0x46454452;
const SHADER_INPUT_TEXTURE = 2;

export class PixelShaders {
    readonly #textures = new Map<string, TextureNames | null>();

    learn(shader: NativePointer, bytecode: NativePointer): TextureNames | null {
        const names = textureNamesOf(bytecode);
        this.#textures.set(shader.toString(), names);
        return names;
    }

    texturesOf(shader: NativePointer): TextureNames | null {
        return this.#textures.get(shader.toString()) ?? null;
    }
}

function textureNamesOf(bytecode: NativePointer): TextureNames | null {
    const definitions = chunkOf(bytecode, RESOURCE_DEFINITIONS);
    return (definitions !== null) ? texturesDeclaredIn(definitions) : null;
}

function chunkOf(bytecode: NativePointer, fourCC: number): NativePointer | null {
    const header = DxbcHeader.at(bytecode);
    for (let i = 0; i !== header.chunkCount; i++) {
        const chunk = DxbcChunk.at(bytecode.add(bytecode.add(DxbcHeader.size + i * 4).readU32()));
        if (chunk.fourCC === fourCC) {
            return chunk.$address.add(DxbcChunk.size);
        }
    }
    return null;
}

function texturesDeclaredIn(definitions: NativePointer): TextureNames {
    const header = ResourceDefinitions.at(definitions);
    const names: TextureNames = new Map();
    for (let i = 0; i !== header.boundResourceCount; i++) {
        const binding = ResourceBinding.at(definitions.add(header.boundResourceOffset + i * ResourceBinding.size));
        if (binding.type !== SHADER_INPUT_TEXTURE) {
            continue;
        }
        const name = definitions.add(binding.nameOffset).readCString()!;
        for (let element = 0; element !== binding.bindCount; element++) {
            names.set(binding.bindPoint + element, (binding.bindCount > 1) ? `${name}[${element}]` : name);
        }
    }
    return names;
}
