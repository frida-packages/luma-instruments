/// <reference path="./luma.d.ts" />

import { xpcClasses } from "../../xpc-spy/xpc.js";
import { findCandidates } from "../../xpc-spy/xpc-heap.js";
import { xpcLayout } from "../../xpc-spy/xpc-layout.js";

const mallocSize = new NativeFunction(Module.getGlobalExportByName("malloc_size"), "size_t", ["pointer"]);

const before = liveObjects();
const started = Date.now();
const layout = xpcLayout();
const tookMs = Date.now() - started;
const after = liveObjects();

console.log(`layout ${JSON.stringify(layout)} learned in ${tookMs} ms`);
for (const [kind, cls] of [["connections", xpcClasses.connection], ["requests awaiting a reply", xpcClasses.serializer]] as const) {
    const left = [...after].filter(object => object.startsWith(`${cls}:`) && !before.has(object));
    const count = [...before].filter(object => object.startsWith(`${cls}:`)).length;
    console.log(`${kind}: ${count} before, ${left.length} new after: ${(left.length === 0) ? "ok" : `WRONG ${left.join(", ")}`}`);
}

function liveObjects(): Set<string> {
    return new Set(findCandidates([xpcClasses.connection, xpcClasses.serializer])
        .filter(({ address }) => Number(mallocSize(address)) !== 0)
        .map(({ address, cls }) => `${cls}:${address}`));
}
