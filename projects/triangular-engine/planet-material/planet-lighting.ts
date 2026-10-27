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
 * Optional per-pixel inputs a lighting stage can take, for surfaces whose shading differs from the planet's sphere: a
 * canopy, a roof, an impostor. Each is a function of the planet context and the stage's input (so it can read fields a
 * surface layer put on `input.surface`), returning a TSL node. With neither given, a stage builds exactly the graph it
 * builds without inputs, so its output does not change.
 */
export interface IPlanetLightingInputs {
  /**
   * The shading normal for the direct sun term, a `vec3` in the same frame as `context.sphereNormal` (the planet's body
   * frame); it is normalised for you. The sky or ambient term keeps the sphere normal, so the sky light on a canopy, a
   * building and the far form that stands in for them is the same.
   */
  readonly normal?: (context: IPlanetContext, input: ILightingInput) => any;
  /**
   * How much direct sunlight reaches the pixel, a `float` from 0 (in a cast shadow) to 1 (in the sun); clamped to that
   * range. Unlike a sun occluder (`addSunOcclusion`, which feeds `sunVisibility`), it leaves the sky light alone, so a
   * shadow darkens only the direct sun.
   */
  readonly directShadow?: (context: IPlanetContext, input: ILightingInput) => any;
}

/** Options of {@link simpleDayNightLighting}. */
export interface ISimpleDayNightLightingOptions extends IPlanetLightingInputs {
  /**
   * The share of the day light that counts as sky light when `normal` or `directShadow` is given, 0 to 1. Default 0.35.
   * The stage has no sky model of its own, so a pixel in full shadow (or with its normal turned from the sun) keeps
   * this share of the day light, and the rest follows the direct sun. Unused without those inputs.
   */
  readonly skyShare?: number;
}

/**
 * A port of `enablePlanetDayNightLighting` as a lighting stage: a day factor from the sphere normal
 * against the sun direction (smooth over the twilight width), a golden-hour glow at the terminator
 * and a night colour floor. `sunVisibility` scales the day factor and the glow, so an eclipse darkens the
 * day side towards the night floor and takes the golden-hour glow out of the shadow.
 *
 * With `options.normal` or `options.directShadow` the day factor splits in two: `skyShare` of it stays on the sphere
 * normal (the sky), the rest is the direct sun, read with `normal`'s own sun angle and scaled by `directShadow`. The
 * golden-hour glow is direct light too: `directShadow` scales its direct share. Without either input the stage is
 * unchanged.
 */
export function simpleDayNightLighting(uniforms: IPlanetDayNightUniforms, options: ISimpleDayNightLightingOptions = {}): LightingStage {
  const enabled = uniforms.uDayNightEnabled as any;
  const sunDirection = uniforms.uSunDirection as any;
  const nightAmbient = uniforms.uNightAmbient as any;
  const twilightWidth = uniforms.uTwilightWidth as any;
  const sunsetGlow = uniforms.uSunsetGlow as any;
  const nightColor = uniforms.uNightColor as any;
  const skyShare = Math.min(1, Math.max(0, options.skyShare ?? 0.35));

  return (context, input) => {
    const { color, sunVisibility, emissive } = input;
    const sunDot = dot(normalize(context.sphereNormal), normalize(sunDirection));
    const tw = max(float(0.01), twilightWidth);
    let dayFactor = smoothstep(tw.negate(), tw, sunDot).mul(sunVisibility);
    let sunsetRim = exp(pow(sunDot.div(tw.mul(1.5)), float(2)).negate()).mul(sunsetGlow).mul(sunVisibility);
    if (options.normal || options.directShadow) {
      // The sky share stays on the sphere; the direct share follows the normal and the shadow.
      const shadow = options.directShadow ? clamp(options.directShadow(context, input), 0, 1) : null;
      let direct = options.normal
        ? smoothstep(tw.negate(), tw, dot(normalize(options.normal(context, input)), normalize(sunDirection))).mul(sunVisibility)
        : dayFactor;
      if (shadow) {
        direct = direct.mul(shadow);
        sunsetRim = sunsetRim.mul(mix(shadow, float(1), skyShare));
      }
      dayFactor = mix(direct, dayFactor, skyShare);
    }
    const sunsetTint = vec3(1.0, 0.52, 0.22);
    const ambientNight = nightColor.mul(nightAmbient);
    const lightMod = mix(ambientNight, vec3(1, 1, 1), dayFactor).add(
      sunsetTint.mul(sunsetRim).mul(float(1).sub(dayFactor.mul(0.6))),
    );
    // A blend, not a `select`: it is continuous, and a disabled stage returns the input colour exactly.
    // The emissive stack is already in `color` and is not lit by the sun: dim only the lit part, then add it back.
    const factor = mix(vec3(1, 1, 1), lightMod, clamp(enabled, 0, 1));
    return emissive ? color.sub(emissive).mul(factor).add(emissive) : color.mul(factor);
  };
}

/** Options of {@link sunVisibilityLighting}. */
export interface ISunVisibilityLightingOptions {
  /** The share of the lit colour an occluder or a shadow does not remove (a stand-in for ambient light). Default 0.15. */
  readonly floor?: number;
  /**
   * A cast shadow on the direct sun, 0 (shadowed) to 1 (lit); see {@link IPlanetLightingInputs.directShadow}. Here it
   * multiplies into `sunVisibility`, since this stage's only sky light is `floor`, which it keeps.
   */
  readonly directShadow?: IPlanetLightingInputs['directShadow'];
}

/**
 * The default way `sunVisibility` reaches the output: it scales the lit colour, keeping `floor` of it
 * (a stand-in for the ambient light the occluder does not remove). Exact only for a pure-sun scene;
 * a lighting stage that models the sun itself should use `sunVisibility` directly.
 *
 * The stage knows no sun direction, so it takes no `normal`: the PBR lighting before it has already shaded the
 * surface. Use {@link simpleDayNightLighting} or the atmosphere's lighting stage for a per-pixel normal.
 */
export function sunVisibilityLighting(options: ISunVisibilityLightingOptions = {}): LightingStage {
  const floor = options.floor ?? 0.15;
  return (context, input) => {
    const { color, emissive } = input;
    const visibility = options.directShadow
      ? input.sunVisibility.mul(clamp(options.directShadow(context, input), 0, 1))
      : input.sunVisibility;
    const factor = mix(float(floor), float(1), visibility);
    // Emissive light is not sun light: it is already in `color`, so dim only the rest.
    return emissive ? color.sub(emissive).mul(factor).add(emissive) : color.mul(factor);
  };
}
