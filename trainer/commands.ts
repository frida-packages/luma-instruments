import { isNumber } from "./value-query.js";

export type Relation = "increased" | "decreased" | "changed" | "unchanged";
export type Rows = "listed" | number[];
export type LockSelection = "all" | number[];

export type Command =
    | { kind: "value"; text: string }
    | { kind: "compare"; relation: Relation; amount: string | null }
    | { kind: "set"; rows: Rows; value: string }
    | { kind: "lock"; rows: Rows; value: string | null }
    | { kind: "unlock"; locks: LockSelection }
    | { kind: "undo" }
    | { kind: "reset" }
    | { kind: "list" }
    | { kind: "stop" }
    | { kind: "help" };

export class CommandError extends Error {
}

const relationWords: Record<string, Relation> = {
    "+": "increased",
    "inc": "increased",
    "increased": "increased",
    "-": "decreased",
    "dec": "decreased",
    "decreased": "decreased",
    "!": "changed",
    "changed": "changed",
    "=": "unchanged",
    "same": "unchanged",
    "unchanged": "unchanged",
};

const plainWords: Record<string, Command> = {
    "undo": { kind: "undo" },
    "back": { kind: "undo" },
    "reset": { kind: "reset" },
    "new": { kind: "reset" },
    "list": { kind: "list" },
    "ls": { kind: "list" },
    "stop": { kind: "stop" },
    "help": { kind: "help" },
    "?": { kind: "help" },
};

export function parseCommand(text: string): Command {
    const words = text.trim().toLowerCase().split(/\s+/).filter(word => word.length !== 0);
    const [verb, ...rest] = words;
    if (verb === undefined) {
        return { kind: "help" };
    }
    if (isNumber(verb) && rest.length === 0) {
        return { kind: "value", text: verb };
    }
    const relation = relationWords[verb];
    if (relation !== undefined) {
        return { kind: "compare", relation, amount: amountOf(relation, rest) };
    }
    if (verb === "set") {
        return parseSet(rest);
    }
    if (verb === "lock") {
        return parseLock(rest);
    }
    if (verb === "unlock") {
        return { kind: "unlock", locks: (rest.length === 0 || rest[0] === "all") ? "all" : rowNumbers(rest.join("")) };
    }
    const plain = plainWords[verb];
    if (plain !== undefined && rest.length === 0) {
        return plain;
    }
    throw new CommandError(`Not understood: “${text.trim()}”. Type a number, or help.`);
}

function amountOf(relation: Relation, rest: string[]): string | null {
    if (rest.length === 0) {
        return null;
    }
    if (relation === "changed" || relation === "unchanged") {
        throw new CommandError(`“${relation}” takes nothing after it.`);
    }
    const [amount] = rest;
    if (rest.length !== 1 || !isNumber(amount) || amount.startsWith("-")) {
        const [example, movement] = (relation === "increased") ? ["inc 5", "went up"] : ["dec 13", "went down"];
        throw new CommandError(`Write it as “${example}”: by how much it ${movement}.`);
    }
    return amount;
}

function parseSet(rest: string[]): Command {
    if (rest.length === 1 && isNumber(rest[0])) {
        return { kind: "set", rows: "listed", value: rest[0] };
    }
    if (rest.length === 2 && isNumber(rest[1])) {
        return { kind: "set", rows: rowsOf(rest[0]), value: rest[1] };
    }
    throw new CommandError("Write it as “set 999” for every listed row, or “set 3 999” for row 3.");
}

function parseLock(rest: string[]): Command {
    if (rest.length === 0) {
        return { kind: "lock", rows: "listed", value: null };
    }
    if (rest.length <= 2 && (rest.length === 1 || isNumber(rest[1]))) {
        return { kind: "lock", rows: rowsOf(rest[0]), value: rest[1] ?? null };
    }
    throw new CommandError("Write it as “lock 3” to hold row 3 where it is, or “lock 3 999” to hold it at 999.");
}

function rowsOf(text: string): Rows {
    return (text === "all") ? "listed" : rowNumbers(text);
}

function rowNumbers(text: string): number[] {
    const rows: number[] = [];
    for (const part of text.split(",")) {
        const range = /^(\d+)(?:-(\d+))?$/.exec(part);
        if (range === null) {
            throw new CommandError(`“${part}” is not a row number. Rows are written like 3, 1,4 or 2-5.`);
        }
        const first = Number(range[1]);
        const last = Number(range[2] ?? range[1]);
        for (let row = first; row <= last; row++) {
            rows.push(row);
        }
    }
    return rows;
}
