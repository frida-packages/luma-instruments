import type { UnityApi } from "./unity-api.js";

export interface SceneSnapshot {
    lines: string[];
    tookMs: number;
}

export function snapshotScene(handle: number, api: UnityApi): SceneSnapshot | null {
    const started = Date.now();
    const roots = api.rootsOf(handle);
    if (roots === null) {
        return null;
    }
    const lines: string[] = [];
    for (const root of roots) {
        visit(root, 0, lines, api);
    }
    return { lines, tookMs: Date.now() - started };
}

function visit(gameObject: NativePointer, depth: number, lines: string[], api: UnityApi): void {
    lines.push(lineOf(gameObject, depth, api));
    for (const child of api.childrenOf(api.transformOf(gameObject))) {
        visit(api.gameObjectOf(child), depth + 1, lines, api);
    }
}

function lineOf(gameObject: NativePointer, depth: number, api: UnityApi): string {
    const activity = `${Number(api.isActiveSelf(gameObject))}${Number(api.isActiveInHierarchy(gameObject))}`;
    const components = api.componentsOf(gameObject).map(each => each.isNull() ? "Missing script" : api.classNameOf(each));
    return [
        depth,
        api.instanceIdOf(gameObject),
        activity,
        api.layerOf(gameObject),
        cellOf(api.tagOf(gameObject)),
        cellOf(api.nameOf(gameObject)),
        ...components,
    ].join("\t");
}

function cellOf(text: string): string {
    return text.replace(/[\t\r\n]/g, " ");
}
