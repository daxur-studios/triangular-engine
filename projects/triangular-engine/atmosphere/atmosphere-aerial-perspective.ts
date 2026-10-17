import { ClampToEdgeWrapping, HalfFloatType, LinearFilter, Matrix3, Matrix4, RGBAFormat, RenderTarget, Vector3 } from 'three';
import { NodeMaterial, QuadMesh, type WebGPURenderer } from 'three/webgpu';
import {
  Fn,
  asin,
  acos,
  clamp,
  exp,
  floor,
  float,
  log,
  mat3,
  max,
  min,
  mix,
  normalize,
  outputStruct,
  pow,
  select,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { AtmosphereGpuModel } from './atmosphere-gpu-model';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AtmosphereAerialPerspectiveOptions {
  /** Texels across the screen per depth slice. Default 64. */
  width?: number;
  /** Texels down the screen per depth slice. Default 36. */
  height?: number;
  /** Depth slices. Default 32. */
  slices?: number;
  /** Samples per texel's ray. Default {@link AtmosphereGpuModel.defaultSteps}. */
  steps?: number;
  /**
   * How far above the sphere the surface may rise, as a fraction of the air's height. It lengthens the table's
   * range past the horizon so mountains behind it are inside the table. Default 0.1.
   */
  reliefFraction?: number;
}

/** What the table needs from the camera each frame, all in the local frame whose y is the camera's radial direction. */
export interface AtmosphereAerialPerspectiveView {
  /** Camera altitude above the ground, metres. */
  altitude: number;
  /** The camera's inverse projection matrix. */
  projectionInverse: Matrix4;
  /** Maps a view-space direction to the local frame. */
  viewToLocal: Matrix3;
  /** Unit direction to the sun in the local frame. */
  sunLocal: Vector3;
}

/**
 * Hillaire's aerial-perspective froxel table (Plan 049, Phase 3): the in-scattered radiance and the transmittance
 * from the camera to a point, for a grid of screen positions and distances, in a small render target. A surface
 * fragment then reads the haze in front of it with one filtered fetch (two slices) instead of marching a ray, and
 * the cost no longer depends on how many pixels the planet covers.
 *
 * Layout: the screen is `width x height` texels, repeated for each of `slices` distances, side by side in one
 * image; radiance and optical depth (`-ln` of the transmittance) are two attachments of the same target. Slice `k` holds the air from the camera
 * to the distance `rangeMin + (k / (slices - 1))^3 (rangeMax - rangeMin)`: the cube root mapping crowds the
 * slices near the camera. Every texel marches its own ray to its slice's distance and does not stop at the sphere of the ground
 * (`ignoreGround`): terrain rises above it, and a texel whose ray dips under the sphere must still stand for the
 * distance it is asked about, or the table would break along the horizon and the planet's limb.
 *
 * From above the air the slices run along each ray's own span instead: the last slice is where the ray meets the
 * ground (or, for a ray that misses it, passes closest to the planet) and the first where it enters the air, again
 * cube-root spaced towards the ground. A surface point then sits at the same slice whichever way the neighbouring
 * rays tilt, which matters because the sphere falls away under a tilted ray by an amount comparable to the air's
 * height. The two layouts agree where they meet, at the top of the air.
 *
 * The table is rendered again only when the camera, the sun or the profile moved.
 */
export class AtmosphereAerialPerspectiveLut {
  readonly width: number;
  readonly height: number;
  readonly slices: number;
  readonly target: RenderTarget;
  /** The distances (metres) the first and last slice stand for in the last render; lookups use these. */
  readonly rangeMin = uniform(0);
  readonly rangeMax = uniform(1);
  /** Number of times the table was rendered. */
  renderCount = 0;

  private readonly lutAltitude = uniform(0);
  /** 1 while the camera is above the air: slices then run along each ray's own span (see the class note). */
  private readonly lutOutside = uniform(0);
  private readonly lutSun = uniform(new Vector3(0, 1, 0));
  private readonly lutProjectionInverse = uniform(new Matrix4());
  private readonly lutViewToLocal = uniform(new Matrix3());
  private readonly quad: QuadMesh;
  private readonly material: NodeMaterial;
  private readonly signature: number[] = [];
  private lastProfileVersion = -1;
  private forced = true;

  constructor(
    readonly model: AtmosphereGpuModel,
    private readonly options: AtmosphereAerialPerspectiveOptions = {},
  ) {
    this.width = options.width ?? 64;
    this.height = options.height ?? 36;
    this.slices = options.slices ?? 32;
    this.target = new RenderTarget(this.width * this.slices, this.height, {
      count: 2,
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

  private buildRenderNode(): any {
    const model = this.model;
    const { slices } = this;
    const marched: any = Fn(() => {
      const coord = uv();
      const sx = coord.x.mul(slices);
      const slice = clamp(floor(sx), 0, slices - 1);
      const tileU = sx.sub(slice);
      const ndc: any = vec2(tileU.mul(2).sub(1), coord.y.mul(2).sub(1));

      const w = slice.div(slices - 1);

      // Depth 0 is in front of the eye under both clip conventions and, unlike the far plane, is well conditioned for a huge far.
      const far: any = this.lutProjectionInverse.mul(vec4(ndc, 0, 1));
      const dirView = normalize(far.xyz.div(far.w));
      const dir = this.aimAtPlanet(normalize((this.lutViewToLocal as any).mul(dirView)));
      const ends = this.rayEnds(dir);
      const inAir = this.rangeMin.add(w.mul(w).mul(w).mul(this.rangeMax.sub(this.rangeMin)));
      const fromSpace = ends.tEnd.sub(float(1).sub(w).pow(3).mul(ends.tEnd.sub(ends.tStart)));
      const distance = select(this.lutOutside.greaterThan(0.5), fromSpace, inAir);
      const m = model.march({
        altitude: this.lutAltitude,
        dir,
        sunDir: this.lutSun,
        maxDistance: distance,
        steps: this.options.steps,
        ignoreGround: true,
      });
      // Optical depth, not transmittance: it varies far more smoothly (linearly in the path), so the filter does not smear
      // the steep fall-off across a planet's limb.
      return (mat3 as any)(m.radiance, log(max(m.transmittance, 1e-30)).negate(), vec3(0));
    })().toVar();
    return (outputStruct as any)(vec4(marched[0], 1), vec4(marched[1], 1));
  }

  /**
   * From above the air, a texel whose ray misses the planet is aimed at its limb instead: no surface is seen along
   * it, and the tabulated haze there stands in for the last texel of the disc, which would otherwise be filtered
   * with air-free texels and lose the limb's brightening. In the air nothing changes.
   */
  private aimAtPlanet(dir: any): any {
    const R = this.model.uRadius;
    const beta = asin(clamp(R.div(R.add(this.lutAltitude)), 0, 1)).mul(0.9999);
    const alpha = acos(clamp(dir.y.negate(), -1, 1));
    const sideways = normalize(vec3(dir.x, 0, dir.z).add(vec3(1e-9, 0, 0)));
    const aimed = vec3(sideways.x.mul(beta.sin()), beta.cos().negate(), sideways.z.mul(beta.sin()));
    return select((alpha.greaterThan(beta) as any).and(this.lutOutside.greaterThan(0.5) as any), aimed, dir);
  }

  /**
   * Where a ray from the camera is worth tabulating, for a camera above the air: from where it enters the air to
   * the ground it hits, or, for a ray that misses the ground, to its closest approach to the planet (so the end is
   * continuous across the planet's limb). Surfaces only exist up to there.
   */
  private rayEnds(dir: any): { tStart: any; tEnd: any } {
    const trace = this.model.traceRay({ altitude: this.lutAltitude, dir, maxDistance: float(1e30) });
    const closest = this.model.uRadius.add(trace.h).mul(dir.y).negate();
    const missEnd = min(max(closest, trace.tStart), trace.tEnd);
    const hits: any = trace.hitsGround;
    const tEnd = select(trace.span.greaterThan(0) as any, select(hits, trace.tEnd, missEnd), trace.tStart);
    return { tStart: trace.tStart, tEnd };
  }

  /**
   * The haze in front of a surface point: `radiance` is the in-scattered light (already multiplied by the sun
   * irradiance, before exposure) and `transmittance` what is left of the colour behind. `ndc` is the point's
   * normalised device position (`xy / w` of the clip position), `distance` its distance from the camera in
   * metres and `dirView` the unit view-space direction to it. Inside an `Fn`.
   */
  lookup(ndc: any, distance: any, dirView: any): { radiance: any; transmittance: any } {
    const { width, height, slices } = this;
    const range = max(this.rangeMax.sub(this.rangeMin), 1);
    const wInAir = pow(clamp(distance.sub(this.rangeMin).div(range), 0, 1), float(1 / 3));
    const ends = this.rayEnds(normalize((this.lutViewToLocal as any).mul(dirView)));
    const u = clamp(ends.tEnd.sub(distance).div(max(ends.tEnd.sub(ends.tStart), 1e-3)), 0, 1);
    const wFromSpace = float(1).sub(pow(u, float(1 / 3)));
    const w = select(this.lutOutside.greaterThan(0.5), wFromSpace, wInAir);
    const f = w.mul(slices - 1);
    const k0 = floor(min(f, float(slices - 2)));
    const mixK = f.sub(k0);

    // Texel-space position inside a tile, kept at least half a texel from the edge so the filter never reads the next slice.
    const ux = clamp(ndc.x.mul(0.5).add(0.5).mul(width), 0.5, width - 0.5);
    const vy = clamp(ndc.y.mul(0.5).add(0.5).mul(height), 0.5, height - 0.5).div(height);
    const at = (k: any) => vec2(k.mul(width).add(ux).div(width * slices), vy);
    const tex = this.target.textures;

    const radiance = mix(texture(tex[0], at(k0), 0).rgb, texture(tex[0], at(k0.add(1)), 0).rgb, mixK);
    const opticalDepth = mix(texture(tex[1], at(k0), 0).rgb, texture(tex[1], at(k0.add(1)), 0).rgb, mixK);
    const transmittance = exp(opticalDepth.negate());
    return { radiance, transmittance };
  }

  /** The distance range of the table for a camera at `altitudeM`: from where the air begins to past the horizon. */
  rangeFor(altitudeM: number): { min: number; max: number } {
    const R = this.model.uRadius.value as number;
    const top = this.model.uTopAltitude.value as number;
    const h = Math.max(0, altitudeM);
    const horizon = (x: number) => Math.sqrt(x * (2 * R + x));
    const relief = this.options.reliefFraction ?? 0.1;
    return { min: Math.max(0, h - top), max: Math.max(horizon(h) + horizon(relief * top), 1) };
  }

  private isOutside(altitudeM: number): boolean {
    return altitudeM >= (this.model.uTopAltitude.value as number);
  }

  /** Forces a re-render on the next {@link update}. */
  invalidate(): void {
    this.forced = true;
  }

  private isDirty(view: AtmosphereAerialPerspectiveView): boolean {
    const next = [view.altitude, this.isOutside(view.altitude) ? 1 : 0, ...view.projectionInverse.elements, ...view.viewToLocal.elements, ...view.sunLocal.toArray()];
    let dirty = this.forced || this.model.profileVersion !== this.lastProfileVersion || next.length !== this.signature.length;
    if (!dirty) {
      // Altitude relative to the air's height; the rest are unit-scale numbers.
      const altitudeTolerance = 0.005 * Math.max(view.altitude, 0.002 * (this.model.uTopAltitude.value as number));
      dirty = Math.abs(next[0] - this.signature[0]) > altitudeTolerance;
      for (let i = 1; !dirty && i < next.length; i++) dirty = Math.abs(next[i] - this.signature[i]) > 1e-5;
    }
    if (dirty) {
      this.signature.length = 0;
      this.signature.push(...next);
    }
    return dirty;
  }

  /**
   * Re-renders the table if the camera, the sun or the profile moved. Call once per frame before the scene
   * renders, never during a render pass. Returns true when it rendered.
   */
  update(renderer: WebGPURenderer, view: AtmosphereAerialPerspectiveView): boolean {
    if (!renderer.initialized || !this.isDirty(view)) return false;
    this.lutAltitude.value = Math.max(0, view.altitude);
    this.lutOutside.value = this.isOutside(view.altitude) ? 1 : 0;
    this.lutSun.value.copy(view.sunLocal);
    this.lutProjectionInverse.value.copy(view.projectionInverse);
    this.lutViewToLocal.value.copy(view.viewToLocal);
    const range = this.rangeFor(view.altitude);
    this.rangeMin.value = range.min;
    this.rangeMax.value = range.max;

    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
    renderer.setRenderTarget(previous);

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
