import { baseColorTexture, type MeshTexture } from "./material.js";
import type { Mesh } from "./mesh.js";
import { meshTitle } from "./mesh-table.js";
import { fileStem } from "./obj-export.js";
import { decodedPixels, type CapturedTexture } from "./texture-catalog.js";
import { encodePng } from "./texture-kernels.js";
import type { Reply } from "./viewer-commands.js";

const PNG_MEDIA_TYPE = "image/png";
const PNG_EXTENSION = ".png";

export function offerPng(mesh: Mesh, slot: number | null, reply: Reply): void {
    const use = (slot !== null) ? mesh.textures.find(each => each.slot === slot) : baseColorTexture(mesh.textures) ?? mesh.textures[0];
    if (use === undefined) {
        reply.error((slot !== null)
            ? `${meshTitle(mesh)} has no texture in slot ${slot}.`
            : `${meshTitle(mesh)} was not seen drawn with any texture.`);
        return;
    }
    if (use.texture.contents !== "cpu-visible") {
        reply.error(`The texture of ${meshTitle(mesh)} in slot ${use.slot} has nothing to export; show the mesh to see why.`);
        return;
    }
    const name = fileStem(`${meshTitle(mesh)} ${textureStem(use)}`, PNG_EXTENSION) + PNG_EXTENSION;
    reply.file({ name, mediaType: PNG_MEDIA_TYPE, bytes: pngOf(use.texture) });
    reply.output(`Offered the texture of ${meshTitle(mesh)} in slot ${use.slot} for saving as ${name}.`);
}

export function textureStem(use: MeshTexture): string {
    return use.name ?? `texture ${use.slot}`;
}

export function pngOf(texture: CapturedTexture): ArrayBuffer {
    return encodePng(decodedPixels(texture), texture.width, texture.height);
}
