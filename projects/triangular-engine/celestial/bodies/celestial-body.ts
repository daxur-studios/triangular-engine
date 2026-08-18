import { ITerrainDef } from '../surfaces/terrain-def';
import { IKeplerianElements } from '../orbits/kepler-elements';
import { Vec3d } from '../math/vec3';

/** `ρ(h) = ρ0·e^(−h/H)` atmosphere model parameters (doc 03 §3/§5.5). */
export interface IAtmosphereDef {
  seaLevelDensityKgM3: number;
  scaleHeightM: number;
  /** Altitude above which `airDensity` returns 0. */
  topAltitudeM: number;
  visual?: {
    /** Zenith/space-halo tint, linear RGB 0–1. */
    colorRgb: [number, number, number];
    /** Horizon/sunset tint, linear RGB 0–1. */
    horizonColorRgb?: [number, number, number];
    /** Overall density/intensity multiplier for the visual only. Default 1. */
    intensity?: number;
  };
}

export type CelestialBodyKind = 'star' | 'planet' | 'moon';

/** Distant-rendering contract for a thin particulate ring system. */
export interface IPlanetaryRingSystemDef {
  /** Stable identifier within the parent body. */
  id: string;
  /** Stable seed reserved for deterministic close-particle generation in P2. */
  seed: number;
  /** Must not overlap another ring system on the same body. */
  innerRadiusM: number;
  outerRadiusM: number;
  /** Tilt away from the body's equatorial plane. Defaults to 0. */
  inclinationRad?: number;
  /** Rotation of the tilted plane around the body's spin axis. Defaults to 0. */
  ascendingNodeRad?: number;
  /** Distant-render visibility. Useful for authoring and diagnostic scenes. Defaults to true. */
  visible?: boolean;
  /** Normalized authored optical-depth/color profile understood by the distant renderer. */
  profile: 'saturn-like';
  /** Strength of the ice-dominated forward-scattering lobe. */
  forwardScattering?: number;
  /** Linear RGB tint applied to the authored ring palette. Defaults to white. */
  colorRgb?: [number, number, number];
  /** Overall visual density multiplier. Defaults to 1. */
  intensity?: number;
  /** Multiplier applied when the ring attenuates direct light on its parent. */
  shadowOpacity?: number;
}

/**
 * A body's physical/orbital-parent record (map-view-mvp.md §2). The stock
 * catalog exports records/a collection, never a singleton-star service, so
 * later multi-star systems are not excluded.
 */
export interface ICelestialBody {
  id: string;
  kind: CelestialBodyKind;
  radiusM: number;
  /** Standard gravitational parameter, GM, in m³/s². */
  muM3PerS2: number;
  parentBodyId?: string;
  /** Orbit around `parentBodyId`, in `parentBodyId`'s frame. Present iff `parentBodyId` is (patched-conics.md decision 2). */
  orbit?: IKeplerianElements;
  /**
   * Fixed position in the parent's inertial frame. Intended for diagnostic
   * bodies that must have exactly zero parent-relative velocity. Mutually
   * exclusive with `orbit`.
   */
  fixedPositionRelativeToParentM?: Vec3d;
  axialTiltRad?: number;
  rotationPeriodS?: number;
  rotationEpochUt?: number;
  rotationInitialPhaseRad?: number;
  atmosphere?: IAtmosphereDef;
  /** Optional independently oriented thin particulate ring systems. */
  ringSystems?: readonly IPlanetaryRingSystemDef[];
  /** Peak zonal wind speed (`weather-seasons-climate.md` W1); 0/absent means no wind, unchanged behavior. */
  windScaleMPerS?: number;
  /** Serializable body-fixed surface configuration; omitted means datum sphere. */
  terrain?: ITerrainDef;
}

/**
 * Derives `muM3PerS2` from a target surface gravity instead of a hand-picked
 * constant (`mu = g * radius^2`, from `g = mu / radius^2`) — so a body's
 * "how does it feel to stand on" is an explicit, independent knob from its
 * size (04_north-star-features.md §13: tiny planets, real surface gravity).
 */
export function muForSurfaceGravity(
  radiusM: number,
  surfaceGravityMPerS2: number,
): number {
  return surfaceGravityMPerS2 * radiusM * radiusM;
}
