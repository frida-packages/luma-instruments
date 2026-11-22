import type { GraphicsBackendFactory } from "./graphics-backend.js";
import { openGLLibraries } from "./graphics-libraries.js";
import { GLBackend, type GLFlavor, type GLPlatform } from "./opengl.js";

type ProcAddress = NativeFunction<NativePointer, [NativePointerValue]>;

const GL_VERSION = 0x1f02;
const CONTEXT_LIBRARY_CAPACITY = 8;
const ES_VERSION_PREFIX = "OpenGL ES";

export const linuxOpenGL: GraphicsBackendFactory = {
    api: "OpenGL",
    libraries: openGLLibraries.linux.triggers,
    activation: "while-loading",
    create: observer => new GLBackend(new LinuxGLPlatform(), observer),
};

export class LinuxGLPlatform implements GLPlatform {
    readonly shareGroupSource = `
typedef gpointer (* CurrentContext) (void);

extern CurrentContext context_getters[${CONTEXT_LIBRARY_CAPACITY}];

static gpointer current_share_group (void)
{
  guint i;
  for (i = 0; i != ${CONTEXT_LIBRARY_CAPACITY} && context_getters[i] != NULL; i++)
  {
    gpointer context = context_getters[i] ();
    if (context != NULL)
      return context;
  }
  return NULL;
}
`;
    readonly shareGroupSymbols: Record<string, NativePointer>;
    private readonly getters = Memory.alloc(CONTEXT_LIBRARY_CAPACITY * Process.pointerSize);
    private readonly apiLibraries: Module[] = [];
    private readonly procAddresses: ProcAddress[] = [];
    private readonly resolved = new Map<string, NativePointer | null>();
    private readonly modules: ModuleObserver;
    private librariesAdded: (() => void) | null = null;
    private getString: NativeFunction<NativePointer, [number]> | null = null;

    constructor() {
        for (let i = 0; i !== CONTEXT_LIBRARY_CAPACITY; i++) {
            this.getters.add(i * Process.pointerSize).writePointer(NULL);
        }
        this.shareGroupSymbols = { context_getters: this.getters };
        this.modules = Process.attachModuleObserver({ onAdded: module => this.consider(module) });
    }

    entryPoint(name: string): NativePointer | null {
        let entry = this.resolved.get(name);
        if (entry === undefined) {
            entry = this.hookTargets(name)[0] ?? null;
            if (entry !== null) {
                this.resolved.set(name, entry);
            }
        }
        return entry;
    }

    hookTargets(name: string): NativePointer[] {
        const nameString = Memory.allocUtf8String(name);
        const candidates = [
            ...this.apiLibraries.map(library => library.findExportByName(name)),
            ...this.procAddresses.map(procAddress => procAddress(nameString)),
        ];
        const targets = new Map<string, NativePointer>();
        for (const candidate of candidates) {
            if (candidate !== null && !candidate.isNull()) {
                targets.set(candidate.toString(), candidate);
            }
        }
        return [...targets.values()];
    }

    flavorOfCurrentContext(): GLFlavor {
        if (this.getString === null) {
            this.getString = new NativeFunction(this.entryPoint("glGetString")!, "pointer", ["uint32"]);
        }
        const version = this.getString(GL_VERSION);
        return (!version.isNull() && version.readUtf8String()!.startsWith(ES_VERSION_PREFIX)) ? "es" : "desktop";
    }

    watchLibraries(added: () => void): void {
        this.librariesAdded = added;
    }

    dispose(): void {
        this.modules.detach();
    }

    private consider(module: Module): void {
        let added = false;
        if (openGLLibraries.linux.api.test(module.name)) {
            this.apiLibraries.push(module);
            added = true;
        }
        for (const kind of openGLLibraries.linux.contexts) {
            const currentContext = kind.library.test(module.name) ? module.findExportByName(kind.currentContext) : null;
            const procAddress = (currentContext !== null) ? module.findExportByName(kind.procAddress) : null;
            if (procAddress !== null && this.procAddresses.length !== CONTEXT_LIBRARY_CAPACITY) {
                this.getters.add(this.procAddresses.length * Process.pointerSize).writePointer(currentContext!);
                this.procAddresses.push(new NativeFunction(procAddress, "pointer", ["pointer"]));
                added = true;
            }
        }
        if (added) {
            this.librariesAdded?.();
        }
    }
}
