import type { VertexStream } from "./graphics-backend.js";
import type { VertexSpan } from "./layout-guess.js";
import type { VertexLayout } from "./mesh.js";
import { formatSize, type AttributeFormat } from "./vertex-format.js";

type Reader = (view: DataView, at: number) => number;

interface Component {
    size: number;
    read: Reader;
}

interface Candidate extends Component {
    format: AttributeFormat;
}

const MOST_SAMPLED_VERTICES = 128;
const LARGEST_TEXCOORD = 1e4;
const SMALLEST_NONZERO_TEXCOORD = 1e-5;
const PLAUSIBLE_SHARE = 0.98;
const UNIT_TOLERANCE = 0.02;
const UNIT_SHARE = 0.9;
const VECTOR_COMPONENTS = 3;
const GUESS_CONFIDENCE = 0.6;

const float32: Component = { size: 4, read: (view, at) => view.getFloat32(at, true) };
const float16: Component = { size: 2, read: (view, at) => halfToFloat(view.getUint16(at, true)) };
const candidates: Candidate[] = [
    { ...float32, format: { component: "float32", count: 2 } },
    { ...float16, format: { component: "float16", count: 2 } },
];

export function guessTexcoords(stream: VertexStream, positions: VertexLayout, span: VertexSpan): VertexLayout | null {
    const { stride } = positions;
    const count = Math.min(span.last - span.first + 1, MOST_SAMPLED_VERTICES);
    const start = stream.offset + span.first * stride;
    const length = Math.min(count * stride, stream.buffer.byteLength - start);
    const sampled = Math.floor(length / stride);
    if (sampled < 2) {
        return null;
    }
    const view = new DataView(stream.buffer.read(start, sampled * stride));
    const taken = takenBytes(view, sampled, stride, positions);
    for (let offset = 0; offset + 4 <= stride; offset += 4) {
        for (const candidate of candidates) {
            const end = offset + formatSize(candidate.format);
            if (end <= stride && !overlaps(taken, offset, end) && looksLikeTexcoords(view, sampled, stride, offset, candidate)) {
                return {
                    stride,
                    offset,
                    format: candidate.format,
                    knowledge: "guessed",
                    confidence: GUESS_CONFIDENCE,
                    source: `guessed from the contents: the first ${candidate.format.component} pair after the positions `
                        + "and any normals that reads as texture coordinates",
                };
            }
        }
    }
    return null;
}

function takenBytes(view: DataView, count: number, stride: number, positions: VertexLayout): boolean[] {
    const taken = new Array<boolean>(stride).fill(false);
    taken.fill(true, positions.offset, positions.offset + formatSize(positions.format));
    for (let offset = 0; offset < stride; offset += 2) {
        for (const component of [float32, float16]) {
            const width = VECTOR_COMPONENTS * component.size;
            if (offset % component.size === 0 && offset + width <= stride && !overlaps(taken, offset, offset + width)
                    && holdsUnitVectors(view, count, stride, offset, component)) {
                const signed = offset + width + component.size <= stride && holdsSigns(view, count, stride, offset + width, component);
                taken.fill(true, offset, offset + width + (signed ? component.size : 0));
            }
        }
    }
    return taken;
}

function holdsUnitVectors(view: DataView, count: number, stride: number, offset: number, { size, read }: Component): boolean {
    let units = 0;
    for (let i = 0; i !== count; i++) {
        const at = i * stride + offset;
        const [x, y, z] = [read(view, at), read(view, at + size), read(view, at + 2 * size)];
        units += (Math.abs(Math.sqrt(x * x + y * y + z * z) - 1) <= UNIT_TOLERANCE) ? 1 : 0;
    }
    return units >= count * UNIT_SHARE;
}

function holdsSigns(view: DataView, count: number, stride: number, offset: number, { read }: Component): boolean {
    let signs = 0;
    for (let i = 0; i !== count; i++) {
        signs += (Math.abs(read(view, i * stride + offset)) === 1) ? 1 : 0;
    }
    return signs >= count * UNIT_SHARE;
}

function overlaps(taken: boolean[], start: number, end: number): boolean {
    return taken.slice(start, end).some(byte => byte);
}

function looksLikeTexcoords(view: DataView, count: number, stride: number, offset: number, { size, read }: Component): boolean {
    let plausible = 0;
    const firstU = read(view, offset);
    const firstV = read(view, offset + size);
    let varies = false;
    for (let i = 0; i !== count; i++) {
        const at = i * stride + offset;
        const [u, v] = [read(view, at), read(view, at + size)];
        plausible += (isPlausible(u) && isPlausible(v)) ? 1 : 0;
        varies ||= u !== firstU || v !== firstV;
    }
    return varies && plausible >= count * PLAUSIBLE_SHARE;
}

function isPlausible(value: number): boolean {
    const magnitude = Math.abs(value);
    return Number.isFinite(value) && magnitude <= LARGEST_TEXCOORD && (value === 0 || magnitude >= SMALLEST_NONZERO_TEXCOORD);
}

function halfToFloat(bits: number): number {
    const exponent = (bits >> 10) & 0x1f;
    const fraction = bits & 0x3ff;
    const sign = (bits & 0x8000) ? -1 : 1;
    if (exponent === 0) {
        return sign * fraction * 2 ** -24;
    }
    if (exponent === 0x1f) {
        return (fraction === 0) ? sign * Infinity : NaN;
    }
    return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}
