export type UnityApi = ReturnType<typeof resolveUnityApi>;

export interface SceneFacts {
    handle: number;
    name: string;
    buildIndex: number;
    rootCount: number;
    isLoaded: boolean;
}

export function resolveUnityApi() {
    const core = Il2Cpp.domain.assembly("UnityEngine.CoreModule").image;
    const unityObject = core.class("UnityEngine.Object");
    const gameObject = core.class("UnityEngine.GameObject");
    const component = core.class("UnityEngine.Component");
    const transform = core.class("UnityEngine.Transform");
    const sceneManager = core.class("UnityEngine.SceneManagement.SceneManager");
    const engineBases = new Set(["UnityEngine.Object", "UnityEngine.Component", "UnityEngine.Behaviour", "UnityEngine.MonoBehaviour"]
        .map(name => core.class(name).handle.toString()));
    const cachedPtrOffset = unityObject.field("m_CachedPtr").offset;
    const componentType = component.type.object;
    const classNames = new Map<string, string>();

    const getName = instanceCall(unityObject.method("get_name"), "pointer");
    const getInstanceId = instanceCall(unityObject.method("GetInstanceID"), "int");
    const getActiveSelf = instanceCall(gameObject.method("get_activeSelf"), "bool");
    const getActiveInHierarchy = instanceCall(gameObject.method("get_activeInHierarchy"), "bool");
    const getLayer = instanceCall(gameObject.method("get_layer"), "int");
    const getTag = instanceCall(gameObject.method("get_tag"), "pointer");
    const getTransform = instanceCall(gameObject.method("get_transform"), "pointer");
    const getGameObject = instanceCall(component.method("get_gameObject"), "pointer");
    const getChildCount = instanceCall(transform.method("get_childCount"), "int");
    const getChildMethod = transform.method("GetChild");
    const getChild = new NativeFunction(getChildMethod.virtualAddress, "pointer", ["pointer", "int", "pointer"]);
    const getComponentsMethod = gameObject.method("GetComponentsInternal");
    const getComponents = new NativeFunction(getComponentsMethod.virtualAddress, "pointer",
        ["pointer", "pointer", "bool", "bool", "bool", "bool", "pointer", "pointer"]);
    const findObjectMethod = unityObject.method("FindObjectFromInstanceID");
    const findObject = new NativeFunction(findObjectMethod.virtualAddress, "pointer", ["int", "pointer"]);
    const frameCount = core.class("UnityEngine.Time").method<number>("get_frameCount");

    return {
        pump: core.class("UnityEngine.UnitySynchronizationContext").method("ExecuteTasks").virtualAddress,
        sceneEvents: ["Internal_SceneLoaded", "Internal_SceneUnloaded", "Internal_ActiveSceneChanged"]
            .map(name => sceneManager.method(name).virtualAddress),
        unityObjectClass: unityObject,
        transformClass: transform,
        frameCount: () => frameCount.invoke(),
        scenes: () => scenesOf(sceneManager),
        activeSceneHandle: () => sceneManager.method<Il2Cpp.ValueType>("GetActiveScene").invoke().box().method<number>("get_handle").invoke(),
        rootsOf: (handle: number) => rootsOf(sceneManager, handle),
        nameOf: (object: NativePointer) => stringAt(getName(object)),
        instanceIdOf: (object: NativePointer) => getInstanceId(object),
        isAlive: (object: NativePointer) => !object.add(cachedPtrOffset).readPointer().isNull(),
        isActiveSelf: (gameObject: NativePointer) => getActiveSelf(gameObject) !== 0,
        isActiveInHierarchy: (gameObject: NativePointer) => getActiveInHierarchy(gameObject) !== 0,
        layerOf: (gameObject: NativePointer) => getLayer(gameObject),
        tagOf: (gameObject: NativePointer) => stringAt(getTag(gameObject)),
        transformOf: (gameObject: NativePointer) => getTransform(gameObject),
        gameObjectOf: (component: NativePointer) => getGameObject(component),
        childrenOf(transform: NativePointer): NativePointer[] {
            const count = getChildCount(transform);
            return Array.from({ length: count }, (_, i) => getChild(transform, i, getChildMethod.handle));
        },
        componentsOf(gameObject: NativePointer): NativePointer[] {
            const array = new Il2Cpp.Array<Il2Cpp.Object>(getComponents(gameObject, componentType, 1, 0, 1, 0, NULL, getComponentsMethod.handle));
            return Array.from(array, each => each.handle);
        },
        classNameOf(object: NativePointer): string {
            const klass = object.readPointer().toString();
            let name = classNames.get(klass);
            if (name === undefined) {
                name = new Il2Cpp.Object(object).class.type.name;
                classNames.set(klass, name);
            }
            return name;
        },
        isEngineBase: (klass: Il2Cpp.Class) => engineBases.has(klass.handle.toString()),
        findObject(instanceId: number): Il2Cpp.Object | null {
            return new Il2Cpp.Object(findObject(instanceId, findObjectMethod.handle)).asNullable();
        },
    };
}

function instanceCall<R extends "pointer" | "bool" | "int">(method: Il2Cpp.Method, returnType: R) {
    const call = new NativeFunction(method.virtualAddress, returnType, ["pointer", "pointer"]);
    return (target: NativePointer) => call(target, method.handle);
}

function scenesOf(sceneManager: Il2Cpp.Class): SceneFacts[] {
    const count = sceneManager.method<number>("get_sceneCount").invoke();
    return Array.from({ length: count }, (_, i) => {
        const scene = sceneManager.method<Il2Cpp.ValueType>("GetSceneAt").invoke(i).box();
        return {
            handle: scene.method<number>("get_handle").invoke(),
            name: scene.method<Il2Cpp.String>("get_name").invoke().content ?? "",
            buildIndex: scene.method<number>("get_buildIndex").invoke(),
            rootCount: scene.method<number>("get_rootCount").invoke(),
            isLoaded: scene.method<boolean>("get_isLoaded").invoke(),
        };
    });
}

function rootsOf(sceneManager: Il2Cpp.Class, handle: number): NativePointer[] | null {
    const count = sceneManager.method<number>("get_sceneCount").invoke();
    for (let i = 0; i !== count; i++) {
        const scene = sceneManager.method<Il2Cpp.ValueType>("GetSceneAt").invoke(i).box();
        if (scene.method<number>("get_handle").invoke() === handle) {
            const roots = scene.method<Il2Cpp.Array<Il2Cpp.Object>>("GetRootGameObjects", 0).invoke();
            return Array.from(roots, each => each.handle);
        }
    }
    return null;
}

function stringAt(pointer: NativePointer): string {
    return new Il2Cpp.String(pointer).content ?? "";
}
