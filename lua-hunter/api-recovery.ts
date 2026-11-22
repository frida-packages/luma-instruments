import type { Flavor } from "./lua-flavor.js";
import type { LibraryFunction } from "./library-tables.js";
import { type ArgumentValue, type CallSite, callSitesOf } from "./machine-code.js";
import type { ModuleImage } from "./module-image.js";

export interface RecoveredApi {
    gettop: NativePointer;
    settop: NativePointer;
    tolstring: NativePointer;
    pcall: NativePointer;
    load: NativePointer;
}

type Pick = (sites: CallSite[]) => CallSite | undefined;

export function recoverApi(flavor: Flavor, library: LibraryFunction[], image: ModuleImage): RecoveredApi | null {
    const graph = new CallGraph(library);
    const recovered = {
        gettop: agreed(
            graph.callee("select", sites => sites[0]),
            graph.callee("print", sites => sites[0]),
        ),
        settop: agreed(
            graph.callee("print", sites => sites.find(site => integerAt(site, 1) === -2)),
            graph.callee("next", sites => sites.find(site => integerAt(site, 1) === 2)),
        ),
        tolstring: agreed(
            graph.callee("select", sites => sites.find(site => integerAt(site, 1) === 1 && integerAt(site, 2) === 0)),
            (flavor === "5.1")
                ? graph.callee("print", sites => sites.find(site => integerAt(site, 1) === -1 && integerAt(site, 2) === 0))
                : graph.callee("load", sites => sites[0]),
        ),
        pcall: agreed(
            graph.callee("pcall", sites => sites.find(site => integerAt(site, 2) === -1)),
            graph.callee("xpcall", sites => sites.find(site => integerAt(site, 2) === -1)),
        ),
        load: agreed(
            graph.callee("load", sites => sites.find(site => isCodeAt(image, site, 1) && integerAt(site, 2) === 0)),
            loaderBehindDofile(graph, image),
        ),
    };
    const addresses = Object.values(recovered);
    if (addresses.some(address => address === null || !image.isCode(address))) {
        return null;
    }
    if (new Set(addresses.map(address => address!.toString())).size !== addresses.length) {
        return null;
    }
    return recovered as RecoveredApi;
}

class CallGraph {
    private readonly cache = new Map<string, CallSite[]>();

    constructor(private readonly library: LibraryFunction[]) {
    }

    callee(name: string, pick: Pick): NativePointer | null {
        const address = this.library.find(candidate => candidate.name === name)?.address;
        return (address !== undefined) ? pick(this.sitesOf(address))?.target ?? null : null;
    }

    calleesOf(name: string): NativePointer[] {
        const address = this.library.find(candidate => candidate.name === name)?.address;
        return (address !== undefined) ? this.sitesOf(address).map(site => site.target) : [];
    }

    sitesOf(address: NativePointer): CallSite[] {
        const key = address.toString();
        let sites = this.cache.get(key);
        if (sites === undefined) {
            sites = callSitesOf(address);
            this.cache.set(key, sites);
        }
        return sites;
    }
}

function loaderBehindDofile(graph: CallGraph, image: ModuleImage): NativePointer | null {
    const loaders = new Set<string>();
    for (const callee of graph.calleesOf("dofile")) {
        const inner = graph.sitesOf(callee).find(site => isCodeAt(image, site, 1));
        if (inner !== undefined) {
            loaders.add(inner.target.toString());
        }
    }
    return (loaders.size === 1) ? ptr([...loaders][0]) : null;
}

function agreed(first: NativePointer | null, second: NativePointer | null): NativePointer | null {
    return (first !== null && second !== null && first.equals(second)) ? first : null;
}

function integerAt(site: CallSite, index: number): number | null {
    const value: ArgumentValue = site.argumentValues[index];
    return (value.kind === "integer") ? value.value : null;
}

function isCodeAt(image: ModuleImage, site: CallSite, index: number): boolean {
    const value = site.argumentValues[index];
    return value.kind === "address" && image.isCode(value.value);
}
