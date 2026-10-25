import { Vector3 } from 'three';
import {
  clamp,
  dot,
  float,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  modelWorldMatrix,
  select,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { IPlanetContext, ISurfaceSample, SurfaceLayer } from 'triangular-engine/planet-material';
import { RUNWAY_LENGTH_M, RUNWAY_WIDTH_M } from './runway-site';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Plan 063 spike S1, Q2: the runway as an analytic SDF surface layer. No textures are read, so the explicit
 * level-0 fetch rule of `streamedMaterialLayer` does not come into play here; the `fwidth` calls are unconditional
 * (the layer has no non-uniform branches, `select` evaluates both sides).
 *
 * Position is body-fixed metres (`bodyFixedLocal` lifted out of the camera-following render anchor, so it stays welded
 * to geography as the view morphs). The runway tangents are
 * perpendicular to the site direction, so `dot(position, along)` is the along-runway coordinate with no subtraction
 * of the site position.
 */
export interface IRunwayLayer {
  readonly layer: SurfaceLayer;
  /** 1 = drawn. Live uniform; starts at 0 until the site is known. */
  readonly enabled: any;
  setSite(along: readonly number[], across: readonly number[]): void;
}

/** Coverage of a line of half width `halfWidth` at signed distance `distance`, filtered by the pixel footprint `px`. */
const lineCoverage = (distance: any, halfWidth: any, px: any): any =>
  clamp(halfWidth.sub(distance.abs()).div(px).add(0.5), 0, 1);

export function runwayLayer(): IRunwayLayer {
  const enabled: any = uniform(0);
  const alongAxis: any = uniform(new Vector3(1, 0, 0));
  const acrossAxis: any = uniform(new Vector3(0, 0, 1));
  const asphalt: any = uniform(new Vector3(0.045, 0.045, 0.05));
  const paint: any = uniform(new Vector3(0.62, 0.62, 0.58));

  const layer: SurfaceLayer = (context: IPlanetContext, below: ISurfaceSample) => {
    // `bodyFixedLocal` is relative to the render anchor, which follows the camera: lift it to body-fixed metres
    // the way the morph graph does (`modelWorldMatrix`, minus the body centre in scene space).
    const position: any = modelWorldMatrix
      .mul(vec4(context.bodyFixedLocal, 1))
      .xyz.sub(context.uniforms.uBodyCentreScene as any);
    const a = dot(position, alongAxis);
    const b = dot(position, acrossAxis);
    const halfL = float(RUNWAY_LENGTH_M / 2);
    const halfW = float(RUNWAY_WIDTH_M / 2);

    // Rectangle SDF in metres (negative inside).
    const q = vec2(a.abs().sub(halfL), b.abs().sub(halfW));
    const d = length(max(q, 0)).add(min(max(q.x, q.y), 0));
    const px = max(fwidth(d), float(0.02));
    // Past one pixel the strip is narrower than the footprint: spread it over the footprint at the right weight.
    const spread = min(float(1), float(RUNWAY_WIDTH_M).div(px));
    const body = clamp(float(0.5).sub(d.div(px)), 0, 1).mul(spread);

    // Markings: centreline dashes, edge lines, threshold bars. Each fades out as the pixel footprint outgrows it.
    const fade = (width: number) => float(1).sub(smoothstep(width * 0.6, width * 3.5, px));
    const inside = clamp(float(0.5).sub(max(q.x, q.y).div(px)), 0, 1);

    const centreWidth = 0.45;
    const dashPhase = fract(a.div(50)); // 30 m paint, 20 m gap
    const dash = clamp(float(0.6).sub(dashPhase).div(px.div(50)).add(0.5), 0, 1).mul(
      clamp(dashPhase.div(px.div(50)).add(0.5), 0, 1),
    );
    const centre = lineCoverage(b, float(centreWidth), px).mul(dash).mul(fade(centreWidth * 2));

    const edgeWidth = 0.3;
    const edge = lineCoverage(b.abs().sub(halfW.sub(1.5)), float(edgeWidth), px)
      .mul(fade(edgeWidth * 2))
      .mul(clamp(float(0.5).sub(q.x.div(px)), 0, 1));

    // Threshold bars: 8 stripes across the runway at each end, 1.8 m wide, 30 m long, starting 6 m from the end.
    const fromEnd = halfL.sub(a.abs());
    const barZone = lineCoverage(fromEnd.sub(21), float(15), px);
    const stripe = lineCoverage(fract(b.div(5.0)).sub(0.5).mul(5.0), float(0.9), px);
    const bars = barZone.mul(stripe).mul(fade(1.8)).mul(clamp(float(0.5).sub(b.abs().sub(halfW.sub(2.5)).div(px)), 0, 1));

    const marks = max(max(centre, edge), bars).mul(inside);
    const albedo = mix(below.albedo, mix(vec3(asphalt), vec3(paint), marks), body);
    const roughness = mix(below.roughness, float(0.85), body);
    return {
      ...below,
      albedo: select(enabled.greaterThan(0.5), albedo, below.albedo),
      roughness: select(enabled.greaterThan(0.5), roughness, below.roughness),
    };
  };

  return {
    layer,
    enabled,
    setSite(along, across) {
      alongAxis.value.set(along[0], along[1], along[2]);
      acrossAxis.value.set(across[0], across[1], across[2]);
    },
  };
}
