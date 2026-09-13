import { BufferAttribute, BufferGeometry } from 'three';
import { MeshoptSimplifier, type Flags } from 'meshoptimizer/simplifier';

/** Flags accepted by the optional Meshoptimizer simplifier. */
export type MeshoptimizerSimplifyFlag = Flags;

export interface IMeshoptimizerSimplifyOptions {
  /** Fraction of the original triangle indices to remove, from 0 to 0.95. */
  readonly ratio?: number;
  /** Target index count. When supplied, this takes precedence over `ratio`. */
  readonly targetIndexCount?: number;
  /** Relative geometric error in the [0, 1] Meshoptimizer range. */
  readonly targetError?: number;
  /** Optional per-vertex locks for semantic features such as ridges or rivers. */
  readonly lockedVertices?: Uint8Array;
  readonly flags?: readonly MeshoptimizerSimplifyFlag[];
}

export interface IMeshoptimizerSimplifyResult {
  /** A clone of the input geometry with a reduced index buffer. */
  readonly geometry: BufferGeometry;
  readonly sourceIndexCount: number;
  readonly requestedIndexCount: number;
  readonly indexCount: number;
  /** Relative appearance error reported by Meshoptimizer. */
  readonly error: number;
}

/** Resolves when the optional Meshoptimizer WASM simplifier is ready. */
export function meshoptimizerReady(): Promise<void> {
  if (!MeshoptSimplifier.supported) {
    return Promise.reject(new Error('Meshoptimizer requires WebAssembly support.'));
  }
  return MeshoptSimplifier.ready;
}

/**
 * Simplifies an indexed Three.js geometry while preserving its existing
 * vertex attributes. This reduces the index buffer; it intentionally leaves
 * unused vertices in place so callers can choose their own attribute-compaction
 * and ownership strategy.
 */
export async function simplifyIndexedGeometry(
  source: BufferGeometry,
  options: IMeshoptimizerSimplifyOptions = {},
): Promise<IMeshoptimizerSimplifyResult> {
  const index = source.index;
  const position = source.getAttribute('position');
  if (!index) throw new Error('Meshoptimizer requires indexed geometry.');
  if (!position) throw new Error('Meshoptimizer requires a position attribute.');
  if (position.itemSize < 3) throw new Error('Meshoptimizer requires 3D positions.');

  const sourceIndexCount = index.count - (index.count % 3);
  const ratio = Math.max(0, Math.min(0.95, options.ratio ?? 0));
  const requestedIndexCount = clampIndexCount(
    options.targetIndexCount ?? Math.floor(sourceIndexCount * (1 - ratio)),
    sourceIndexCount,
  );
  const targetError = Math.max(0, Math.min(1, options.targetError ?? 1));
  const indices = toUint32Array(index.array);
  const positions = toFloat32Array(position.array);
  const lockedVertices = options.lockedVertices;
  if (lockedVertices && lockedVertices.length !== position.count) {
    throw new RangeError(
      'Meshoptimizer vertex locks must contain one value per position.',
    );
  }

  await meshoptimizerReady();
  const flags = [...(options.flags ?? [])];
  const [simplifiedIndices, error] = lockedVertices
    ? MeshoptSimplifier.simplifyWithAttributes(
        indices,
        positions,
        position.itemSize,
        new Float32Array(),
        0,
        [],
        lockedVertices,
        requestedIndexCount,
        targetError,
        flags,
      )
    : MeshoptSimplifier.simplify(
        indices,
        positions,
        position.itemSize,
        requestedIndexCount,
        targetError,
        flags,
      );
  const geometry = source.clone();
  geometry.setIndex(new BufferAttribute(simplifiedIndices, 1));

  return {
    geometry,
    sourceIndexCount,
    requestedIndexCount,
    indexCount: simplifiedIndices.length,
    error,
  };
}

function clampIndexCount(value: number, sourceIndexCount: number): number {
  if (!Number.isFinite(value)) return sourceIndexCount;
  const clamped = Math.max(3, Math.min(sourceIndexCount, Math.floor(value)));
  return clamped - (clamped % 3);
}

function toUint32Array(array: ArrayLike<number>): Uint32Array {
  return array instanceof Uint32Array ? array : Uint32Array.from(array);
}

function toFloat32Array(array: ArrayLike<number>): Float32Array {
  return array instanceof Float32Array ? array : Float32Array.from(array);
}
