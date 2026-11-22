export type ComponentType = "float32" | "float16" | "snorm16" | "unorm16" | "sint16" | "uint16" | "snorm8" | "unorm8";

export interface PositionFormat {
    component: ComponentType;
    count: number;
}

export const componentTypes: ComponentType[] = ["float32", "float16", "snorm16", "unorm16", "sint16", "uint16", "snorm8", "unorm8"];

const componentSizes: Record<ComponentType, number> = {
    float32: 4,
    float16: 2,
    snorm16: 2,
    unorm16: 2,
    sint16: 2,
    uint16: 2,
    snorm8: 1,
    unorm8: 1,
};

export const float32x3: PositionFormat = { component: "float32", count: 3 };
export const float32x4: PositionFormat = { component: "float32", count: 4 };

export function positionFormat(component: ComponentType, count: number): PositionFormat | null {
    return (count >= 2 && count <= 4) ? { component, count } : null;
}

export function formatSize(format: PositionFormat): number {
    return componentSizes[format.component] * format.count;
}

export function formatName(format: PositionFormat): string {
    return `${format.component}x${format.count}`;
}
