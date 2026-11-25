/// <reference path="./instrument-typings.d.ts" />

import { type Decoded, decodeReply, decodeRequest } from "../../flutter/message-decoding.js";
import { summaryOf } from "../../flutter/value-text.js";

interface Case {
    name: string;
    bytes: number[];
    reply?: { to: number[] };
    unanswered?: boolean;
    expect: string;
}

const text = (value: string) => Array.from(value, character => character.charCodeAt(0));

const cases: Case[] = [
    { name: "standard call with a map", bytes: [7, 4, ...text("open"), 13, 1, 7, 1, ...text("a"), 3, 1, 0, 0, 0], expect: "call standard open({a: 1})" },
    { name: "aligned float64 in a call", bytes: [7, 1, ...text("f"), 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xf0, 0x3f], expect: "call standard f(1)" },
    { name: "two-byte size", bytes: [7, 254, 0x2c, 0x01, ...text("x".repeat(300))], expect: "value standard \"" },
    { name: "Pigeon list with a custom type", bytes: [12, 2, 7, 2, ...text("id"), 129, 12, 1, 3, 5, 0, 0, 0], expect: "value standard [\"id\", <type 129: 7 bytes undecoded>] partial" },
    { name: "Pigeon call", bytes: [7, 3, ...text("get"), 12, 1, 130, 1, 2], expect: "call standard get([<type 130: 2 bytes undecoded>]) partial" },
    { name: "success envelope keeps alignment", bytes: [7, 1, ...text("m"), 0], reply: { to: [0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xf8, 0x3f] }, expect: "success standard 1.5" },
    { name: "error envelope with stack trace", bytes: [7, 1, ...text("m"), 0], reply: { to: [1, 7, 1, ...text("E"), 7, 2, ...text("no"), 0, 7, 2, ...text("at")] }, expect: "error standard error E: \"no\"" },
    { name: "event", bytes: [0, 3, 2, 0, 0, 0], unanswered: true, expect: "success standard 2" },
    { name: "JSON call and envelope", bytes: text("{\"method\":\"go\",\"args\":[1]}"), reply: { to: text("[\"done\"]") }, expect: "success json \"done\"" },
    { name: "JSON message", bytes: text("{\"a\":[true,null]}"), expect: "value json {a: [true, null]}" },
    { name: "string message", bytes: text("AppLifecycleState.resumed"), expect: "value string \"AppLifecycleState.resumed\"" },
    { name: "binary", bytes: [0xde, 0xad, 0xbe, 0xef, 0x00], expect: "value binary Uint8List(5: de ad be ef 00)" },
    { name: "empty reply to a call", bytes: [7, 1, ...text("m"), 0], reply: { to: [] }, expect: "empty" },
];

let failures = 0;
for (const testCase of cases) {
    const request = decodeRequest(new Uint8Array(testCase.bytes), testCase.bytes.length, testCase.unanswered ?? false);
    const decoded = (testCase.reply !== undefined)
        ? decodeReply(new Uint8Array(testCase.reply.to), testCase.reply.to.length, request.decoded).decoded
        : request.decoded;
    const got = describe(decoded);
    const passed = got.startsWith(testCase.expect);
    failures += passed ? 0 : 1;
    console.log(`${passed ? "ok  " : "FAIL"} ${testCase.name}: ${got}`);
}
console.log(`${cases.length - failures} of ${cases.length} passed`);

rpc.exports = {
    failures: () => failures,
};

function describe(decoded: Decoded): string {
    if (decoded.form === "empty") {
        return "empty";
    }
    return `${decoded.form} ${decoded.codec} ${summaryOf(decoded, 200)}${decoded.partial ? " partial" : ""}`;
}
