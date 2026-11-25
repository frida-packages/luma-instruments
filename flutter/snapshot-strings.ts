export interface SnapshotStrings {
    strings: string[];
    packages: Map<string, number>;
    channelNames: string[];
}

export interface StringRegion {
    base: NativePointer;
    size: number;
}

const SHORTEST_STRING = 4;
const FIRST_PRINTABLE = 0x20;
const LAST_PRINTABLE = 0x7e;
const LONGEST_STRING = 512;
const LIBRARY_URIS = /package:[A-Za-z0-9_]+\/[A-Za-z0-9_./-]+?\.dart/g;
const CHARACTERS_PER_CONVERSION = 8192;
const CHANNEL_NAME = /^(?:flutter\/[\w.-]+|[a-z][\w-]*(?:\.[\w-]+)+\/[\w./-]+|dev\.flutter\.pigeon\.[\w.$-]+)$/;
const NOT_A_CHANNEL = /\.(?:dart|png|jpe?g|json|ttf|otf|frag|html?|js)$|^(?:https?|file|package|dart):|\/\//;

export function readSnapshotStrings(regions: StringRegion[]): SnapshotStrings {
    const runs = regions.flatMap(runsIn);
    const strings = runs.filter(text => text.length <= LONGEST_STRING);
    return { strings, packages: packagesIn(runs), channelNames: [...new Set(strings.filter(isChannelName))].sort() };
}

function runsIn(region: StringRegion): string[] {
    const bytes = new Uint8Array(region.base.readByteArray(region.size)!);
    const runs: string[] = [];
    let start = -1;
    for (let i = 0; i <= bytes.length; i++) {
        const byte = bytes[i];
        if (byte >= FIRST_PRINTABLE && byte <= LAST_PRINTABLE) {
            start = (start === -1) ? i : start;
        } else {
            if (start !== -1 && i - start >= SHORTEST_STRING) {
                runs.push(textOf(bytes.subarray(start, i)));
            }
            start = -1;
        }
    }
    return runs;
}

function textOf(bytes: Uint8Array): string {
    let text = "";
    for (let i = 0; i < bytes.length; i += CHARACTERS_PER_CONVERSION) {
        text += String.fromCharCode(...bytes.subarray(i, i + CHARACTERS_PER_CONVERSION));
    }
    return text;
}

function packagesIn(runs: string[]): Map<string, number> {
    const libraries = new Set(runs.flatMap(run => Array.from(run.matchAll(LIBRARY_URIS), match => match[0])));
    const packages = new Map<string, number>();
    for (const uri of libraries) {
        const name = uri.slice("package:".length, uri.indexOf("/"));
        packages.set(name, (packages.get(name) ?? 0) + 1);
    }
    return new Map([...packages].sort((a, b) => b[1] - a[1]));
}

function isChannelName(text: string): boolean {
    return CHANNEL_NAME.test(text) && !NOT_A_CHANNEL.test(text);
}
