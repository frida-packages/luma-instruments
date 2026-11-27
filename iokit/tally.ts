export interface TallyLayout<Column extends string, Row> {
    parse(cells: Cells<Column>): Row;
    render(row: Row): Cells<Column>;
}

type Cells<Column extends string> = { [K in Column]: string };

export class Tally<Column extends string, Row> {
    readonly #table: CustomInstrumentTableWidget<Column>;
    readonly #layout: TallyLayout<Column, Row>;
    readonly #rows = new Map<string, Row>();
    readonly #changed = new Set<string>();

    constructor(table: CustomInstrumentTableWidget<Column>, restored: CustomInstrumentTableSnapshot<Column>,
            layout: TallyLayout<Column, Row>) {
        this.#table = table;
        this.#layout = layout;
        for (const { id, cells } of restored.rows) {
            this.#rows.set(id, layout.parse(cells));
        }
    }

    row(id: string, fresh: () => Row): Row {
        let row = this.#rows.get(id);
        if (row === undefined) {
            row = fresh();
            this.#rows.set(id, row);
        }
        this.#changed.add(id);
        return row;
    }

    publish(): void {
        for (const id of this.#changed) {
            this.#table.upsertRow({ id, cells: this.#layout.render(this.#rows.get(id)!) });
        }
        this.#changed.clear();
    }

    clear(): void {
        this.#rows.clear();
        this.#changed.clear();
        this.#table.clear();
    }
}
