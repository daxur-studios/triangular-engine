import { Color, DoubleSide, Mesh, PlaneGeometry, Vector3, type ColorRepresentation } from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn,
  If,
  Discard,
  abs,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cross,
  dot,
  float,
  fwidth,
  length,
  max,
  mix,
  normalize,
  positionLocal,
  select,
  smoothstep,
  sqrt,
  tan,
  uniform,
  varying,
  vec3,
  vec4,
} from 'three/tsl';
import type { AtmosphereBackdrop } from './atmosphere-backdrop';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The quad reaches this far past the disc's edge (in disc radii), room for the anti-aliased rim. */
const QUAD_MARGIN = 1.1;

export interface AtmosphereSkyBodyOptions {
  /** Angular radius, degrees. Default 0.26 (the Moon from the Earth). */
  angularRadiusDeg?: number;
  /** Surface albedo; the sunlit side shows `albedo x cos / pi` of the sun. Default a dark grey rock (0.14). */
  albedo?: ColorRepresentation;
  /** Light of its own, relative to the sun's irradiance like the sky's radiance. Default black. */
  emission?: ColorRepresentation;
  /** Light the disc from the sun (a phase). Default true; false shows only the emission. */
  lit?: boolean;
}

/**
 * A moon, planet or other body in the sky (Plan 049, Phase 5): a disc at infinity, lit by the sun as a sphere, seen
 * through the air via the backdrop's {@link AtmosphereBackdrop.skyObject}, so it fades into the haze at the horizon,
 * reddens like the sun near it and vanishes behind a bright day sky as the sky's own light covers it.
 *
 * It is drawn after the backdrop and before everything else (render order -999, no depth test), so the planet and any
 * scene object cover it. Its edge is blended with the sky colour it sits on, so it needs no transparency. Directions are
 * world space: set them with {@link setDirections} each frame (`PlanetAtmosphere` does this for bodies it owns).
 *
 * The body does not light the air or the ground (moonlight is about a millionth of sunlight).
 */
export class AtmosphereSkyBody {
  readonly mesh: Mesh;
  readonly material: NodeMaterial;
  /** Unit direction to the body, world space. */
  readonly direction = uniform(new Vector3(0, 0, 1));
  /** Unit direction to the sun, world space (lights the disc). */
  readonly sunDirection = uniform(new Vector3(0, 1, 0));
  /** Angular radius, radians. */
  readonly angularRadius = uniform(0);
  readonly albedo = uniform(new Color());
  readonly emission = uniform(new Color(0, 0, 0));
  /** 1 lights the disc from the sun, 0 shows only the emission. */
  readonly lit = uniform(1);

  constructor(
    readonly backdrop: AtmosphereBackdrop,
    options: AtmosphereSkyBodyOptions = {},
  ) {
    this.angularRadius.value = ((options.angularRadiusDeg ?? 0.26) * Math.PI) / 180;
    this.albedo.value.set(options.albedo ?? new Color(0.14, 0.14, 0.14));
    this.emission.value.set(options.emission ?? 0x000000);
    this.lit.value = options.lit === false ? 0 : 1;

    const material = new NodeMaterial();
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = false;
    // The quad's winding on screen depends on the tangent frame's handedness there.
    material.side = DoubleSide;

    // A tangent frame at the body: `t1`, `t2` span the disc, `d` points at it.
    const frame = () => {
      const d = normalize(this.direction);
      const ref = select(abs(d.y).greaterThan(0.99), vec3(1, 0, 0), vec3(0, 1, 0));
      const t1 = normalize(cross(ref, d));
      const t2 = cross(d, t1);
      return { d, t1, t2 };
    };

    // Corners on the plane tangent to the sky at unit distance: the disc's edge is at radius tan(r) there. A direction
    // (w = 0) projects to a point at infinity; z is set inside the clip volume, since the depth test is off.
    const corner = positionLocal.xy.mul(QUAD_MARGIN);
    const v = frame();
    const rayWorld = v.d.add(v.t1.mul(corner.x).add(v.t2.mul(corner.y)).mul(tan(this.angularRadius)));
    const clip: any = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(rayWorld, 0)));
    material.vertexNode = vec4(clip.xy, clip.w.mul(0.5), clip.w);
    const cornerVarying = varying(corner, 'vSkyBodyCorner');
    const rayVarying = varying(rayWorld, 'vSkyBodyRay');

    const model = backdrop.model;
    material.fragmentNode = Fn(() => {
      const c: any = cornerVarying;
      const r = length(c);
      const edge = max(fwidth(r), 1e-4);
      const coverage = float(1).sub(smoothstep(float(1).sub(edge), float(1), r));
      If(coverage.lessThanEqual(0), () => {
        Discard();
      });
      // The sphere's point under this pixel, seen from far away: its normal faces back toward the camera (-d).
      const f = frame();
      const z = sqrt(max(float(1).sub(dot(c, c)), 0));
      const normal = normalize(f.t1.mul(c.x).add(f.t2.mul(c.y)).sub(f.d.mul(z)));
      const cosSun = max(dot(normal, normalize(this.sunDirection)), 0);
      const reflected = vec3(this.albedo as any).mul(cosSun).mul(model.uSunIrradiance).mul(this.lit).div(Math.PI);
      const radiance = reflected.add(vec3(this.emission as any));
      const ray = normalize(rayVarying);
      const { inscatter, transmittance } = backdrop.atmosphereSky(ray);
      const colour = radiance.mul(backdrop.exposure).mul(transmittance).add(inscatter);
      // The rim blends into the sky behind it (the air's own light), so the disc can stay opaque.
      return vec4(mix(inscatter, colour, coverage), 1);
    })();

    this.material = material;
    const mesh = new Mesh(new PlaneGeometry(2, 2), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -999;
    mesh.name = 'AtmosphereSkyBody';
    this.mesh = mesh;
  }

  /** Points the body and its sunlight, both world space; normalised here. */
  setDirections(direction: Vector3, sun: Vector3): void {
    this.direction.value.copy(direction).normalize();
    this.sunDirection.value.copy(sun).normalize();
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
