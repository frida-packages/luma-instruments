/// <reference path="./instrument-typings.d.ts" />

import { instrument } from "../../tls-plaintext/main.js";

const defaultSettings: CustomInstrumentSettingMap = {
    capturePayloads: true,
    chunkLimit: 4096,
};

const ctx = {
    emit(value: unknown) {
        console.log(`emit ${render(value)}`);
    },
    widget(id: string) {
        return new Proxy({}, {
            get(_target, method: string) {
                return (...args: unknown[]) => console.log(`widget ${id}.${method}(${args.map(render).join(", ")})`);
            },
        });
    },
} as unknown as CustomInstrumentContext;

const hookableExports = ["SSL_read", "SSL_read_ex", "SSL_write", "SSL_write_ex", "SSL_do_handshake", "SSL_free"];
const pristinePrologues = snapshotPrologues();
const handle = await instrument.create(ctx, { settings: defaultSettings }, {});

rpc.exports = {
    async configure(settings: CustomInstrumentSettingMap) {
        await handle.updateConfig?.({ settings });
    },
    async clear(widget: "sent" | "received" | "connections") {
        await handle.onAction!({ widget, action: "clear" });
    },
    async dispose() {
        await handle.dispose?.();
        const current = snapshotPrologues();
        for (const [name, bytes] of pristinePrologues) {
            console.log(`prologue ${name} ${current.get(name) === bytes ? "restored" : "CHANGED"}`);
        }
    },
};

function snapshotPrologues(): Map<string, string> {
    const prologues = new Map<string, string>();
    for (const module of Process.enumerateModules()) {
        for (const name of hookableExports) {
            const address = module.findExportByName(name);
            if (address !== null) {
                prologues.set(`${module.name}!${name}`, hexOf(address.readByteArray(16)!));
            }
        }
    }
    return prologues;
}

function hexOf(bytes: ArrayBuffer): string {
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

function render(value: unknown): string {
    return JSON.stringify(value, (_key, field) => field instanceof ArrayBuffer ? preview(field) : field);
}

function preview(bytes: ArrayBuffer): string {
    const text = Array.from(new Uint8Array(bytes), byte => byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : ".").join("");
    return `<${bytes.byteLength} bytes: ${text.slice(0, 96)}>`;
}
