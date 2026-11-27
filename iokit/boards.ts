import { Tally } from "./tally.js";

export interface MethodRow {
    userClient: string;
    selector: number;
    calls: number;
    errors: number;
    totalUs: number;
    last: string;
}

export interface LookupRow {
    matching: string;
    via: string;
    times: number;
    result: string;
}

export interface PropertyRow {
    entry: string;
    key: string;
    times: number;
    value: string;
}

export type MethodBoard = Tally<"userClient" | "selector" | "calls" | "errors" | "meanUs" | "last", MethodRow>;
export type LookupBoard = Tally<"matching" | "via" | "times" | "result", LookupRow>;
export type PropertyBoard = Tally<"entry" | "key" | "times" | "value", PropertyRow>;

export function methodBoard(table: CustomInstrumentWidgetMap["methods"], restored: CustomInstrumentRestoredState["methods"]): MethodBoard {
    return new Tally(table, restored, {
        parse: cells => ({
            userClient: cells.userClient,
            selector: Number(cells.selector),
            calls: Number(cells.calls),
            errors: Number(cells.errors),
            totalUs: Number(cells.meanUs) * Number(cells.calls),
            last: cells.last,
        }),
        render: row => ({
            userClient: row.userClient,
            selector: String(row.selector),
            calls: String(row.calls),
            errors: String(row.errors),
            meanUs: (row.totalUs / row.calls).toFixed(1),
            last: row.last,
        }),
    });
}

export function lookupBoard(table: CustomInstrumentWidgetMap["lookups"], restored: CustomInstrumentRestoredState["lookups"]): LookupBoard {
    return new Tally(table, restored, {
        parse: cells => ({ ...cells, times: Number(cells.times) }),
        render: row => ({ ...row, times: String(row.times) }),
    });
}

export function propertyBoard(table: CustomInstrumentWidgetMap["properties"], restored: CustomInstrumentRestoredState["properties"]): PropertyBoard {
    return new Tally(table, restored, {
        parse: cells => ({ ...cells, times: Number(cells.times) }),
        render: row => ({ ...row, times: String(row.times) }),
    });
}
