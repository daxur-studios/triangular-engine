import { Vector3 } from 'three';
import { MAP_PROJECTIONS, type MapProjectionKind } from './core/map-projections';

/** The projection's frame in body axes: `forward` is the map's centre, `up` its north, `right` its east. */
export interface ICellPlanetProjectionBasis {
  readonly forward: Vector3;
  readonly up: Vector3;
  readonly right: Vector3;
}

const DEFAULT_BASIS: ICellPlanetProjectionBasis = {
  forward: new Vector3(0, 0, 1),
  up: new Vector3(0, 1, 0),
  right: new Vector3(1, 0, 0),
};

/** A ground point's position and orthonormal frame at one morph: east, north and the surface normal. */
export interface ICellPlanetGroundFrame {
  readonly position: Vector3;
  readonly east: Vector3;
  readonly north: Vector3;
  readonly normal: Vector3;
}

/** The part of three's `OrbitControls` the rig drives. `AdvancedOrbitControls` fits; so does a plain `OrbitControls`. */
export interface ICellPlanetMorphCameraControls {
  readonly target: Vector3;
  readonly object: {
    readonly position: Vector3;
    readonly up: Vector3;
    lookAt(target: Vector3): void;
  };
  /** Re-seeds the controls' orbit state from a new up vector (`AdvancedOrbitControls`). Without it only `object.up` is set. */
  setUpVector?(up: Vector3): void;
}

export interface ICellPlanetMorphCameraRigOptions {
  /** The planet's radius in scene units (the sphere's radius, and half the flat map's height). */
  readonly radiusM: number;
  /** Read live: the map projection the material draws. */
  readonly projection: () => MapProjectionKind;
  /** Read live: the projection's frame (the material's `uProjForward`/`uProjUp`/`uProjRight` in dynamic mode). Defaults to +Z, +Y, +X. */
  readonly basis?: () => ICellPlanetProjectionBasis;
}

const RAY_TOLERANCE = 1e-8;
const MAX_NEWTON_STEPS = 32;
const MAX_STEP_RADIANS = 0.5;
const FINITE_DIFFERENCE = 1e-6;
const EPSILON = 1e-9;
/** Radians the camera is tilted off an exact top-down view, which has no up to align with. */
const TOP_DOWN_TILT_RADIANS = 1e-4;

function frameOf(): ICellPlanetGroundFrame {
  return { position: new Vector3(), east: new Vector3(), north: new Vector3(), normal: new Vector3() };
}

/**
 * Keeps the camera over the same ground while a cell planet morphs between its globe and its flat map.
 *
 * The morph moves every surface point by `mix(sphere, flat, morph)`, but a camera and its orbit target are fixed in
 * the scene, so a growing morph slides the ground out from under them. The rig holds one *anchor*: the ground point the
 * view ray (camera to orbit target) hits. Each time `morph` changes it carries the camera and the target rigidly from the
 * anchor's ground frame at the old morph to its frame at the new one, so the distance, the angle to the surface, the
 * bearing and the position over the ground all stay as they were. It then sets the controls' up vector to the anchor's
 * surface normal and re-aims the camera, so there is no roll jitter between the globe's radial up and the map's +Z.
 *
 * The frame follows the material's own blend: the normal is `normalize(mix(sphere normal, +Z, morph))` and north blends
 * the same way, so the terrain under the camera stays level with its up. The flat map is the plane `z = 0` through the planet's centre (the material's flat positions carry only the terrain height) and
 * terrain relief is ignored (the anchor sits on the base surface). Call {@link update} once per frame, after the orbit
 * controls have updated and before the frame renders.
 */
export class CellPlanetMorphCameraRig {
  private anchor = new Vector3(0, 0, 1);
  private hasAnchor = false;
  private lastMorph = Number.NaN;

  private readonly frameA = frameOf();
  private readonly frameB = frameOf();
  private readonly scratch = new Vector3();
  private readonly scratchEast = new Vector3();
  private readonly scratchNorth = new Vector3();
  private readonly scratchFound = new Vector3();

  constructor(private readonly options: ICellPlanetMorphCameraRigOptions) {}

  /** The ground direction (unit, body frame) the camera is anchored to, once {@link update} has found one. */
  get anchorDirection(): Vector3 {
    return this.anchor.clone();
  }

  /** Forget the anchor. The next {@link update} finds a new one from the view ray (call after a camera jump). */
  reset(): void {
    this.hasAnchor = false;
    this.lastMorph = Number.NaN;
  }

  /** Position of the ground at body direction `dir` for `morph`: `mix(radius * dir, flat map point at z = 0, morph)`. */
  groundPosition(dir: Vector3, morph: number, out = new Vector3()): Vector3 {
    const radius = this.options.radiusM;
    const basis = this.options.basis?.() ?? DEFAULT_BASIS;
    const d = this.scratch.copy(dir).normalize();
    const lon = Math.atan2(d.dot(basis.right), d.dot(basis.forward));
    const lat = Math.asin(Math.max(-1, Math.min(1, d.dot(basis.up))));
    const width = 2 * Math.PI * radius;
    const height = Math.PI * radius;
    const point = MAP_PROJECTIONS[this.options.projection()].project(lon, lat, width, height);
    const flatX = point.x - width / 2;
    const flatY = height / 2 - point.y;
    const sphere = 1 - morph;
    return out.set(
      sphere * radius * d.x + morph * flatX,
      sphere * radius * d.y + morph * flatY,
      sphere * radius * d.z,
    );
  }

  /** The ground's frame at body direction `dir` for `morph` (see the class notes for how it blends). */
  groundFrame(dir: Vector3, morph: number, out: ICellPlanetGroundFrame = frameOf()): ICellPlanetGroundFrame {
    const basis = this.options.basis?.() ?? DEFAULT_BASIS;
    const d = this.scratchEast.copy(dir).normalize();
    this.groundPosition(d, morph, out.position);

    // The sphere's own north: the projection's up, flattened onto the tangent plane. At the projection's pole it has none.
    const northSphere = this.scratchNorth.copy(basis.up).addScaledVector(d, -basis.up.dot(d));
    if (northSphere.lengthSq() < 1e-12) northSphere.copy(basis.forward).negate().addScaledVector(d, basis.forward.dot(d));
    northSphere.normalize();

    // Blend as the material does: the normal toward +Z, the north toward +Y.
    out.normal.copy(d).multiplyScalar(1 - morph).addScaledVector(new Vector3(0, 0, 1), morph);
    if (out.normal.lengthSq() < 1e-8) out.normal.set(0, 0, 1);
    out.normal.normalize();
    out.north.copy(northSphere).multiplyScalar(1 - morph).addScaledVector(new Vector3(0, 1, 0), morph);
    out.north.addScaledVector(out.normal, -out.north.dot(out.normal));
    if (out.north.lengthSq() < 1e-10) {
      // North and the normal agree: any perpendicular will do, chosen to vary smoothly with the sphere's north.
      out.north.copy(northSphere).addScaledVector(out.normal, -northSphere.dot(out.normal));
      if (out.north.lengthSq() < 1e-10) out.north.set(1, 0, 0).addScaledVector(out.normal, -out.normal.x);
    }
    out.north.normalize();
    out.east.crossVectors(out.north, out.normal);
    return out;
  }

  /**
   * The ground direction hit by the line of sight from `origin` to `target` at `morph`, or null when it misses the
   * ground. `hint` (a previous answer) is tried first so the answer stays continuous while the camera moves.
   */
  groundUnderRay(origin: Vector3, target: Vector3, morph: number, hint?: Vector3, out = new Vector3()): Vector3 | null {
    const u = target.clone().sub(origin);
    if (u.lengthSq() < EPSILON) return null;
    u.normalize();
    const starts: Vector3[] = [];
    if (hint) starts.push(hint.clone());
    starts.push(this.sphereStart(origin, u));
    const plane = this.planeStart(origin, u);
    if (plane) starts.push(plane);
    for (const start of starts) {
      if (this.solve(origin, u, morph, start, out)) return out;
    }
    return null;
  }

  /**
   * Carries the camera and the orbit target from the anchor's frame at the previous morph to its frame at `morph`,
   * then sets the controls' up to the ground normal and re-aims the camera. The first call only finds the anchor.
   * Returns whether the pose changed.
   */
  update(controls: ICellPlanetMorphCameraControls, morph: number): boolean {
    const camera = controls.object;
    let changed = false;

    if (!this.hasAnchor || Number.isNaN(this.lastMorph)) {
      const found = this.groundUnderRay(camera.position, controls.target, morph);
      if (!found) return false;
      this.anchor.copy(found);
      this.hasAnchor = true;
      this.lastMorph = morph;
    } else if (morph !== this.lastMorph) {
      this.groundFrame(this.anchor, this.lastMorph, this.frameA);
      this.groundFrame(this.anchor, morph, this.frameB);
      this.carry(camera.position, this.frameA, this.frameB);
      this.carry(controls.target, this.frameA, this.frameB);
      this.lastMorph = morph;
      changed = true;
    } else {
      // Nothing is morphing, so the user may have moved the view: follow the ground now under the view ray.
      const found = this.groundUnderRay(camera.position, controls.target, morph, this.anchor, this.scratchFound);
      if (found) this.anchor.copy(found);
    }

    const frame = this.groundFrame(this.anchor, morph, this.frameB);
    const up = frame.normal;
    if (this.lookingAlong(camera.position, controls.target, up)) {
      // Straight down the normal the camera has no horizon to roll against (lookAt degenerates). Tilt it a hair, as the
      // orbit controls themselves keep their polar angle off the pole.
      this.scratch.copy(camera.position).sub(controls.target).applyAxisAngle(frame.east, TOP_DOWN_TILT_RADIANS);
      camera.position.copy(controls.target).add(this.scratch);
      changed = true;
    }
    if (changed || camera.up.distanceToSquared(up) > 1e-14) {
      if (controls.setUpVector) controls.setUpVector(up.clone());
      else camera.up.copy(up);
      camera.lookAt(controls.target);
      changed = true;
    }
    return changed;
  }

  /** True when the line from `from` to `to` runs (anti)parallel to `axis`, so `lookAt` with that up is degenerate. */
  private lookingAlong(from: Vector3, to: Vector3, axis: Vector3): boolean {
    const view = this.scratch.copy(to).sub(from);
    const length = view.length();
    return length > EPSILON && Math.abs(view.dot(axis)) / length > 1 - 1e-12;
  }

  /** Re-expresses `point` (in place) from ground frame `from` in ground frame `to`: same offset, same orientation to the ground. */
  private carry(point: Vector3, from: ICellPlanetGroundFrame, to: ICellPlanetGroundFrame): void {
    const offset = this.scratch.copy(point).sub(from.position);
    const east = offset.dot(from.east);
    const north = offset.dot(from.north);
    const normal = offset.dot(from.normal);
    point
      .copy(to.position)
      .addScaledVector(to.east, east)
      .addScaledVector(to.north, north)
      .addScaledVector(to.normal, normal);
  }

  /** The unit direction of the ray's nearest hit with the sphere (or its closest approach when it misses). */
  private sphereStart(origin: Vector3, u: Vector3): Vector3 {
    const radius = this.options.radiusM;
    const b = origin.dot(u);
    const c = origin.lengthSq() - radius * radius;
    const discriminant = b * b - c;
    const start = new Vector3();
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      const t = -b - root >= 0 ? -b - root : -b + root;
      start.copy(origin).addScaledVector(u, t);
    } else {
      start.copy(origin).addScaledVector(u, -b);
    }
    if (start.lengthSq() < EPSILON) start.copy(origin);
    return start.normalize();
  }

  /** The direction of the map point where the ray crosses the flat map's plane, or null (parallel, behind, off the map). */
  private planeStart(origin: Vector3, u: Vector3): Vector3 | null {
    if (Math.abs(u.z) < 1e-9) return null;
    const radius = this.options.radiusM;
    const t = -origin.z / u.z;
    if (t < 0) return null;
    const x = origin.x + u.x * t;
    const y = origin.y + u.y * t;
    const width = 2 * Math.PI * radius;
    const height = Math.PI * radius;
    const lonLat = MAP_PROJECTIONS[this.options.projection()].unproject(x + width / 2, height / 2 - y, width, height);
    if (!lonLat) return null;
    const basis = this.options.basis?.() ?? DEFAULT_BASIS;
    const cosLat = Math.cos(lonLat.lat);
    return new Vector3()
      .addScaledVector(basis.right, cosLat * Math.sin(lonLat.lon))
      .addScaledVector(basis.up, Math.sin(lonLat.lat))
      .addScaledVector(basis.forward, cosLat * Math.cos(lonLat.lon))
      .normalize();
  }

  /** Miss vector: the part of `ground(dir) - origin` that is not along the ray. Zero when the ground is on the ray. */
  private miss(origin: Vector3, u: Vector3, dir: Vector3, morph: number, out: Vector3): Vector3 {
    this.groundPosition(dir, morph, out).sub(origin);
    return out.addScaledVector(u, -out.dot(u));
  }

  /** Gauss-Newton on the sphere's tangent plane: moves `start` until the ground at it lies on the ray. */
  private solve(origin: Vector3, u: Vector3, morph: number, start: Vector3, out: Vector3): boolean {
    const radius = this.options.radiusM;
    const basis = this.options.basis?.() ?? DEFAULT_BASIS;
    const tolerance = radius * RAY_TOLERANCE;
    const d = out.copy(start).normalize();
    const r = new Vector3();
    const ra = new Vector3();
    const rb = new Vector3();
    const east = new Vector3();
    const north = new Vector3();
    const probe = new Vector3();

    for (let step = 0; step < MAX_NEWTON_STEPS; step++) {
      this.miss(origin, u, d, morph, r);
      if (r.length() < tolerance) return this.groundPosition(d, morph, probe).sub(origin).dot(u) > 0;

      north.copy(basis.up).addScaledVector(d, -basis.up.dot(d));
      if (north.lengthSq() < 1e-12) north.copy(basis.forward).negate().addScaledVector(d, basis.forward.dot(d));
      north.normalize();
      east.crossVectors(north, d);

      this.miss(origin, u, probe.copy(d).addScaledVector(east, FINITE_DIFFERENCE).normalize(), morph, ra);
      this.miss(origin, u, probe.copy(d).addScaledVector(north, FINITE_DIFFERENCE).normalize(), morph, rb);
      ra.sub(r).divideScalar(FINITE_DIFFERENCE);
      rb.sub(r).divideScalar(FINITE_DIFFERENCE);

      const aa = ra.dot(ra);
      const ab = ra.dot(rb);
      const bb = rb.dot(rb);
      const determinant = aa * bb - ab * ab;
      if (!(Math.abs(determinant) > 1e-30 * aa * bb) || !Number.isFinite(determinant)) return false;
      const g1 = -ra.dot(r);
      const g2 = -rb.dot(r);
      let stepEast = (bb * g1 - ab * g2) / determinant;
      let stepNorth = (aa * g2 - ab * g1) / determinant;
      const size = Math.hypot(stepEast, stepNorth);
      if (!Number.isFinite(size)) return false;
      if (size > MAX_STEP_RADIANS) {
        stepEast *= MAX_STEP_RADIANS / size;
        stepNorth *= MAX_STEP_RADIANS / size;
      }
      d.addScaledVector(east, stepEast).addScaledVector(north, stepNorth).normalize();
    }
    this.miss(origin, u, d, morph, r);
    return r.length() < tolerance * 100;
  }
}
