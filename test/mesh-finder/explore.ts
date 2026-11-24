/// <reference path="./luma.d.ts" />

import { instrument } from "../../mesh-finder/main.js";

interface Row {
    id: string;
    cells: Record<string, string>;
}

const EXPORTED_MESHES = 5;

const rows = new Map<string, Row>();
let lastOutput = "";

const ctx = {
    emit() {
    },
    widget(id: string) {
        return new Proxy({}, {
            get(_target, method: string) {
                return (...args: any[]) => {
                    if (id === "meshes" && method === "upsertRow") {
                        rows.set(args[0].id, args[0]);
                    } else if (id === "meshes" && method === "removeRow") {
                        rows.delete(args[0]);
                    } else if (id === "viewer") {
                        lastOutput = String(args[0]);
                        if (!lastOutput.startsWith("# ")) {
                            console.log(`${new Date().toISOString().slice(11, 23)} viewer.${method}: ${lastOutput}`);
                        }
                    }
                };
            },
        });
    },
} as unknown as CustomInstrumentContext;

const config: CustomInstrumentConfig = { settings: { watchDraws: true, guessUndrawn: true, minimumConfidence: 60, minimumVertices: 3 } };

rpc.exports = {
    async explore(out: string, seconds: number): Promise<void> {
        const started = Date.now();
        const handle = await instrument.create(ctx, config, {} as CustomInstrumentRestoredState);
        console.log(`created in ${Date.now() - started} ms`);
        await new Promise(resolve => setTimeout(resolve, seconds * 1000));

        const all = [...rows.values()];
        console.log(`\n${all.length} meshes shown:`);
        for (const row of all) {
            console.log(`  ${Object.values(row.cells).join(" | ")}`);
        }
        const largest = all.filter(row => /^\d+$/.test(row.cells.triangles))
            .sort((a, b) => Number(b.cells.triangles) - Number(a.cells.triangles))
            .slice(0, EXPORTED_MESHES);
        for (const row of largest) {
            lastOutput = "";
            handle.onAction!({ widget: "meshes", action: "obj", item: row.id });
            if (lastOutput.startsWith("# ")) {
                send({ type: "obj", path: `${out}/mesh${row.id}.obj`, text: lastOutput });
                console.log(`exported ${out}/mesh${row.id}.obj (${row.cells.triangles} triangles)`);
            }
        }
        const disposeStarted = Date.now();
        await handle.dispose!();
        console.log(`disposed in ${Date.now() - disposeStarted} ms`);
    },
};
