import { fieldsOf } from "./object-inspection.js";
import type { UnityApi } from "./unity-api.js";
import type { ValueText } from "./value-text.js";

type Responder = CustomInstrumentConsoleResponder;

const ELEMENTS_SHOWN = 64;
const DEEPEST = 2;

export function presentValue(value: unknown, respond: Responder, api: UnityApi, values: ValueText): void {
    if (value instanceof Il2Cpp.Class || value instanceof Il2Cpp.Method || value instanceof Il2Cpp.Field) {
        respond.output(value.toString());
        return;
    }
    respond.value(plainOf(value, 0, api, values));
}

function plainOf(value: unknown, depth: number, api: UnityApi, values: ValueText): unknown {
    if (value instanceof Il2Cpp.String) {
        return value.content;
    }
    if (value instanceof Il2Cpp.Array) {
        return value.isNull() ? null : arrayOf(value, depth, api, values);
    }
    if (value instanceof Il2Cpp.Object) {
        return value.isNull() ? null : objectOf(value, api, values);
    }
    if (value instanceof Il2Cpp.ValueType) {
        return objectOf(value.box(), api, values);
    }
    if (value instanceof Il2Cpp.Class || value instanceof Il2Cpp.Method || value instanceof Il2Cpp.Field) {
        return value.toString();
    }
    if (value instanceof Il2Cpp.Assembly) {
        return { assembly: value.name, classes: value.image.classCount };
    }
    if (Array.isArray(value)) {
        return value.slice(0, ELEMENTS_SHOWN).map(each => plainOf(each, depth + 1, api, values));
    }
    return value;
}

function arrayOf(array: Il2Cpp.Array, depth: number, api: UnityApi, values: ValueText): unknown {
    if (depth === DEEPEST) {
        return values.of(array, array.object.class.type);
    }
    return Array.from({ length: Math.min(array.length, ELEMENTS_SHOWN) }, (_, i) => plainOf(array.get(i), depth + 1, api, values));
}

function objectOf(object: Il2Cpp.Object, api: UnityApi, values: ValueText): Record<string, unknown> {
    const klass = object.class;
    const plain: Record<string, unknown> = { $type: klass.type.name, $handle: object.handle };
    if (klass.isSubclassOf(api.unityObjectClass, false) && api.isAlive(object.handle)) {
        plain.$name = api.nameOf(object.handle);
        plain.$instanceId = api.instanceIdOf(object.handle);
    }
    for (const field of fieldsOf(object, api, values)) {
        plain[field.name] = field.value;
    }
    return plain;
}
