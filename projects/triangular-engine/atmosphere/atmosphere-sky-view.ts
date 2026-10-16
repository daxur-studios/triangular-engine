import { HalfFloatType, LinearFilter, ClampToEdgeWrapping, RGBAFormat, RenderTarget, Vector3 } from 'three';
import { NodeMaterial, QuadMesh, type WebGPURenderer } from 'three/webgpu';
import {
  Fn,
  acos,
  clamp,
  cos,
  dot,
  float,
  length,
  normalize,
  select,
  sin,
  sqrt,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  atan,
} from 'three/tsl';
import { AtmosphereGpuModel } from './atmosphere-gpu-model';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AtmosphereSkyViewOptions {
  /** Texels across the azimuth (relative to the sun, 0..pi) and down the zenith angle. Default 192 x 108. */
  width?: number;
  height?: number;
  /** Samples per texel. Default {@link AtmosphereGpuModel.defaultSteps}. */
  steps?: number;
  /** Re-render when the altitude changes by more than this fraction of `max(altitude, 0.2% of the top)`. Default 0.01. */
  altitudeTolerance?: number;
  /** Re-render when the sun's elevation changes by more than this many degrees. Default 0.05. */
  sunTolerance?: number;
}

/**
 * Hillaire's sky-view table (Plan 049, Phase 2c): the in-scattered radiance and the transmittance of every view
 * direction, for the camera's current altitude and sun elevation, in a small render target. The sky is then
 * one filtered fetch per pixel instead of a ray march, and the cost no longer depends on where the camera is.
 *
 * Parameterization (the sky is symmetric about the vertical plane through the sun, so only the unsigned
 * azimuth relative to the sun is stored):
 * - rows: view zenith angle `theta`, split at the horizon `thetaH = pi/2 + dip`. Both sides use a square-root
 *   mapping so the texels crowd at the horizon where the sky changes fastest.
 * - columns: `sqrt(phi / pi)`, so resolution crowds around the sun (the forward Mie peak).
 *
 * The target is two images side by side: radiance on the left, transmittance on the right (3 channels each).
 * Rendering is skipped while the altitude and the sun's elevation stay within tolerance. Outside the
 * atmosphere (camera above the top) the table is not used; the limb is marched per pixel instead (the
 * pixels that miss the air skip the march).
 */
export class AtmosphereSkyViewLut {
  readonly width: number;
  readonly height: number;
  readonly target: RenderTarget;
  /** The altitude and sun direction the table was last rendered for; lookups use these. */
  readonly lutAltitude = uniform(0);
  readonly lutSunDirection = uniform(new Vector3(0, 1, 0));
  /** Number of times the table was rendered. */
  renderCount = 0;

  private readonly quad: QuadMesh;
  private readonly material: NodeMaterial;
  private lastAltitude = Number.NaN;
  private lastSunElevationDeg = Number.NaN;
  private lastProfileVersion = -1;
  private forced = true;

  constructor(
    readonly model: AtmosphereGpuModel,
    private readonly options: AtmosphereSkyViewOptions = {},
  ) {
    this.width = options.width ?? 192;
    this.height = options.height ?? 108;
    this.target = new RenderTarget(this.width * 2, this.height, {
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      depthBuffer: false,
      generateMipmaps: false,
    } as any);
    this.material = new NodeMaterial();
    this.material.fragmentNode = this.buildRenderNode();
    this.quad = new QuadMesh(this.material);
  }

  // -- parameterization --------------------------------------------------------------------------

  /** Zenith angle of the horizon from the LUT altitude: `pi/2` on the ground, more as the camera rises. */
  private horizonAngle(): any {
    const R = this.model.uRadius;
    const h = this.lutAltitude;
    // dip = acos(R / (R + h)) = atan(sqrt(h (2R + h)) / R): the second form keeps precision at small h.
    const dip = atan(sqrt(h.mul(R.mul(2).add(h))).div(R));
    return dip.add(Math.PI / 2);
  }

  /** Unit horizontal direction toward the sun (x, z), with a fallback when the sun is straight overhead. */
  private sunHorizontal(): any {
    const s = this.lutSunDirection;
    const l = length(vec2(s.x, s.z));
    return select(l.greaterThan(1e-4), vec2(s.x, s.z).div(l), vec2(0, 1));
  }

  private buildRenderNode(): any {
    const model = this.model;
    const { width, height } = this;
    return Fn(() => {
      const coord = uv();
      const right: any = coord.x.greaterThan(0.5);
      const ux = select(right, coord.x.sub(0.5).mul(2), coord.x.mul(2));
      // Texel index -> edge-aligned unit coordinate in [0, 1].
      const sU = clamp(ux.mul(width).sub(0.5).div(width - 1), 0, 1);
      const tV = clamp(coord.y.mul(height).sub(0.5).div(height - 1), 0, 1);

      const thetaH = this.horizonAngle();
      const c = tV.sub(0.5).mul(2);
      const theta: any = select(
        c.greaterThan(0),
        thetaH.add(c.mul(c).mul(float(Math.PI).sub(thetaH))),
        thetaH.sub(c.mul(c).mul(thetaH)),
      );
      const phi = sU.mul(sU).mul(Math.PI);
      const sunH = this.sunHorizontal();
      const cp = cos(phi);
      const sp = sin(phi);
      const hx = sunH.x.mul(cp).sub(sunH.y.mul(sp));
      const hz = sunH.x.mul(sp).add(sunH.y.mul(cp));
      const sinT = sin(theta);
      const dir: any = (vec3 as any)(sinT.mul(hx), cos(theta), sinT.mul(hz));

      const result = model.march({
        altitude: this.lutAltitude,
        dir,
        sunDir: this.lutSunDirection,
        maxDistance: float(1e30),
        steps: this.options.steps,
      });
      const out: any = select(right, result.transmittance, result.radiance);
      return vec4(out, 1);
    })();
  }

  /** Radiance and transmittance for a unit direction `dir` (local frame), read from the table. Inside an `Fn`. */
  lookup(dir: any): { radiance: any; transmittance: any } {
    const { width, height } = this;
    const thetaH = this.horizonAngle();
    const theta: any = acos(clamp(dir.y, -1, 1));
    const below = theta.greaterThan(thetaH);
    const cBelow = sqrt(theta.sub(thetaH).div(float(Math.PI).sub(thetaH)));
    const cAbove = sqrt(thetaH.sub(theta).div(thetaH)).negate();
    const c = select(below, cBelow, cAbove);
    const tV = c.mul(0.5).add(0.5);

    const sunH = this.sunHorizontal();
    const dirH = normalize(vec2(dir.x, dir.z).add(vec2(1e-12, 0)));
    const phi = acos(clamp(dot(dirH, sunH), -1, 1));
    const sU = sqrt(phi.div(Math.PI));

    const ux = sU.mul(width - 1).add(0.5).div(width);
    const vy = tV.mul(height - 1).add(0.5).div(height);
    const tex = this.target.texture;
    return {
      radiance: texture(tex, vec2(ux.mul(0.5), vy), 0).rgb,
      transmittance: texture(tex, vec2(ux.mul(0.5).add(0.5), vy), 0).rgb,
    };
  }

  // -- per-frame update --------------------------------------------------------------------------

  /** Forces a re-render on the next {@link update} (profile changed outside the model, resize, ...). */
  invalidate(): void {
    this.forced = true;
  }

  private isDirty(altitudeM: number): boolean {
    if (this.forced) return true;
    if (this.model.profileVersion !== this.lastProfileVersion) return true;
    const scale = Math.max(altitudeM, 0.002 * this.model.uTopAltitude.value);
    if (Math.abs(altitudeM - this.lastAltitude) > (this.options.altitudeTolerance ?? 0.01) * scale) return true;
    const sunY = this.model.sunDirection.value.y;
    const elevation = (Math.asin(Math.min(1, Math.max(-1, sunY))) * 180) / Math.PI;
    return Math.abs(elevation - this.lastSunElevationDeg) > (this.options.sunTolerance ?? 0.05);
  }

  /**
   * Re-renders the table if the camera altitude or the sun's elevation moved past the tolerance. Call once per
   * frame before the scene renders, never during a render pass. Returns true when it rendered.
   */
  update(renderer: WebGPURenderer, altitudeM: number): boolean {
    if (!renderer.initialized || !this.isDirty(altitudeM)) return false;
    const sun = this.model.sunDirection.value;
    this.lutAltitude.value = Math.max(0, altitudeM);
    this.lutSunDirection.value.copy(sun);

    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
    renderer.setRenderTarget(previous);

    this.lastAltitude = altitudeM;
    this.lastSunElevationDeg = (Math.asin(Math.min(1, Math.max(-1, sun.y))) * 180) / Math.PI;
    this.lastProfileVersion = this.model.profileVersion;
    this.forced = false;
    this.renderCount++;
    return true;
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}
