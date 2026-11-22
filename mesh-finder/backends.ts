import type { GraphicsBackendFactory } from "./graphics-backend.js";
import { metal } from "./metal.js";
import { darwinOpenGL } from "./opengl-darwin.js";

export const backends: GraphicsBackendFactory[] = [metal, darwinOpenGL];
