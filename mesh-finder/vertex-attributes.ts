import type { AttributeFormat } from "./vertex-format.js";

export interface DescribedAttribute {
    location: number;
    format: AttributeFormat | null;
}

const positionNames = /pos|vert/i;
const otherAttributeNames = /norm|tex|uv|col|tan|bitan|weight|joint|bone/i;
const texcoordNames = /tex|uv/i;
const otherTexcoordNames = /[1-9]$|light|lm|detail|second/i;

export function positionAttribute<T extends DescribedAttribute>(attributes: T[], names: Map<number, string>): T | undefined {
    const usable = attributes.filter(attribute => attribute.format !== null && attribute.format.count >= 2);
    const nameOf = (attribute: T) => names.get(attribute.location) ?? "";
    const isOther = (attribute: T) => otherAttributeNames.test(nameOf(attribute));
    return usable.find(attribute => positionNames.test(nameOf(attribute)) && !isOther(attribute))
        ?? usable.find(attribute => attribute.location === 0 && !isOther(attribute))
        ?? usable.find(attribute => attribute.format!.count >= 3 && !isOther(attribute));
}

export function texcoordAttribute<T extends DescribedAttribute>(attributes: T[], names: Map<number, string>): T | undefined {
    const usable = attributes.filter(attribute => attribute.format !== null && attribute.format.count === 2);
    const nameOf = (attribute: T) => names.get(attribute.location) ?? "";
    return usable.find(attribute => texcoordNames.test(nameOf(attribute)) && !otherTexcoordNames.test(nameOf(attribute)))
        ?? usable.find(attribute => texcoordNames.test(nameOf(attribute)));
}
