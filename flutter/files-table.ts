import { type FlutterFile, sizeText } from "./flutter-files.js";

type FilesWidget = CustomInstrumentWidgetMap["files"];

export class FilesTable {
    readonly #widget: FilesWidget;
    #shown: FlutterFile[] = [];

    constructor(widget: FilesWidget) {
        this.#widget = widget;
    }

    show(files: FlutterFile[]): void {
        if (JSON.stringify(files) === JSON.stringify(this.#shown)) {
            return;
        }
        this.#shown = files;
        this.#widget.clear();
        for (const file of files) {
            this.#widget.upsertRow({ id: file.id, cells: { file: file.name, holds: file.holds, size: sizeText(file.size) } });
        }
    }

    find(id: string): FlutterFile | undefined {
        return this.#shown.find(file => file.id === id);
    }
}
