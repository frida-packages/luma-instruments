export type PropertyListValue = string | number | boolean | PropertyListValue[] | { [key: string]: PropertyListValue };

export function readPropertyList(path: string): { [key: string]: PropertyListValue } | null {
    let text: string;
    try {
        text = File.readAllText(path);
    } catch (e) {
        return null;
    }
    if (!text.startsWith("<?xml")) {
        return null;
    }
    const tokens = new PropertyListTokens(text);
    tokens.skipTo("plist");
    return tokens.readValue() as { [key: string]: PropertyListValue };
}

class PropertyListTokens {
    readonly #text: string;
    readonly #pattern = /<(\/?)([a-z]+)[^>]*?(\/?)>([^<]*)/g;

    constructor(text: string) {
        this.#text = text;
    }

    skipTo(name: string): void {
        while (this.#next().name !== name) {
        }
    }

    readValue(): PropertyListValue {
        const token = this.#next();
        switch (token.name) {
            case "dict":
                return token.empty ? {} : this.#readDict();
            case "array":
                return token.empty ? [] : this.#readArray();
            case "string":
            case "data":
            case "date":
                return this.#readText(token);
            case "integer":
            case "real":
                return Number(this.#readText(token));
            case "true":
                return true;
            case "false":
                return false;
            default:
                throw new Error(`unexpected <${token.name}> in property list`);
        }
    }

    #readDict(): { [key: string]: PropertyListValue } {
        const dict: { [key: string]: PropertyListValue } = {};
        while (true) {
            const token = this.#next();
            if (token.closing) {
                return dict;
            }
            const key = this.#readText(token);
            dict[key] = this.readValue();
        }
    }

    #readArray(): PropertyListValue[] {
        const items: PropertyListValue[] = [];
        while (true) {
            const start = this.#pattern.lastIndex;
            const token = this.#next();
            if (token.closing) {
                return items;
            }
            this.#pattern.lastIndex = start;
            items.push(this.readValue());
        }
    }

    #readText(opening: Token): string {
        if (opening.empty) {
            return "";
        }
        this.#next();
        return unescape(opening.text);
    }

    #next(): Token {
        const match = this.#pattern.exec(this.#text);
        if (match === null) {
            throw new Error("property list ended early");
        }
        const [, closing, name, empty, text] = match;
        return { name, closing: closing === "/", empty: empty === "/", text };
    }
}

interface Token {
    name: string;
    closing: boolean;
    empty: boolean;
    text: string;
}

function unescape(text: string): string {
    return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
