export type PartSolidShape = 'box' | 'cylinder' | 'cone' | 'capsule' | 'sphere';

export interface IPartEndpoints {
  readonly startM: readonly [number, number, number];
  readonly endM: readonly [number, number, number];
}

/**
 * A concrete solid, produced by the skeleton generator.
 * Part frame: meters, Y-up, origin at the primary mount-interface point.
 */
export interface IPartSolid {
  readonly id: string;
  readonly shape: PartSolidShape;
  /** Center position in part-local coordinates (meters). */
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
  /** 0 = base frame (fixed to host); 1 = child of the joint (moving link). */
  readonly linkId: number;
  /** Optional endpoint definition for linear struts/trusses. */
  readonly endpoints?: IPartEndpoints;
  /** Intentional penetration depth (meters) into parent solid to prevent floating air gaps. */
  readonly embedDepthM?: number;
  /** Visual color hint (hex string, e.g. '#99aab5'). Colliders ignore this. */
  readonly materialHex?: string;
  /** Whether this solid contributes a Jolt collider descriptor (default: true). */
  readonly collidable?: boolean;
}

/**
 * Computes a quaternion [x, y, z, w] rotating the canonical direction [0, 1, 0] (+Y)
 * to align with the target unit vector.
 */
export function quaternionFromUnitY(
  dir: readonly [number, number, number],
): readonly [number, number, number, number] {
  const [dx, dy, dz] = dir;
  // If direction is collinear with [0, 1, 0]
  if (dy > 0.999999) {
    return [0, 0, 0, 1];
  }
  if (dy < -0.999999) {
    // 180 degree flip around X axis
    return [1, 0, 0, 0];
  }

  // Cross product [0, 1, 0] x [dx, dy, dz] = [dz, 0, -dx]
  const axisX = dz;
  const axisY = 0;
  const axisZ = -dx;
  const axisLen = Math.sqrt(axisX * axisX + axisZ * axisZ);

  const normX = axisX / axisLen;
  const normZ = axisZ / axisLen;

  // dy = cos(theta)
  const angle = Math.acos(Math.max(-1, Math.min(1, dy)));
  const halfAngle = angle * 0.5;
  const sinHalf = Math.sin(halfAngle);
  const cosHalf = Math.cos(halfAngle);

  return [normX * sinHalf, axisY * sinHalf, normZ * sinHalf, cosHalf];
}

/**
 * Constructs a solid from endpoints (startM -> endM) for struts, tubes, or pistons.
 */
export function deriveSolidFromEndpoints(options: {
  readonly id: string;
  readonly shape: 'cylinder' | 'capsule' | 'cone';
  readonly startM: readonly [number, number, number];
  readonly endM: readonly [number, number, number];
  readonly radiusM: number | readonly [number, number]; // [radiusBottom, radiusTop] for cone
  readonly linkId?: number;
  readonly embedDepthM?: number;
  readonly materialHex?: string;
  readonly collidable?: boolean;
}): IPartSolid {
  const [sx, sy, sz] = options.startM;
  const [ex, ey, ez] = options.endM;

  const vx = ex - sx;
  const vy = ey - sy;
  const vz = ez - sz;
  const length = Math.sqrt(vx * vx + vy * vy + vz * vz);

  if (length < 1e-6) {
    throw new RangeError(`Solid ${options.id} endpoints must not be coincident.`);
  }

  const dir: readonly [number, number, number] = [vx / length, vy / length, vz / length];
  const orientation = quaternionFromUnitY(dir);

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
    // capsule
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
