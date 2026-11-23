import { mostSampledPositions, samplePositions, type PositionSample } from "./geometry-kernels.js";
import type { GpuBuffer, VertexStream } from "./graphics-backend.js";
import { float32x3, float32x4, type PositionFormat } from "./vertex-format.js";

export interface GuessedLayout {
    slot: number;
    stride: number;
    offset: number;
    format: PositionFormat;
    confidence: number;
    reason: string;
}

export interface VertexSpan {
    first: number;
    last: number;
}

type Fit = "exact" | "loose";

const SMALLEST_STRIDE = 12;
const LARGEST_STRIDE = 256;
const SAMPLED_VERTICES_PER_LOOSE_STRIDE = 48;
const LAST_LOOSE_OFFSET = 28;
const LARGEST_COORDINATE = 1e6;
const SMALLEST_NONZERO_COORDINATE = 1e-30;
const TOLERATED_SPARE_VERTICES = 2;
const TOLERATED_SPARE_SHARE = 0.01;
const COMMON_STRIDE_LIMIT = 64;
const RARE_STRIDE_LIMIT = 128;
const HIGHEST_GUESS_CONFIDENCE = 0.95;

export function guessDrawLayout(streams: VertexStream[], span: VertexSpan): GuessedLayout | null {
    let best: GuessedLayout | null = null;
    for (const stream of streams) {
        if (stream.buffer.access !== "cpu-readable") {
            continue;
        }
        const available = stream.buffer.byteLength - stream.offset;
        const strides = (stream.stride !== null) ? [stream.stride] : feasibleStrides(available, span.last);
        const exact = strides.filter(stride => fitsTightly(available, stride, span.last + 1));
        const fit: Fit = (exact.length !== 0) ? "exact" : "loose";
        for (const stride of (fit === "exact") ? exact : strides) {
            const guess = assessStride(stream.buffer, stream.offset, stride, span, fit);
            if (guess !== null && (best === null || guess.confidence > best.confidence)) {
                best = { ...guess, slot: stream.slot };
            }
        }
    }
    return best;
}

export function guessBufferLayout(buffer: GpuBuffer, referencedVertices: number | null): GuessedLayout | null {
    const fit: Fit = (referencedVertices !== null) ? "exact" : "loose";
    const strides = (referencedVertices !== null) ? tightStrides(buffer.byteLength, referencedVertices) : wholeStrides(buffer.byteLength);
    let best: GuessedLayout | null = null;
    for (const stride of strides) {
        const vertexCount = referencedVertices ?? Math.floor(buffer.byteLength / stride);
        const guess = assessStride(buffer, 0, stride, { first: 0, last: vertexCount - 1 }, fit);
        if (guess !== null && (best === null || guess.confidence > best.confidence)) {
            best = guess;
        }
    }
    return best;
}

export function couldHoldVertices(length: number, vertexCount: number): boolean {
    return tightStrides(length, vertexCount).length !== 0;
}

function feasibleStrides(available: number, lastVertex: number): number[] {
    const largest = (lastVertex === 0) ? LARGEST_STRIDE : Math.min(LARGEST_STRIDE, Math.floor((available - SMALLEST_STRIDE) / lastVertex));
    const strides: number[] = [];
    for (let stride = SMALLEST_STRIDE; stride <= largest; stride += 4) {
        strides.push(stride);
    }
    return strides;
}

function tightStrides(length: number, vertexCount: number): number[] {
    const strides: number[] = [];
    const largest = Math.min(LARGEST_STRIDE, Math.floor(length / vertexCount / 4) * 4);
    for (let stride = largest; stride >= SMALLEST_STRIDE && fitsTightly(length, stride, vertexCount); stride -= 4) {
        if (length % stride === 0) {
            strides.push(stride);
        }
    }
    return strides;
}

function wholeStrides(length: number): number[] {
    const strides: number[] = [];
    for (let stride = SMALLEST_STRIDE; stride <= LARGEST_STRIDE && length / stride >= 2; stride += 4) {
        if (length % stride === 0) {
            strides.push(stride);
        }
    }
    return strides;
}

function fitsTightly(available: number, stride: number, vertexCount: number): boolean {
    const spare = Math.floor(available / stride) - vertexCount;
    return spare >= 0 && spare <= Math.max(TOLERATED_SPARE_VERTICES, vertexCount * TOLERATED_SPARE_SHARE);
}

function assessStride(buffer: GpuBuffer, base: number, stride: number, span: VertexSpan, fit: Fit): GuessedLayout | null {
    const sampleCount = Math.min(span.last - span.first + 1, (fit === "exact") ? mostSampledPositions : SAMPLED_VERTICES_PER_LOOSE_STRIDE);
    const lastOffset = (fit === "exact") ? stride - SMALLEST_STRIDE : Math.min(stride - SMALLEST_STRIDE, LAST_LOOSE_OFFSET);
    const sampleStart = base + span.first * stride;
    const tail = Math.min(stride, 16);
    const sampleLength = Math.min((sampleCount - 1) * stride + tail, buffer.byteLength - sampleStart);
    const lastStart = base + span.last * stride;
    if (sampleLength < SMALLEST_STRIDE || lastStart + SMALLEST_STRIDE > buffer.byteLength) {
        return null;
    }
    const samples = buffer.read(sampleStart, sampleLength);
    const lastVertex = new DataView(buffer.read(lastStart, Math.min(stride, buffer.byteLength - lastStart)));

    let best: GuessedLayout | null = null;
    for (let offset = 0; offset <= lastOffset; offset += 4) {
        if (offset + SMALLEST_STRIDE > lastVertex.byteLength || !plausibleTriple(lastVertex, 0, offset)) {
            continue;
        }
        const sample = samplePositions(samples, sampleCount, stride, offset);
        if (sample === null) {
            continue;
        }
        const confidence = confidenceOf(sample, stride, offset, fit);
        if (best === null || confidence > best.confidence) {
            best = {
                slot: 0,
                stride,
                offset,
                format: sample.homogeneous ? float32x4 : float32x3,
                confidence,
                reason: describeGuess(fit, stride, offset),
            };
        }
    }
    return best;
}

function confidenceOf(sample: PositionSample, stride: number, offset: number, fit: Fit): number {
    let score = 0.45;
    if (stride > COMMON_STRIDE_LIMIT) {
        score -= (stride > RARE_STRIDE_LIMIT) ? 0.3 : 0.15;
    }
    if (fit === "exact") {
        score += 0.2;
    }
    if (offset === 0) {
        score += 0.2;
    }
    if (sample.homogeneous) {
        score += 0.1;
    }
    if (sample.unitLength > 0.9) {
        score -= 0.35;
    }
    if (sample.zeros > 0.5) {
        score -= 0.3;
    }
    score += 0.15 * sample.continuity;
    return Math.max(0, Math.min(HIGHEST_GUESS_CONFIDENCE, score));
}

function describeGuess(fit: Fit, stride: number, offset: number): string {
    const fitNote = (fit === "exact")
        ? `the buffer holds exactly that many ${stride}-byte vertices`
        : `${stride}-byte vertices fit the buffer`;
    return `guessed from the contents: plausible positions at offset ${offset}, ${fitNote}`;
}

function plausibleTriple(view: DataView, vertexStart: number, offset: number): boolean {
    for (let component = 0; component !== 3; component++) {
        const value = view.getFloat32(vertexStart + offset + component * 4, true);
        const magnitude = Math.abs(value);
        if (!Number.isFinite(value) || magnitude > LARGEST_COORDINATE || (value !== 0 && magnitude < SMALLEST_NONZERO_COORDINATE)) {
            return false;
        }
    }
    return true;
}
