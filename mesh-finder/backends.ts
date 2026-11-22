import type { GraphicsBackendFactory } from "./graphics-backend.js";
import { metal } from "./metal.js";
import { darwinOpenGL } from "./opengl-darwin.js";
import { linuxOpenGL } from "./opengl-linux.js";
import { vulkan } from "./vulkan.js";

export const backends: GraphicsBackendFactory[] = [metal, vulkan, darwinOpenGL, linuxOpenGL];
