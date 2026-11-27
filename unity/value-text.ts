import type { UnityApi } from "./unity-api.js";

const ELEMENTS_SHOWN = 8;

export class ValueText {
    readonly #api: UnityApi;
    #limit: number;

    constructor(api: UnityApi, limit: number) {
        this.#api = api;
        this.#limit = limit;
    }

    set limit(limit: number) {
        this.#limit = limit;
    }

    of(value: Il2Cpp.Method.ReturnType, type: Il2Cpp.Type): string {
        const text = this.#textOf(value, type);
        return (text.length > this.#limit) ? `${text.slice(0, this.#limit - 1)}…` : text;
    }

    #textOf(value: Il2Cpp.Method.ReturnType, type: Il2Cpp.Type): string {
        if (value === undefined) {
            return "";
        }
        if (typeof value === "number") {
            return numberText(value, type);
        }
        if (typeof value === "boolean" || value instanceof Int64 || value instanceof UInt64) {
            return value.toString();
        }
        if (value instanceof Il2Cpp.String) {
            return value.isNull() ? "null" : JSON.stringify(value.content);
        }
        if (value instanceof Il2Cpp.ValueType) {
            return this.#valueTypeText(value);
        }
        if (value instanceof Il2Cpp.Array) {
            return value.isNull() ? "null" : this.#arrayText(value);
        }
        if (value instanceof Il2Cpp.Object) {
            return value.isNull() ? "null" : this.#objectText(value);
        }
        if (value instanceof Il2Cpp.Reference || value instanceof Il2Cpp.Pointer) {
            return `${type.name} ${value.handle}`;
        }
        return value.toString();
    }

    #valueTypeText(value: Il2Cpp.ValueType): string {
        const klass = value.type.class;
        if (klass.isEnum) {
            return value.box().toString();
        }
        const fields = klass.fields.filter(field => !field.isStatic);
        const parts = fields.map(field => [field.name, this.#textOf(value.field(field.name).value, field.type)]);
        if (fields.every(field => field.type.isPrimitive)) {
            return `(${parts.map(([, text]) => text).join(", ")})`;
        }
        return `{ ${parts.map(([name, text]) => `${name}: ${text}`).join(", ")} }`;
    }

    #arrayText(array: Il2Cpp.Array): string {
        const shown = Array.from({ length: Math.min(array.length, ELEMENTS_SHOWN) }, (_, i) => this.#textOf(array.get(i), array.elementType));
        const more = (array.length > ELEMENTS_SHOWN) ? ", …" : "";
        return `${array.elementType.name}[${array.length}] [${shown.join(", ")}${more}]`;
    }

    #objectText(object: Il2Cpp.Object): string {
        const klass = object.class;
        if (klass.isValueType) {
            return this.#valueTypeText(object.unbox());
        }
        if (klass.isSubclassOf(this.#api.unityObjectClass, false)) {
            return this.#unityObjectText(object);
        }
        const count = klass.tryField<number>("_size") ?? klass.tryField<number>("_count");
        return (count === null) ? klass.type.name : `${klass.type.name}, ${object.field<number>(count.name).value} items`;
    }

    #unityObjectText(object: Il2Cpp.Object): string {
        const type = object.class.type.name;
        if (!this.#api.isAlive(object.handle)) {
            return `${type} (destroyed)`;
        }
        return `${type} ${JSON.stringify(this.#api.nameOf(object.handle))} #${this.#api.instanceIdOf(object.handle)}`;
    }
}

function numberText(value: number, type: Il2Cpp.Type): string {
    if (type.name === "System.Single") {
        return String(Number(value.toPrecision(7)));
    }
    return String(value);
}
