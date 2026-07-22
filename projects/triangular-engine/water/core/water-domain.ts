import { Vector3 } from 'three';

/**
 * Local tangent frame at some reference point on a water body's surface:
 * `origin` sits on the surface, `normal` is local "up", and
 * `tangentU`/`tangentV` span the tangent plane there. The existing flat
 * CDLOD grid (`computeWaterLodLevels`, `WATER_LOD_MORPH_GLSL`/`CULL_GLSL`,
 * `GERSTNER_*_GLSL`) already operates on a 2D "local" coordinate plus a
 * separate "up" displacement — this frame is what turns those local
 * coordinates into a world position for a given domain shape.
 */
export interface WaterLocalFrame {
  readonly origin: Vector3;
  readonly normal: Vector3;
  readonly tangentU: Vector3;
  readonly tangentV: Vector3;
}

/**
 * Shape adapter for the water LOD grid. `getLocalFrame` finds the tangent
 * frame nearest a reference position (the camera); `composeWorldPosition`
 * turns local tangent-plane offsets plus a height along the frame's normal
 * into a world position. See docs/runbook/002_water_sublibrary.md, Phase 1c,
 * for why this is a smaller, water-specific contract rather than a reuse of
 * terrain's `ITerrainSurfaceDomain<TAddress>` (that contract is shaped
 * around discrete quadtree patches + skirts, which water's single
 * continuously-recentring grid deliberately avoids).
 */
export interface WaterSurfaceDomain {
  readonly kind: string;
  getLocalFrame(referencePosition: Vector3): WaterLocalFrame;
  composeWorldPosition(
    frame: WaterLocalFrame,
    localX: number,
    localZ: number,
    heightAlongNormal: number,
    out?: Vector3,
  ): Vector3;
}

export interface PlaneWaterDomainOptions {
  /** World Y of the undisplaced surface. Defaults to 0. */
  readonly seaLevelY?: number;
}

/**
 * Recovers today's flat-plane behaviour exactly: a fixed frame at world
 * origin (offset by `seaLevelY`), +Y up, +X/+Z tangents, and a purely linear
 * composition (no renormalize) — so routing the existing plane demo through
 * this same abstraction is a no-op.
 */
export class PlaneWaterDomain implements WaterSurfaceDomain {
  readonly kind = 'plane';

  private readonly frame: WaterLocalFrame;

  constructor(options: PlaneWaterDomainOptions = {}) {
    this.frame = {
      origin: new Vector3(0, options.seaLevelY ?? 0, 0),
      normal: new Vector3(0, 1, 0),
      tangentU: new Vector3(1, 0, 0),
      tangentV: new Vector3(0, 0, 1),
    };
  }

  getLocalFrame(): WaterLocalFrame {
    return this.frame;
  }

  composeWorldPosition(
    frame: WaterLocalFrame,
    localX: number,
    localZ: number,
    heightAlongNormal: number,
    out = new Vector3(),
  ): Vector3 {
    return out
      .copy(frame.origin)
      .addScaledVector(frame.tangentU, localX)
      .addScaledVector(frame.tangentV, localZ)
      .addScaledVector(frame.normal, heightAlongNormal);
  }
}

function orthonormalTangents(normal: Vector3): {
  tangentU: Vector3;
  tangentV: Vector3;
} {
  const reference =
    Math.abs(normal.y) < 0.9
      ? referenceUp
      : referenceRight;
  const tangentU = new Vector3().crossVectors(reference, normal).normalize();
  const tangentV = new Vector3().crossVectors(normal, tangentU);
  return { tangentU, tangentV };
}

const referenceUp = new Vector3(0, 1, 0);
const referenceRight = new Vector3(1, 0, 0);

export interface SphereWaterDomainOptions {
  /** World-space sphere center. Defaults to the origin. */
  readonly center?: Vector3;
}

/**
 * Curves the flat CDLOD grid onto a sphere: `getLocalFrame` finds the point
 * on the sphere nearest the reference position (so the reference position's
 * own projection onto tangentU/tangentV is always exactly zero — the ring
 * grid can keep being evaluated at local camera coordinates (0, 0) every
 * frame, see the runbook), and `composeWorldPosition` flattens local offsets
 * into the tangent plane, then renormalizes onto the sphere at
 * `radiusM + heightAlongNormal` so the surface actually curves with the
 * horizon rather than just tilting to match local "up".
 */
export class SphereWaterDomain implements WaterSurfaceDomain {
  readonly kind = 'sphere';

  readonly center: Vector3;

  constructor(readonly radiusM: number, options: SphereWaterDomainOptions = {}) {
    if (!Number.isFinite(radiusM) || radiusM <= 0) {
      throw new RangeError('SphereWaterDomain radius must be positive and finite.');
    }
    this.center = options.center?.clone() ?? new Vector3(0, 0, 0);
  }

  getLocalFrame(referencePosition: Vector3): WaterLocalFrame {
    const normal = new Vector3()
      .subVectors(referencePosition, this.center)
      .normalize();
    const origin = new Vector3()
      .copy(normal)
      .multiplyScalar(this.radiusM)
      .add(this.center);
    const { tangentU, tangentV } = orthonormalTangents(normal);
    return { origin, normal, tangentU, tangentV };
  }

  composeWorldPosition(
    frame: WaterLocalFrame,
    localX: number,
    localZ: number,
    heightAlongNormal: number,
    out = new Vector3(),
  ): Vector3 {
    out
      .copy(frame.origin)
      .addScaledVector(frame.tangentU, localX)
      .addScaledVector(frame.tangentV, localZ)
      .sub(this.center)
      .normalize()
      .multiplyScalar(this.radiusM + heightAlongNormal)
      .add(this.center);
    return out;
  }
}
