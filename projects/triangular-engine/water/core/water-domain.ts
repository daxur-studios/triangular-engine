import { Vector2, Vector3 } from 'three';

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
  getSurfaceXZ?(
    frame: WaterLocalFrame,
    localX: number,
    localZ: number,
    out?: Vector2,
  ): Vector2;
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

  getLocalFrame(_referencePosition?: Vector3): WaterLocalFrame {
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

  getSurfaceXZ(
    frame: WaterLocalFrame,
    localX: number,
    localZ: number,
    out = new Vector2(),
  ): Vector2 {
    return out.set(frame.origin.x + localX, frame.origin.z + localZ);
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

  getSurfaceXZ(
    frame: WaterLocalFrame,
    localX: number,
    localZ: number,
    out = new Vector2(),
  ): Vector2 {
    const flatPos = new Vector3()
      .copy(frame.origin)
      .addScaledVector(frame.tangentU, localX)
      .addScaledVector(frame.tangentV, localZ)
      .sub(this.center);
    const dir = flatPos.normalize();
    const lat = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    const lon = Math.atan2(dir.z, dir.x);
    return out.set(this.radiusM * lon, this.radiusM * lat);
  }
}

const CYLINDER_AXIS_EPSILON_SQ = 1e-12;

export interface CylinderWaterDomainOptions {
  /** World-space unit vector along the cylinder's centerline. Defaults to +Y. */
  readonly axis?: Vector3;
  /** World-space point on the centerline. Defaults to the origin. */
  readonly center?: Vector3;
}

/**
 * Curves the flat CDLOD grid onto the *inside* of a cylinder wall (an
 * O'Neill habitat, not a planet): `normal` points inward, toward the axis
 * — the opposite of `SphereWaterDomain`, matching how centrifugal "gravity"
 * on a spinning cylinder's interior pushes outward against the wall, so
 * "up" is toward the centerline. `getLocalFrame` finds the point nearest
 * the reference position on the wall (so the reference position's own
 * projection onto tangentU/tangentV is still exactly zero, same trick as
 * the sphere). `composeWorldPosition` renormalizes only the component
 * *perpendicular* to the axis — a cylinder has zero curvature along its
 * length, so the axial coordinate passes through unchanged, unlike the
 * sphere's fully-renormalized composition.
 */
export class CylinderWaterDomain implements WaterSurfaceDomain {
  readonly kind = 'cylinder';

  readonly axis: Vector3;
  readonly center: Vector3;

  constructor(
    readonly radiusM: number,
    options: CylinderWaterDomainOptions = {},
  ) {
    if (!Number.isFinite(radiusM) || radiusM <= 0) {
      throw new RangeError('CylinderWaterDomain radius must be positive and finite.');
    }
    this.axis = options.axis?.clone().normalize() ?? new Vector3(0, 1, 0);
    this.center = options.center?.clone() ?? new Vector3(0, 0, 0);
  }

  getLocalFrame(referencePosition: Vector3): WaterLocalFrame {
    const axialOffset = new Vector3()
      .subVectors(referencePosition, this.center)
      .dot(this.axis);
    const axisPoint = new Vector3()
      .copy(this.axis)
      .multiplyScalar(axialOffset)
      .add(this.center);

    let radialVector = new Vector3().subVectors(referencePosition, axisPoint);
    if (radialVector.lengthSq() < CYLINDER_AXIS_EPSILON_SQ) {
      const reference =
        Math.abs(this.axis.y) < 0.9 ? referenceUp : referenceRight;
      radialVector = new Vector3().crossVectors(this.axis, reference);
    }
    const radialDir = radialVector.normalize();

    const origin = new Vector3()
      .copy(radialDir)
      .multiplyScalar(this.radiusM)
      .add(axisPoint);
    const normal = radialDir.clone().negate();
    const tangentU = this.axis.clone();
    const tangentV = new Vector3().crossVectors(this.axis, radialDir).normalize();
    return { origin, normal, tangentU, tangentV };
  }

  composeWorldPosition(
    frame: WaterLocalFrame,
    localX: number,
    localZ: number,
    heightAlongNormal: number,
    out = new Vector3(),
  ): Vector3 {
    const flatPos = new Vector3()
      .copy(frame.origin)
      .addScaledVector(frame.tangentU, localX)
      .addScaledVector(frame.tangentV, localZ)
      .sub(this.center);
    const axialComponent = flatPos.dot(this.axis);
    const radialVector = flatPos.addScaledVector(this.axis, -axialComponent);
    const direction = radialVector.normalize();
    const displacedRadius = this.radiusM - heightAlongNormal;
    return out
      .copy(this.center)
      .addScaledVector(this.axis, axialComponent)
      .addScaledVector(direction, displacedRadius);
  }

  getSurfaceXZ(
    frame: WaterLocalFrame,
    localX: number,
    localZ: number,
    out = new Vector2(),
  ): Vector2 {
    const flatPos = new Vector3()
      .copy(frame.origin)
      .addScaledVector(frame.tangentU, localX)
      .addScaledVector(frame.tangentV, localZ)
      .sub(this.center);
    const axialComponent = flatPos.dot(this.axis);
    const radialVector = flatPos.addScaledVector(this.axis, -axialComponent);
    const direction = radialVector.normalize();
    const reference =
      Math.abs(this.axis.y) < 0.9 ? referenceUp : referenceRight;
    const refU = new Vector3().crossVectors(reference, this.axis).normalize();
    const refV = new Vector3().crossVectors(this.axis, refU);
    const angle = Math.atan2(direction.dot(refV), direction.dot(refU));
    return out.set(axialComponent, this.radiusM * angle);
  }
}

