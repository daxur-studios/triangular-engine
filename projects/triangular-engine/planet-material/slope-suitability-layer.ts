import { Color } from 'three';
import { clamp, cos, dot, float, max, min, mix, normalize, smoothstep, uniform } from 'three/tsl';
import type { IPlanetContext } from './planet-context';
import type { ISurfaceSample, SurfaceLayer } from './planet-surface-layers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Controls for the terrain-slope suitability overlay. */
export interface ISlopeSuitabilityLayerOptions {
  /** Vehicle's maximum drivable grade in degrees (default 18). */
  readonly maxSlopeDegrees?: number;
  /** Width of the colour transition around the threshold, in degrees (default 4). */
  readonly transitionDegrees?: number;
  /** Overlay opacity from 0 to 1 (default 0.85). */
  readonly opacity?: number;
  /** Colour below the maximum slope (default green). */
  readonly safeColor?: string | Color;
  /** Colour above the maximum slope (default red). */
  readonly steepColor?: string | Color;
  /** Start visible (default false). */
  readonly enabled?: boolean;
}

/** A reusable terrain grade overlay. Its controls are uniforms; changing them never recompiles the material. */
export interface ISlopeSuitabilityLayer {
  readonly layer: SurfaceLayer;
  /** 1 = visible, 0 = hidden. */
  readonly enabled: any;
  /** Vehicle's maximum drivable slope, in degrees. */
  readonly maxSlopeDegrees: any;
  /** Width of the transition band, in degrees. */
  readonly transitionDegrees: any;
  /** Overlay opacity, 0 to 1. */
  readonly opacity: any;
  readonly safeColor: any;
  readonly steepColor: any;
}

/**
 * Colours terrain from green to red around a vehicle's maximum slope. The grade is estimated from the angle between the
 * terrain's surface normal and the planet's radial direction. It uses a cosine threshold rather than `acos`, so it is a
 * lightweight fragment-stage calculation and adds no vertex attributes. The threshold, transition, opacity and colours
 * are uniforms; vehicle changes do not rebuild the shader.
 *
 * This is a visual suitability estimate. It does not change terrain queries, route planning or vehicle physics.
 */
export function slopeSuitabilityLayer(
  options: ISlopeSuitabilityLayerOptions = {},
): ISlopeSuitabilityLayer {
  const enabled: any = uniform(options.enabled === true ? 1 : 0);
  const maxSlopeDegrees: any = uniform(options.maxSlopeDegrees ?? 18);
  const transitionDegrees: any = uniform(options.transitionDegrees ?? 4);
  const opacity: any = uniform(options.opacity ?? 0.85);
  const safeColor: any = uniform(
    options.safeColor instanceof Color ? options.safeColor : new Color(options.safeColor ?? '#35c759'),
  );
  const steepColor: any = uniform(
    options.steepColor instanceof Color ? options.steepColor : new Color(options.steepColor ?? '#e34234'),
  );

  const layer: SurfaceLayer = (context: IPlanetContext, below: ISurfaceSample) => {
    const slopeDot = clamp(
      dot(normalize(context.terrainNormal ?? context.sphereNormal), normalize(context.radialDirection)),
      -1,
      1,
    );
    const maximum = clamp(maxSlopeDegrees, 0, 89.9).mul(Math.PI / 180);
    const halfBand = clamp(transitionDegrees, 0.1, 30).mul(Math.PI / 360);
    const lowerAngle = max(maximum.sub(halfBand), float(0));
    const upperAngle = min(maximum.add(halfBand), float(Math.PI / 2));
    const suitability = smoothstep(cos(upperAngle), cos(lowerAngle), slopeDot);
    const gradeColor = mix(steepColor, safeColor, suitability);
    const amount = clamp(enabled, 0, 1).mul(clamp(opacity, 0, 1));
    return { ...below, albedo: mix(below.albedo, gradeColor, amount) };
  };

  return { layer, enabled, maxSlopeDegrees, transitionDegrees, opacity, safeColor, steepColor };
}
