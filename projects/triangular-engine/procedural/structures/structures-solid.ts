export type StructureSolidShape = 'box' | 'cylinder' | 'cone' | 'capsule' | 'sphere';

export interface IStructureEndpoints {
  readonly startM: readonly [number, number, number];
  readonly endM: readonly [number, number, number];
}

/**
 * A concrete structural solid produced by the skeleton generator.
 * Structure frame: meters, Y-up, origin at the structure ground anchor / foundation center.
 */
export interface IStructureSolid {
  readonly id: string;
  readonly shape: StructureSolidShape;
  /** Center position in structure-local coordinates (meters). */
  readonly positionM: readonly [number, number, number];
  /** Orientation quaternion [x, y, z, w]. */
  readonly orientation: readonly [number, number, number, number];
  /**
   * Per shape dimensions:
   * - box: [width, height, depth]
   * - cylinder: [radius, height]
   * - cone: [radiusBottom, radiusTop, height]
   * - capsule: [radius, totalHeight]
   * - sphere: [radius]
   */
  readonly dimensionsM: readonly number[];
  /** 0 = base foundation (fixed to ground); 1+ = kinematic links (e.g. carriage, chopsticks, rotors). */
  readonly linkId: number;
  /** Optional endpoint definition for linear beams, trusses, or rails. */
  readonly endpoints?: IStructureEndpoints;
  /** Intentional penetration depth (meters) into foundation / terrain to prevent air gaps. */
  readonly embedDepthM?: number;
  /** Visual color hint (hex string, e.g. '#94a3b8'). */
  readonly materialHex?: string;
  /** Whether this solid contributes a Jolt collider descriptor (default: true). */
  readonly collidable?: boolean;
}

/**
 * Computes a quaternion [x, y, z, w] rotating canonical unit vector [0, 1, 0] (+Y)
 * to align with the target unit direction.
 */
export function structureQuaternionFromUnitY(
  dir: readonly [number, number, number],
): readonly [number, number, number, number] {
  const [dx, dy, dz] = dir;
  if (dy > 0.999999) {
    return [0, 0, 0, 1];
  }
  if (dy < -0.999999) {
    return [1, 0, 0, 0];
  }

  const axisX = dz;
  const axisY = 0;
  const axisZ = -dx;
  const axisLen = Math.sqrt(axisX * axisX + axisZ * axisZ);

  const normX = axisX / axisLen;
  const normZ = axisZ / axisLen;

  const angle = Math.acos(Math.max(-1, Math.min(1, dy)));
  const halfAngle = angle * 0.5;
  const sinHalf = Math.sin(halfAngle);
  const cosHalf = Math.cos(halfAngle);

  return [normX * sinHalf, axisY * sinHalf, normZ * sinHalf, cosHalf];
}

/**
 * Constructs a structural solid from start and end points (startM -> endM) for pylons, trusses, or rails.
 */
export function deriveStructureSolidFromEndpoints(options: {
  readonly id: string;
  readonly shape: 'cylinder' | 'capsule' | 'cone';
  readonly startM: readonly [number, number, number];
  readonly endM: readonly [number, number, number];
  readonly radiusM: number | readonly [number, number];
  readonly linkId?: number;
  readonly embedDepthM?: number;
  readonly materialHex?: string;
  readonly collidable?: boolean;
}): IStructureSolid {
  const [sx, sy, sz] = options.startM;
  const [ex, ey, ez] = options.endM;

  const vx = ex - sx;
  const vy = ey - sy;
  const vz = ez - sz;
  const length = Math.sqrt(vx * vx + vy * vy + vz * vz);

  if (length < 1e-6) {
    throw new RangeError(`Structure solid ${options.id} endpoints must not be coincident.`);
  }

  const dir: readonly [number, number, number] = [vx / length, vy / length, vz / length];
  const orientation = structureQuaternionFromUnitY(dir);

  const positionM: readonly [number, number, number] = [
    (sx + ex) * 0.5,
    (sy + ey) * 0.5,
    (sz + ez) * 0.5,
  ];

  let dimensionsM: readonly number[];
  if (options.shape === 'cone') {
    const radii = Array.isArray(options.radiusM)
      ? options.radiusM
      : [options.radiusM as number, (options.radiusM as number) * 0.5];
    dimensionsM = [radii[0], radii[1], length];
  } else if (options.shape === 'cylinder') {
    const r = Array.isArray(options.radiusM) ? options.radiusM[0] : (options.radiusM as number);
    dimensionsM = [r, length];
  } else {
    const r = Array.isArray(options.radiusM) ? options.radiusM[0] : (options.radiusM as number);
    dimensionsM = [r, length];
  }

  return {
    id: options.id,
    shape: options.shape,
    positionM,
    orientation,
    dimensionsM,
    linkId: options.linkId ?? 0,
    endpoints: { startM: options.startM, endM: options.endM },
    embedDepthM: options.embedDepthM,
    materialHex: options.materialHex,
    collidable: options.collidable ?? true,
  };
}
