import { direct3D11 } from "./direct3d11.js";
import type { GraphicsBackendFactory } from "./graphics-backend.js";
import { metal } from "./metal.js";
import { darwinOpenGL } from "./opengl-darwin.js";
import { linuxOpenGL } from "./opengl-linux.js";
import { vulkan } from "./vulkan.js";

export const backends: GraphicsBackendFactory[] = [direct3D11, metal, vulkan, darwinOpenGL, linuxOpenGL];
