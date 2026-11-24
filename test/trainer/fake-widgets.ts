type Cells = Record<string, string>;

export interface Console {
    errors: string[];
    type(text: string): Promise<string[]>;
}

export class FakeWidgets {
    readonly #tables = new Map<string, Map<string, Cells>>();
    readonly #counters = new Map<string, number>();
    #hexBaseAddress: unknown = null;
    readonly appended: string[] = [];
    readonly cleared: string[] = [];
    readonly disabledActions = new Set<string>();

    context(): CustomInstrumentContext {
        return {
            emit: (value: unknown) => console.log("emit", JSON.stringify(value)),
            widget: (id: string) => this.#widget(id),
        } as unknown as CustomInstrumentContext;
    }

    console(handle: CustomInstrumentHandle): Console {
        const errors: string[] = [];
        return {
            errors,
            async type(text: string): Promise<string[]> {
                console.log(`> ${text}`);
                const replies: string[] = [];
                const started = Date.now();
                await handle.onConsoleInput!({ widget: "console", entryId: text, text }, {
                    output: (reply: string) => {
                        console.log(reply);
                        replies.push(reply);
                    },
                    error: (reply: string) => {
                        console.log(`error: ${reply}`);
                        errors.push(reply);
                        replies.push(reply);
                    },
                    value: () => {},
                    image: () => {},
                });
                console.log(`  (${Date.now() - started} ms)`);
                return replies;
            },
        };
    }

    listRows(): Cells[] {
        return this.tableRows("list");
    }

    counter(id: string): number {
        return this.#counters.get(id) ?? 0;
    }

    listRowId(row: string): string {
        return [...this.#tables.get("list")!].find(([, cells]) => cells.row === row)![0];
    }

    async act(handle: CustomInstrumentHandle, widget: string, action: string, item: string): Promise<void> {
        console.log(`action ${widget}.${action} ${item}`);
        await handle.onAction!({ widget, action, item } as CustomInstrumentAction);
    }

    async actOnWidget(handle: CustomInstrumentHandle, widget: string, action: string): Promise<void> {
        console.log(`action ${widget}.${action}`);
        await handle.onAction!({ widget, action } as CustomInstrumentAction);
    }

    hexBase(): unknown {
        return this.#hexBaseAddress;
    }

    tableRows(id: string): Cells[] {
        return [...this.#tables.get(id)!.values()];
    }

    #widget(id: string): unknown {
        const rows = new Map<string, Cells>();
        this.#tables.set(id, rows);
        return {
            setCounter: ({ value, unit, delta }: { value: number; unit?: string; delta?: number }) => {
                this.#counters.set(id, value);
                if (unit === "candidates") {
                    console.log(`  ${id}: ${value} ${unit} (${delta})`);
                }
            },
            upsertRow: ({ id: rowId, cells }: { id: string; cells: Cells }) => {
                rows.set(rowId, cells);
                console.log(`  ${id} | ${Object.values(cells).join(" | ")}`);
            },
            setHex: ({ bytes, baseAddress }: { bytes: ArrayBuffer; baseAddress: unknown }) => {
                this.#hexBaseAddress = baseAddress;
                console.log(`  ${id}: ${bytes.byteLength} bytes at ${baseAddress}`);
            },
            appendOutput: (text: string) => {
                this.appended.push(text);
                console.log(`  ${id}: ${text}`);
            },
            appendError: (text: string) => console.log(`  ${id} error: ${text}`),
            setActionEnabled: (action: string, enabled: boolean) => {
                if (enabled) {
                    this.disabledActions.delete(`${id}.${action}`);
                } else {
                    this.disabledActions.add(`${id}.${action}`);
                }
            },
            clear: () => {
                this.cleared.push(id);
                rows.clear();
                this.#counters.delete(id);
            },
        };
    }
}
