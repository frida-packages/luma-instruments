import { readValue } from "./bridge-internals.js";
import type { UnityApi } from "./unity-api.js";
import type { ValueText } from "./value-text.js";

export interface InspectedComponent {
    type: string;
    fields: InspectedField[];
}

export interface InspectedField {
    name: string;
    type: string;
    value: string;
    declaredBy: string;
}

const TRANSFORM_PROPERTIES = ["position", "localPosition", "localEulerAngles", "localScale"];

export function inspectGameObject(instanceId: number, api: UnityApi, values: ValueText): InspectedComponent[] | null {
    const gameObject = api.findObject(instanceId);
    if (gameObject === null || !api.isAlive(gameObject.handle)) {
        return null;
    }
    return api.componentsOf(gameObject.handle).map(component => inspectComponent(component, api, values));
}

function inspectComponent(component: NativePointer, api: UnityApi, values: ValueText): InspectedComponent {
    if (component.isNull()) {
        return { type: "Missing script", fields: [] };
    }
    const object = new Il2Cpp.Object(component);
    return {
        type: object.class.type.name,
        fields: [...propertiesOf(object, api, values), ...fieldsOf(object, api, values)],
    };
}

function propertiesOf(object: Il2Cpp.Object, api: UnityApi, values: ValueText): InspectedField[] {
    if (!object.class.isSubclassOf(api.transformClass, false) && !object.class.equals(api.transformClass)) {
        return [];
    }
    return TRANSFORM_PROPERTIES.map(name => {
        const getter = object.method<Il2Cpp.ValueType>(`get_${name}`);
        return { name, type: getter.returnType.name, value: values.of(getter.invoke(), getter.returnType), declaredBy: "property" };
    });
}

export function fieldsOf(object: Il2Cpp.Object, api: UnityApi, values: ValueText): InspectedField[] {
    const fields: InspectedField[] = [];
    for (let klass: Il2Cpp.Class | null = object.class; klass !== null && !api.isEngineBase(klass); klass = klass.parent) {
        for (const field of klass.fields.filter(each => !each.isStatic)) {
            fields.push({ name: field.name, type: field.type.name, value: fieldText(object, field, values), declaredBy: klass.type.name });
        }
    }
    return fields;
}

function fieldText(object: Il2Cpp.Object, field: Il2Cpp.Field, values: ValueText): string {
    try {
        return values.of(readValue(object.handle.add(field.offset), field.type), field.type);
    } catch (e) {
        return `(unreadable: ${(e as Error).message})`;
    }
}
