import type { CapturedTexture } from "./texture-catalog.js";

export type TextureRole = "base-color" | "normal" | "other";

export interface MeshTexture {
    slot: number;
    name: string | null;
    role: TextureRole;
    texture: CapturedTexture;
}

export interface SampledTexture {
    slot: number;
    name: string | null;
    texture: CapturedTexture;
}

const baseColorNames = /albedo|diff|base.?colou?r|main.?tex|colou?r|^(u_|s_|t_|g_)?tex(ture)?0?$|^(u_|s_|t_|g_)?sampler0?$/i;
const baseColorSuffixes = /^(albedo|diff|diffuse|basecolou?r|colou?r|col|maintex)$/i;
const normalNames = /norm|bump/i;
const otherNames = new RegExp("spec|rough|metal|occl|\\bao\\b|_ao|emiss|shadow|depth|light|mask|noise|detail|lut|env|cube|refl|height|disp"
    + "|probe|splat|ramp|fresnel|matcap|camera|opaque|(^|_)ms($|_)|white|black|gr[ae]y", "i");
const highDynamicRange = /float|bc6h/;

export function texturesOf(sampled: SampledTexture[]): MeshTexture[] {
    const baseColor = baseColorOf(sampled);
    return sampled.map(each => ({ ...each, role: roleOf(each, baseColor) }));
}

export function baseColorTexture(textures: MeshTexture[]): MeshTexture | undefined {
    return textures.find(each => each.role === "base-color");
}

function baseColorOf(sampled: SampledTexture[]): SampledTexture | undefined {
    const decodable = sampled.filter(each => each.texture.contents === "cpu-visible");
    return decodable.find(each => baseColorSuffixes.test(lastWordOf(each)))
        ?? decodable.find(each => isNamed(each, baseColorNames) && !isNamed(each, normalNames) && !isNamed(each, otherNames))
        ?? decodable.find(each => !isNamed(each, normalNames) && !isNamed(each, otherNames) && hasColor(each.texture));
}

function roleOf(texture: SampledTexture, baseColor: SampledTexture | undefined): TextureRole {
    if (texture === baseColor) {
        return "base-color";
    }
    return isNamed(texture, normalNames) ? "normal" : "other";
}

function lastWordOf(texture: SampledTexture): string {
    return calledOf(texture)?.split(/[^a-z0-9]+/i).filter(word => word !== "").pop() ?? "";
}

function isNamed(texture: SampledTexture, names: RegExp): boolean {
    const called = calledOf(texture);
    return called !== null && names.test(called);
}

function calledOf({ name, texture }: SampledTexture): string | null {
    return name ?? texture.label;
}

function hasColor(texture: CapturedTexture): boolean {
    return !/^(r8|a8|r16|r32|bc4|eacr11)/.test(texture.format!) && !highDynamicRange.test(texture.format!);
}
