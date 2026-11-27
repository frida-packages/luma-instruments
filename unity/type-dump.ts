import { Buffer } from "buffer";
import type { Writable } from "stream";

export interface DumpTotals {
    classes: number;
    bytes: number;
}

export function writeDump(file: Writable, assemblies: Il2Cpp.Assembly[]): DumpTotals {
    const totals: DumpTotals = { classes: 0, bytes: 0 };
    const write = (text: string) => {
        const piece = Buffer.from(text, "utf8");
        totals.bytes += piece.length;
        file.write(piece);
    };
    write(headerOf());
    for (const assembly of assemblies) {
        const classes = assembly.image.classes;
        write(`\n// Assembly: ${assembly.name}, ${classes.length} classes\n\n`);
        write(classes.map(klass => klass.toString()).join("\n\n") + "\n");
        totals.classes += classes.length;
    }
    file.end();
    return totals;
}

function headerOf(): string {
    const module = Il2Cpp.module;
    return [
        `// Unity ${Il2Cpp.unityVersion}, ${Il2Cpp.application.identifier} ${Il2Cpp.application.version}`,
        `// IL2CPP code in ${module.name}, based at ${module.base} when this was written`,
        "",
    ].join("\n");
}
