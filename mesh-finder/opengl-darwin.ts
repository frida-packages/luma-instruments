import type { GraphicsBackendFactory } from "./graphics-backend.js";
import { openGLLibraries } from "./graphics-libraries.js";
import { GLBackend, type GLPlatform } from "./opengl.js";

const LIBRARY = "libGL.dylib";

export const darwinOpenGL: GraphicsBackendFactory = {
    api: "OpenGL",
    libraries: openGLLibraries.darwin,
    activation: "while-loading",
    create: observer => new GLBackend(darwinPlatform(), observer),
};

function darwinPlatform(): GLPlatform {
    const library = Process.getModuleByName(LIBRARY);
    const framework = Process.getModuleByName("OpenGL");
    const entryPoint = (name: string) => library.findExportByName(name);
    return {
        shareGroupSource: `
extern gpointer CGLGetCurrentContext (void);
extern gpointer CGLGetShareGroup (gpointer context);

static gpointer current_share_group (void)
{
  gpointer context = CGLGetCurrentContext ();
  return (context != NULL) ? CGLGetShareGroup (context) : NULL;
}
`,
        shareGroupSymbols: {
            CGLGetCurrentContext: framework.getExportByName("CGLGetCurrentContext"),
            CGLGetShareGroup: framework.getExportByName("CGLGetShareGroup"),
        },
        entryPoint,
        hookTargets(name) {
            const target = entryPoint(name);
            return (target !== null) ? [target] : [];
        },
        flavorOfCurrentContext: () => "desktop",
        watchLibraries() {
        },
        dispose() {
        },
    };
}
