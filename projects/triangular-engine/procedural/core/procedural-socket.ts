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

/**
 * A placed instance's pose — position/orientation/uniform-scale only, no
 * shear — deliberately shaped like the decomposition of a transform matrix
 * (e.g. three.js `Matrix4.decompose`) rather than depending on a matrix type
 * itself, so this stays usable from a worker or a save-file context with no
 * three.js on the classpath. Callers owning a real matrix (scatter's
 * `computeScatterInstanceMatrix`) just decompose it into this shape first.
 */
export interface IProceduralInstanceTransform {
  readonly positionM: readonly [number, number, number];
  readonly quaternion: readonly [number, number, number, number];
  readonly scale: number;
}

function rotateVectorByQuaternion(
  v: readonly [number, number, number],
  q: readonly [number, number, number, number],
): readonly [number, number, number] {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}

function multiplyQuaternions(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): readonly [number, number, number, number] {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/**
 * Resolves a variant-local socket (position/orientation relative to the
 * variant's root base) into world space for one placed instance — the
 * "instance transform × variant sockets" query the runbook's Known gap #2
 * asks for. Generic over `TKind` so it works for flora now and fauna/
 * structures sockets later without depending on any consumer's placement
 * system (scatter or otherwise) — the caller supplies the pose.
 */
export function transformProceduralSocket<TKind extends string>(
  socket: IProceduralSocket<TKind>,
  transform: IProceduralInstanceTransform,
): IProceduralSocket<TKind> {
  const scaledLocal: readonly [number, number, number] = [
    socket.positionM[0] * transform.scale,
    socket.positionM[1] * transform.scale,
    socket.positionM[2] * transform.scale,
  ];
  const rotated = rotateVectorByQuaternion(scaledLocal, transform.quaternion);
  return {
    ...socket,
    positionM: [
      transform.positionM[0] + rotated[0],
      transform.positionM[1] + rotated[1],
      transform.positionM[2] + rotated[2],
    ],
    orientation: multiplyQuaternions(transform.quaternion, socket.orientation),
    clearanceRadiusM: socket.clearanceRadiusM * transform.scale,
  };
}
