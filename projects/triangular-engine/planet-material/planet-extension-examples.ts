import { Color, Vector3 } from 'three';
import { abs, acos, asin, clamp, dot, float, length, max, mix, normalize, smoothstep, uniform, vec3 } from 'three/tsl';
import type { SunOcclusion, SurfaceLayer } from './planet-surface-layers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Reference extensions for `PlanetSurfaceMaterial`'s slots: a game-side surface layer and a sun occluder.
 * They are what "writing a layer" looks like (Plan 050 Phase 4), and they are real, spec'd code, so a game
 * can use them as they are or copy them. Both only read the planet context, and every tunable is a live
 * uniform node: changing `.value` never recompiles.
 */

export interface IRoadLayerOptions {
  /** Unit normal of the road's great circle, in the body frame (the road is the set of points 90 degrees from it). */
  readonly axis?: Vector3;
  /** Half-width of the road in radians of arc (default 0.01). */
  readonly halfWidth?: number;
  readonly color?: string | Color;
  /** 0..1 blend of the road over the layer below (default 1). */
  readonly opacity?: number;
}

/** A road along a great circle: tints the albedo and makes the surface rougher and non-metallic. */
export function roadLayer(options: IRoadLayerOptions = {}): {
  layer: SurfaceLayer;
  axis: any;
  halfWidth: any;
  color: any;
  opacity: any;
} {
  const axis: any = uniform((options.axis ?? new Vector3(0, 1, 0)).clone().normalize());
  const halfWidth: any = uniform(options.halfWidth ?? 0.01);
  const color: any = uniform(options.color instanceof Color ? options.color : new Color(options.color ?? '#3a3631'));
  const opacity: any = uniform(options.opacity ?? 1);

  const layer: SurfaceLayer = (context, below) => {
    // Angular distance from the great circle: asin of the normal's component along the circle's axis.
    const distance = abs(asin(clamp(dot(normalize(context.radialDirection), axis), -1, 1)));
    // Solid in the middle, a soft edge over the outer 30%.
    const mask = float(1).sub(smoothstep(halfWidth.mul(0.7), halfWidth, distance)).mul(opacity);
    return {
      ...below,
      albedo: mix(below.albedo, color, mask),
      roughness: mix(below.roughness, float(0.95), mask),
      metalness: mix(below.metalness, float(0), mask),
    };
  };
  return { layer, axis, halfWidth, color, opacity };
}

export interface IMoonEclipseOptions {
  /** Unit direction towards the sun (parallel rays), in the body frame. */
  readonly sunDirection?: Vector3;
  /** Moon centre in the body frame, in the same units as `planetRadius`. */
  readonly moonPosition?: Vector3;
  readonly moonRadius?: number;
  readonly planetRadius?: number;
  /** The sun's angular radius in radians (default 0.0047, the sun seen from Earth). */
  readonly sunAngularRadius?: number;
}

/**
 * A moon eclipse as a sun occluder. For a surface point `P`, the moon is seen from `P` at angular radius
 * `asin(moonRadius / |M - P|)`, and its centre is `separation` radians from the sun's centre. Visibility is
 * 0 inside the umbra (`separation < moonAngle - sunAngle`), 1 outside the penumbra
 * (`separation > moonAngle + sunAngle`), smooth between. A moon on the far side of the sun axis has a large
 * separation, so it never shades the point.
 */
export function moonEclipseOcclusion(options: IMoonEclipseOptions = {}): {
  occlusion: SunOcclusion;
  sunDirection: any;
  moonPosition: any;
  moonRadius: any;
  planetRadius: any;
  sunAngularRadius: any;
} {
  const sunDirection: any = uniform((options.sunDirection ?? new Vector3(0, 0, 1)).clone().normalize());
  const moonPosition: any = uniform((options.moonPosition ?? new Vector3(0, 0, 3)).clone());
  const moonRadius: any = uniform(options.moonRadius ?? 0.27);
  const planetRadius: any = uniform(options.planetRadius ?? 1);
  const sunAngularRadius: any = uniform(options.sunAngularRadius ?? 0.0047);

  const occlusion: SunOcclusion = (context) => {
    const point = normalize(context.radialDirection).mul(planetRadius);
    const toMoon = moonPosition.sub(point);
    const distance = max(length(toMoon), float(1e-4));
    const moonAngle = asin(clamp(moonRadius.div(distance), 0, 1));
    const separation = acos(clamp(dot(toMoon.div(distance), normalize(sunDirection)), -1, 1));
    const umbra = max(moonAngle.sub(sunAngularRadius), float(0));
    const penumbra = moonAngle.add(sunAngularRadius);
    return smoothstep(umbra, penumbra, separation);
  };
  return { occlusion, sunDirection, moonPosition, moonRadius, planetRadius, sunAngularRadius };
}

/** A warm city-light emissive: lights the night side only, `strength` scaled by how dark the surface is lit. */
export function nightLightsEmissive(options: { color?: string | Color; strength?: number } = {}): {
  emissive: (context: any) => any;
  sunDirection: any;
  color: any;
  strength: any;
} {
  const sunDirection: any = uniform(new Vector3(0, 0, 1));
  const color: any = uniform(options.color instanceof Color ? options.color : new Color(options.color ?? '#ffb347'));
  const strength: any = uniform(options.strength ?? 0.6);
  return {
    sunDirection,
    color,
    strength,
    emissive: (context) => {
      const sunDot = dot(normalize(context.radialDirection), normalize(sunDirection));
      // 1 deep in the night, 0 by the terminator.
      const night = float(1).sub(smoothstep(float(-0.15), float(0.05), sunDot));
      return vec3(color).mul(strength).mul(night);
    },
  };
}
