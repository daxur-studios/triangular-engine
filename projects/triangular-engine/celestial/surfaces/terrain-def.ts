/** A serializable low-frequency field that can weight a terrain generator. */
export interface INoiseTerrainMaskDef {
  kind: 'noise-mask-3d';
  frequency: number;
  octaves: number;
  lacunarity: number;
  persistence: number;
  seedOffset?: number;
  /** Noise values at or below this threshold produce zero weight. */
  lowerThreshold: number;
  /** Noise values at or above this threshold produce full weight. */
  upperThreshold: number;
}

export type TerrainMaskDef = INoiseTerrainMaskDef;

/** The first deterministic generator in the compositional terrain stack. */
export interface IFractalNoiseTerrainGeneratorDef {
  kind: 'fractal-noise-3d';
  amplitudeM: number;
  frequency: number;
  octaves: number;
  lacunarity: number;
  persistence: number;
  seedOffset?: number;
  /** Optional region weight; omission means this generator applies globally. */
  mask?: TerrainMaskDef;
}

/** Ridged fractal noise for mountain ranges and canyon walls. */
export interface IRidgedFractalTerrainGeneratorDef {
  kind: 'ridged-fractal-3d';
  amplitudeM: number;
  frequency: number;
  octaves: number;
  lacunarity: number;
  persistence: number;
  /** Ridge sharpness: `(1 - |n|)^ridgeExponent`. Must be finite and >= 1. */
  ridgeExponent: number;
  seedOffset?: number;
  mask?: TerrainMaskDef;
}

/**
 * Low-frequency signed terrain used to establish ocean basins, continental
 * shelves, and broad land masses before local relief is added. The sampled
 * noise value at `seaLevelThreshold` maps to exactly zero elevation.
 */
export interface IContinentalTerrainGeneratorDef {
  kind: 'continental-3d';
  frequency: number;
  octaves: number;
  lacunarity: number;
  persistence: number;
  seedOffset?: number;
  /** Noise values below this threshold form ocean; values above it form land. */
  seaLevelThreshold: number;
  /** Noise distance on either side of the threshold over which shelf height/depth ramps to its full value. */
  transitionWidth: number;
  /** Positive maximum depth produced below sea level. */
  oceanDepthM: number;
  /** Positive broad elevation produced above sea level before local relief. */
  landHeightM: number;
  /**
   * Optional independent low-frequency field that varies shelf width along
   * the coast. `strength: 0` is uniform; values approaching 1 mix narrow,
   * steep coasts with wider shallow beaches without moving the coastline.
   */
  coastVariation?: {
    frequency: number;
    octaves: number;
    lacunarity: number;
    persistence: number;
    seedOffset?: number;
    strength: number;
  };
  mask?: TerrainMaskDef;
}

/** Jittered-lattice crater field with a parabolic bowl and raised rim. */
export interface ICraterFieldTerrainGeneratorDef {
  kind: 'crater-field-3d';
  cellFrequency: number;
  /** Probability in [0, 1] that a given lattice cell hosts a crater. */
  craterProbability: number;
  /** Crater radius range, in fractions of the lattice cell (each <= 0.5). */
  minRadiusCells: number;
  maxRadiusCells: number;
  depthM: number;
  rimHeightM: number;
  seedOffset?: number;
  mask?: TerrainMaskDef;
}

export type TerrainGeneratorDef =
  | IFractalNoiseTerrainGeneratorDef
  | IRidgedFractalTerrainGeneratorDef
  | IContinentalTerrainGeneratorDef
  | ICraterFieldTerrainGeneratorDef;

/**
 * Surface albedo for a terrain layer or biome (`planet-surface-texture.md`).
 * Unlike `IAtmosphereDef.visual` (a linear shader uniform), these values are
 * baked into an sRGB `DataTexture` and GPU-decoded at sample time, so pick
 * them the way you would any other artist-authored albedo color.
 */
export interface ITerrainVisualDef {
  /** Base albedo, sRGB 0–1. */
  colorRgb: [number, number, number];
  /** Optional tint blended in toward `maxElevationM` (snow caps, bare rock), sRGB 0–1. */
  highColorRgb?: [number, number, number];
}

/** One named region of a terrain: a mask field plus its own generator stack. */
export interface ITerrainBiomeDef {
  /** Unique, non-empty identifier within the owning terrain def. */
  id: string;
  /** Low-frequency region field; normalized against sibling biomes per sample. */
  mask: TerrainMaskDef;
  generators: readonly TerrainGeneratorDef[];
  /** Albedo for this biome; omitted biomes fall back to the terrain's global `visual`. */
  visual?: ITerrainVisualDef;
}

/**
 * Visual-only ocean band (`planet-surface-texture.md`): texels at or below
 * `seaLevelM` render as water. Does not affect elevation sampling, colliders,
 * or splashdown — a physical ocean is a separate, unscheduled decision.
 */
export interface ITerrainOceanDef {
  /** Radius offset in meters; texels with elevation below this are water. */
  seaLevelM: number;
  /** sRGB 0–1 (see `ITerrainVisualDef.colorRgb`). */
  shallowColorRgb: [number, number, number];
  /** sRGB 0–1 (see `ITerrainVisualDef.colorRgb`). */
  deepColorRgb: [number, number, number];
  /** Depth over which shallow blends to deep. */
  depthFalloffM?: number;
}

/**
 * A body-fixed circular plateau applied after the generated terrain stack.
 * The generated elevation is preserved outside `radiusM + blendRadiusM`.
 */
export interface ILocalFlattenCircleModifierDef {
  kind: 'circle';
  /** Serializable body-fixed direction; normalized when the sampler compiles. */
  directionBodyFixed: [number, number, number];
  /** Great-circle radius of the exactly flat inner plateau. */
  radiusM: number;
  /** Additional great-circle width used to smoothstep back to generated terrain. */
  blendRadiusM: number;
  /** Exact elevation, relative to the body's datum radius, inside `radiusM`. */
  elevationM: number;
}

/**
 * A body-fixed oriented rectangular plateau, for footprints (e.g. a runway)
 * a circle would either clip or vastly overshoot. The generated elevation is
 * preserved outside `halfLengthM + blendRadiusM` / `halfWidthM + blendRadiusM`.
 */
export interface ILocalFlattenRectModifierDef {
  kind: 'rect';
  /** Serializable body-fixed center direction; normalized when the sampler compiles. */
  directionBodyFixed: [number, number, number];
  /** Serializable body-fixed direction of the rectangle's long axis, projected into the tangent plane at `directionBodyFixed`. */
  forwardBodyFixed: [number, number, number];
  /** Half-extent along `forwardBodyFixed`, in the local tangent plane. */
  halfLengthM: number;
  /** Half-extent perpendicular to `forwardBodyFixed`, in the local tangent plane. */
  halfWidthM: number;
  /** Additional tangent-plane width used to smoothstep back to generated terrain. */
  blendRadiusM: number;
  /** Exact elevation, relative to the body's datum radius, inside the rectangle. */
  elevationM: number;
}

/** A local terrain-flatten plateau — either a circle (landing pads) or an oriented rectangle (runways, other elongated footprints). */
export type ILocalFlattenTerrainModifierDef =
  | ILocalFlattenCircleModifierDef
  | ILocalFlattenRectModifierDef;

/**
 * Serializable terrain configuration shared by queries, mesh workers, and
 * future collider builders.
 */
export interface ITerrainDef {
  seed: number;
  minElevationM: number;
  maxElevationM: number;
  /** Global layer, evaluated everywhere regardless of biome. */
  generators: readonly TerrainGeneratorDef[];
  /** Optional named regions blended on top of the global layer. */
  biomes?: readonly ITerrainBiomeDef[];
  /** Local plateaus applied to the final generated elevation, in array order. */
  localFlatten?: readonly ILocalFlattenTerrainModifierDef[];
  /** Global-layer albedo; bodies with no biomes still need a surface color. */
  visual?: ITerrainVisualDef;
  /** Absent means airless/dry: no ocean anywhere on this body. */
  ocean?: ITerrainOceanDef;
}
