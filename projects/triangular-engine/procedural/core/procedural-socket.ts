import { hashProceduralKey } from './procedural-hash';

/**
 * Typed attachment point a generated mesh exposes for gameplay/behavior
 * consumers. The socket is the product; the mesh is decoration — see
 * docs/runbook/014_procedural_sublibrary.md, "Core principle".
 *
 * `TKind` is left to each domain (flora, buildings, animals, ...) — core
 * has no concept of what a "perch" or "nest cavity" is, only that sockets
 * have a kind string, a pose, and a clearance radius.
 */
export interface IProceduralSocket<TKind extends string = string> {
  /** Stable within a variant — see deriveProceduralSocketId. */
  readonly id: string;
  readonly kind: TKind;
  /** Local to the variant's origin (root base), meters, Y-up. */
  readonly positionM: readonly [number, number, number];
  /** Quaternion [x, y, z, w]; orientation meaning is domain-defined. */
  readonly orientation: readonly [number, number, number, number];
  readonly clearanceRadiusM: number;
}

/**
 * Derives a stable socket ID from identity inputs only — never from the
 * socket's own position. Consumers persist this ID; positions are always
 * re-derived by regenerating the variant, never stored directly. See
 * docs/runbook/014_procedural_sublibrary.md, decision 12 and Known gaps #8.
 */
export function deriveProceduralSocketId<TKind extends string>(options: {
  readonly archetypeId: string;
  readonly seed: number;
  readonly schemaVersion: number;
  readonly kind: TKind;
  readonly ordinal: number;
}): string {
  if (options.archetypeId.length === 0) {
    throw new RangeError('Procedural socket archetypeId must be a non-empty string.');
  }
  if (!Number.isInteger(options.ordinal) || options.ordinal < 0) {
    throw new RangeError('Procedural socket ordinal must be a non-negative integer.');
  }

  const key = `${options.archetypeId}|${options.seed}|${options.schemaVersion}|${options.kind}|${options.ordinal}`;
  const hash = hashProceduralKey(key);
  return `${options.kind}-${hash.toString(16)}`;
}
