/// <reference path="./luma.d.ts" />

import { findExistingTraffic } from "../../xpc-spy/existing-traffic.js";
import { xpcLayout } from "../../xpc-spy/xpc-layout.js";

const ROUNDS = 100;
const BLOCK_INVOKE = /_block_invoke|^invocation function for block in /;

const layout = xpcLayout();
console.log("layout", JSON.stringify(layout));

let failures = 0;
let connections = 0;
let eventInvokes = 0;
let replyInvokes = 0;
let longestPauseMs = 0;
let totalPauseMs = 0;
const notBlockCode: string[] = [];
const errors = new Set<string>();

const started = Date.now();
for (let round = 0; round !== ROUNDS; round++) {
    try {
        const traffic = findExistingTraffic(layout);
        connections += traffic.connections.length;
        const invokes = traffic.connections.flatMap(({ eventHandler }) => (eventHandler !== null) ? [eventHandler.invoke] : []);
        eventInvokes += invokes.length;
        replyInvokes += traffic.pendingReplies.length;
        longestPauseMs = Math.max(longestPauseMs, traffic.pauseMs);
        totalPauseMs += traffic.pauseMs;
        for (const invoke of [...invokes, ...traffic.pendingReplies.map(({ invoke }) => invoke)]) {
            const symbol = DebugSymbol.fromAddress(invoke);
            if (!BLOCK_INVOKE.test(symbol.name ?? "") || !symbol.address.equals(invoke)) {
                notBlockCode.push(symbol.toString());
            }
        }
    } catch (error) {
        failures++;
        errors.add((error as Error).message);
    }
}

console.log(`${ROUNDS} rounds in ${Date.now() - started} ms: ${failures} threw; ${connections} connections, ${eventInvokes} event invokes, `
    + `${replyInvokes} reply invokes, ${notBlockCode.length} invokes not at the start of a block's code; threads stopped for `
    + `${(totalPauseMs / (ROUNDS - failures)).toFixed(3)} ms on average, ${longestPauseMs.toFixed(3)} ms at most`);
for (const line of [...errors, ...notBlockCode.slice(0, 10)]) {
    console.log(line);
}
