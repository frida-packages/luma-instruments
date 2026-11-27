import type { StatusLine } from "./status-line.js";
import { writeDump } from "./type-dump.js";

type AssemblyWidget = CustomInstrumentWidgetMap["assemblies"];

export class AssemblyTable {
    readonly #widget: AssemblyWidget;
    readonly #status: StatusLine;

    constructor(widget: AssemblyWidget, status: StatusLine) {
        this.#widget = widget;
        this.#status = status;
        widget.clear();
    }

    show(): void {
        for (const assembly of sortedAssemblies()) {
            this.#widget.upsertRow({ id: assembly.name, cells: { name: assembly.name, classes: String(assembly.image.classCount) } });
        }
    }

    saveAll(offer: CustomInstrumentOfferFile): void {
        this.#save("dump.cs", sortedAssemblies(), offer);
    }

    saveOne(name: string, offer: CustomInstrumentOfferFile): void {
        this.#save(`${name}.cs`, [Il2Cpp.domain.assembly(name)], offer);
    }

    #save(fileName: string, assemblies: Il2Cpp.Assembly[], offer: CustomInstrumentOfferFile): void {
        const file = offer({ name: fileName, mediaType: "text/plain" });
        file.on("error", error => this.#status.note("dump", `${fileName} could not be offered: ${error.message}`));
        const { classes, bytes } = writeDump(file, assemblies);
        this.#status.note("dump", `Offered ${fileName}: ${classes} classes from ${assemblies.length} assembl${(assemblies.length === 1) ? "y" : "ies"}, ${sizeText(bytes)}`,
            "Each method's comment is its RVA, its address less the IL2CPP module's base.");
    }
}

function sortedAssemblies(): Il2Cpp.Assembly[] {
    return [...Il2Cpp.domain.assemblies].sort((a, b) => a.name.localeCompare(b.name));
}

function sizeText(bytes: number): string {
    return (bytes < 1024 * 1024) ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
