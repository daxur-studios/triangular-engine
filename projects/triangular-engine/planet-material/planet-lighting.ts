import { Matrix3, Vector3, type IUniform } from 'three';
import { clamp, dot, exp, float, max, mix, normalize, pow, smoothstep, uniform, vec3 } from 'three/tsl';
import type { IPlanetContext } from './planet-context';
import type { ISurfaceSample } from './planet-surface-layers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** What a lighting stage gets: the lit colour so far and the product of all sun occluders. */
export interface ILightingInput {
  /** The lit (and emissive-added) colour, `vec3`. */
  readonly color: any;
  /** Product of the sun occluders, 0 (fully eclipsed) to 1 (unobstructed); `float(1)` with none. */
  readonly sunVisibility: any;
  /** The surface sample the layers produced. */
  readonly surface: ISurfaceSample;
  /**
   * The emissive stack's sum (`vec3`), already included in `color`; `null` with none. A stage that discards
   * `color` and relights from `surface.albedo` (Plan 049's `atmosphereLighting`) adds it back.
   */
  readonly emissive?: any;
}

/**
 * Stage 4: runs after the standard PBR lighting and returns the new `vec3` colour. It is the slot a
 * game replaces for toon lighting, and the one Plan 049's `atmosphereLighting` fills.
 */
export type LightingStage = (context: IPlanetContext, input: ILightingInput) => any;

/** Stage 6: always last, so game layers are hazed too. Takes and returns a `vec3`. */
export type AtmosphereStage = (context: IPlanetContext, color: any) => any;

/** The atmosphere stage's identity (pass-through). Plan 049 replaces it. */
export const identityAtmosphere: AtmosphereStage = (_context, color) => color;

/**
 * Lights a morphed surface as if it were still on the sphere: the normal used for shading is the
 * vertex's sphere normal turned by `uMorphLightingTurn`, not the morphed one (which is +Z everywhere
 * on the flat map). Pass it as the material's `lightingTurn` option. Same name and type as the GLSL
 * `IPlanetMorphLightingUniforms`, so the same object can drive both.
 */
export interface IPlanetMorphLightingUniforms {
  uMorphLightingTurn: IUniform<Matrix3>;
}

export function createPlanetMorphLightingUniforms(): IPlanetMorphLightingUniforms {
  return { uMorphLightingTurn: uniform(new Matrix3()) as unknown as IUniform<Matrix3> };
}

/** Day/night uniforms. Names and types match the GLSL `IPlanetDayNightUniforms`. */
export interface IPlanetDayNightUniforms {
  /** 0 = off, 1 = on. */
  uDayNightEnabled: IUniform<number>;
  /** Normalised sun vector in the body frame. */
  uSunDirection: IUniform<Vector3>;
  uNightAmbient: IUniform<number>;
  uTwilightWidth: IUniform<number>;
  uSunsetGlow: IUniform<number>;
  uNightColor: IUniform<Vector3>;
}

/** Creates the day/night uniforms as TSL uniform nodes, with the GLSL defaults. */
export function createPlanetDayNightUniforms(): IPlanetDayNightUniforms {
  return {
    uDayNightEnabled: uniform(0) as unknown as IUniform<number>,
    uSunDirection: uniform(new Vector3(0, 0, 1)) as unknown as IUniform<Vector3>,
    uNightAmbient: uniform(0.2) as unknown as IUniform<number>,
    uTwilightWidth: uniform(0.12) as unknown as IUniform<number>,
    uSunsetGlow: uniform(0.5) as unknown as IUniform<number>,
    uNightColor: uniform(new Vector3(0.09, 0.14, 0.24)) as unknown as IUniform<Vector3>,
  };
}

/**
 * A port of `enablePlanetDayNightLighting` as a lighting stage: a day factor from the sphere normal
 * against the sun direction (smooth over the twilight width), a golden-hour glow at the terminator
 * and a night colour floor. `sunVisibility` scales the day factor and the glow, so an eclipse darkens the
 * day side towards the night floor and takes the golden-hour glow out of the shadow.
 */
export function simpleDayNightLighting(uniforms: IPlanetDayNightUniforms): LightingStage {
  const enabled = uniforms.uDayNightEnabled as any;
  const sunDirection = uniforms.uSunDirection as any;
  const nightAmbient = uniforms.uNightAmbient as any;
  const twilightWidth = uniforms.uTwilightWidth as any;
  const sunsetGlow = uniforms.uSunsetGlow as any;
  const nightColor = uniforms.uNightColor as any;

  return (context, { color, sunVisibility }) => {
    const sunDot = dot(normalize(context.sphereNormal), normalize(sunDirection));
    const tw = max(float(0.01), twilightWidth);
    const dayFactor = smoothstep(tw.negate(), tw, sunDot).mul(sunVisibility);
    const sunsetRim = exp(pow(sunDot.div(tw.mul(1.5)), float(2)).negate()).mul(sunsetGlow).mul(sunVisibility);
    const sunsetTint = vec3(1.0, 0.52, 0.22);
    const ambientNight = nightColor.mul(nightAmbient);
    const lightMod = mix(ambientNight, vec3(1, 1, 1), dayFactor).add(
      sunsetTint.mul(sunsetRim).mul(float(1).sub(dayFactor.mul(0.6))),
    );
    // A blend, not a `select`: it is continuous, and a disabled stage returns the input colour exactly.
    return color.mul(mix(vec3(1, 1, 1), lightMod, clamp(enabled, 0, 1)));
  };
}

/**
 * The default way `sunVisibility` reaches the output: it scales the lit colour, keeping `floor` of it
 * (a stand-in for the ambient light the occluder does not remove). Exact only for a pure-sun scene;
 * a lighting stage that models the sun itself should use `sunVisibility` directly.
 */
export function sunVisibilityLighting(options: { floor?: number } = {}): LightingStage {
  const floor = options.floor ?? 0.15;
  return (_context, { color, sunVisibility }) => color.mul(mix(float(floor), float(1), sunVisibility));
}
