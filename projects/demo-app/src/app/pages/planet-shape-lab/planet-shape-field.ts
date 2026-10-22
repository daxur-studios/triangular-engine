/* eslint-disable @typescript-eslint/no-explicit-any */
import { Matrix3, Vector3, Vector4, type DataTexture } from 'three';
import {
  Continue, Fn, If, Loop, abs, bitAnd, bitOr, clamp, dot, float, floor, fract, int, max, mix, normalize, select, shiftLeft, smoothstep, texture,
  uniform, uniformArray, vec2, vec3,
} from 'three/tsl';
import { NOISE_PERIOD, NOISE_SLICE_SHIFT } from './planet-shape-noise';

/**
 * Plan 055: the v2 terrain as one definition. A 3D density field,
 * `altitude + unit * (canyonDepth * canyon + rockAmplitude * (rock - ROCK_MEAN))`, negative inside rock, in metres,
 * then the edits (flatten, soften, carve) in list order. The biome parameters (canyon depth, rock amplitude, vertical
 * stretch, octave contrast) are blended between two biomes, canyons and rolling hills, by a low-frequency mask: one
 * field whose parameters vary, not two fields, so the cost does not grow with the biomes.
 * The TSL functions here are what the raymarcher draws; `planet-shape-field-cpu.ts` is the same field in doubles, and
 * `planet-shape-field.spec.ts` keeps the two equal. Constants and frame layout live here and are shared by both.
 *
 * Every noise is sampled camera-relative: a frame's matrix (scale and rotation) and origin (the camera's noise
 * coordinates modulo the period) are worked out in doubles on the CPU, so metre-scale noise holds on an Earth-size body.
 */

/** The flat pad under the poses (the first edit), as an angle from the +z pole: fully flat inside, full relief outside. */
export const PAD_INNER_RAD = 0.0015;
export const PAD_OUTER_RAD = 0.004;
/** In units (a tenth of the relief): canyon depth, rock-noise amplitude, rock-noise lattice, canyon-mask lattice. */
export const CANYON_DEPTH = 7;
export const ROCK_AMPLITUDE = 3;
export const ROCK_LATTICE = 4;
export const MASK_LATTICE = 30;
/** The rock noise is this much finer vertically: strata and ledges. */
export const STRETCH = 4;
export const ROCK_OCTAVES = 3;
/** Mean of the rock noise sum, so the pad and the plateau line up. */
export const ROCK_MEAN = 0.44;
/** Largest value of the rock noise sum (0.5 + 0.25 + 0.125). */
export const ROCK_MAX = 0.875;
/** Scale ratio between octaves. */
export const OCTAVE_SCALE = 2.02;
/** Octave rotation (orthonormal), applied with the `OCTAVE_SCALE` scale between octaves. */
export const OCTAVE_ROTATION = new Matrix3().set(0, 0.8, 0.6, -0.8, 0.36, -0.48, -0.6, -0.48, 0.64);
/** Fixed offsets of the two canyon-mask frames, in noise units. */
export const MASK_OFFSETS: readonly [readonly [number, number, number], readonly [number, number, number]] = [
  [11.3, 4.7, 8.1],
  [3.1, 17.9, 5.3],
];

/** Parameters a biome sets, in relief units where they are lengths. */
export interface BiomeParams {
  readonly canyonDepth: number;
  readonly rockAmplitude: number;
  /** How much finer the rock noise is vertically (strata and ledges); 1 = round. */
  readonly stretch: number;
  /** Per rock octave, how much of its contrast is kept (0..1); the octave's mean stays put, so the band does not move. */
  readonly octaveContrast: readonly [number, number, number];
  /**
   * 0..1, how much of the rock is grounded: 0 is the wild 3D density (floating rock possible), 1 the warped height
   * surface (`groundedDensity`, one connected sheet). Blended as densities.
   */
  readonly grounded: number;
}

/**
 * Biome 0: canyons, mesas and strata. Biome 1: rolling hills, no canyons, round and smoother. Every biome must stay
 * inside the canyon biome's band (`canyonDepth` and `rockAmplitude` no larger), since the march's spheres come from it.
 * Canyons stay wild (the owner likes the floating rock there; strata and ledges come from the vertical stretch, which a
 * height surface cannot have); hills are grounded, since rounded hills with floating blobs read as a bug, not a place.
 */
export const CANYON_BIOME: BiomeParams = { canyonDepth: CANYON_DEPTH, rockAmplitude: ROCK_AMPLITUDE, stretch: STRETCH, octaveContrast: [1, 1, 1], grounded: 0 };
export const HILLS_BIOME: BiomeParams = { canyonDepth: 0, rockAmplitude: 3, stretch: 1, octaveContrast: [1, 0.5, 0.2], grounded: 1 };
/**
 * Lattice of the biome mask, in units, its frame offset, and the mask values over which one biome turns into the other.
 * The offset was picked so that at 600 km the poses stand in hills and canyons begin some 10 km east, where the low and
 * grazing views look: both biomes and the border between them are in view.
 */
export const BIOME_LATTICE = 40;
export const BIOME_OFFSET: readonly [number, number, number] = [196.92, 16.4, 162.44];
export const BIOME_EDGE: readonly [number, number] = [0.42, 0.58];

/**
 * The grounded rock's warp: the sample point is moved by `w(p)` before the height surface is read, so cliffs lean and
 * overhang, and `p -> p + w(p)` is a bijection as long as `w` is a contraction (largest gradient below 1). The solid set
 * is then the image of a height-surface solid under a bijection: connected, no floaters, no stray holes.
 *
 * `w` is built from the two canyon-mask noises (free: the canyon term reads the same samples), each moving the point along
 * one fixed axis, then projected onto the tangent plane (|projection| <= 1, so it can only lower the bound).
 * Bound. A value noise cell is a trilinear blend with smoothstep weights, so each partial derivative is a convex
 * combination of lattice differences (|diff| <= 1) times smoothstep' <= 1.5, per lattice cell: |grad n| <= 1.5 * sqrt(3)
 * = 2.6 (`NOISE_GRADIENT_MAX`). Noise i has lattice `L_i` units and moves the point by `2 A_i (n_i - 0.5)` along an
 * orthonormal axis `a_i`, so `Dw = P sum_i 2 A_i a_i grad(n_i)^T`, and ||Dw|| <= 2 G sqrt(sum_i (A_i / L_i)^2). With
 * `A_i = WARP_FACTOR * L_i` that is `2 G sqrt(2) WARP_FACTOR` = 0.59 for 0.08. The projection onto the tangent plane at
 * `p` changes with `p` on the scale of the body radius; a unit is at most 0.3 % of it, adding `2 |m| / R` <= 0.017
 * (`warpLipschitzBound`). Total below 0.61: margin 0.39 to 1, for the bound's looseness is no excuse to cut it close.
 */
export const WARP_FACTOR = 0.08;
export const NOISE_GRADIENT_MAX = 2.6;
/** Largest relief unit relative to the body radius (`reliefM` is at most 3 % of it, a unit a tenth of that). */
export const UNIT_RADIUS_RATIO = 0.003;
/** Warp amplitude (units) of the two mask noises: the point moves by up to +-A along its axis. */
export const WARP_AMPLITUDE: readonly [number, number] = [WARP_FACTOR * MASK_LATTICE, (WARP_FACTOR * MASK_LATTICE) / OCTAVE_SCALE];

/** The proven upper bound of the warp's gradient (operator norm), see above. */
export function warpLipschitzBound(): number {
  const noise = 2 * NOISE_GRADIENT_MAX * Math.hypot(WARP_AMPLITUDE[0] / MASK_LATTICE, WARP_AMPLITUDE[1] / (MASK_LATTICE / OCTAVE_SCALE));
  return noise + (2 * Math.hypot(...WARP_AMPLITUDE) * UNIT_RADIUS_RATIO);
}

/** The parameters at biome blend `m` (0 canyons .. 1 hills). */
export function biomeParams(m: number): BiomeParams {
  const lerp = (a: number, b: number): number => a + (b - a) * m;
  return {
    canyonDepth: lerp(CANYON_BIOME.canyonDepth, HILLS_BIOME.canyonDepth),
    rockAmplitude: lerp(CANYON_BIOME.rockAmplitude, HILLS_BIOME.rockAmplitude),
    stretch: lerp(CANYON_BIOME.stretch, HILLS_BIOME.stretch),
    octaveContrast: [0, 1, 2].map((i) => lerp(CANYON_BIOME.octaveContrast[i], HILLS_BIOME.octaveContrast[i])) as [number, number, number],
    grounded: lerp(CANYON_BIOME.grounded, HILLS_BIOME.grounded),
  };
}

/** Total relief of the terrain; everything else is in units of a tenth of it. */
export function reliefM(radiusM: number): number {
  return Math.min(radiusM * 0.03, 9000);
}

/** A tenth of the relief, in metres. */
export function unitM(radiusM: number): number {
  return reliefM(radiusM) / 10;
}

/** Altitude of the plateau-top sphere and of the solid-floor sphere above the body sphere, in metres. */
export function topAltitudeM(radiusM: number): number {
  return unitM(radiusM) * ROCK_AMPLITUDE * ROCK_MEAN;
}
export function bottomAltitudeM(radiusM: number): number {
  return -unitM(radiusM) * (CANYON_DEPTH + ROCK_AMPLITUDE * (ROCK_MAX - ROCK_MEAN));
}

/**
 * One camera-relative noise frame: noise coordinates of the camera-relative point `x` are `origin + matrix * x`. The
 * matrix is kept in doubles, and the origin is the camera's coordinates modulo the period.
 */
export interface NoiseFrame {
  readonly matrix: Matrix3;
  readonly offset: Vector3;
  readonly uMatrix: any;
  readonly uOrigin: any;
}

/** What the TSL functions read from a frame: nodes for the matrix and the origin (uniforms, or anything else). */
export type NoiseFrameNodes = Pick<NoiseFrame, 'uMatrix' | 'uOrigin'>;

export function noiseFrame(offset = new Vector3()): NoiseFrame {
  return { matrix: new Matrix3(), offset, uMatrix: uniform(new Matrix3()), uOrigin: uniform(new Vector3()) };
}

/** Matrices of the rock octaves, the two canyon-mask frames and the biome frame for a body whose relief unit is `unit` metres. */
export function fieldFrameMatrices(unit: number): { rock: Matrix3[]; mask: [Matrix3, Matrix3]; biome: Matrix3 } {
  const rock: Matrix3[] = [];
  let octave = new Matrix3().multiplyScalar(1 / (ROCK_LATTICE * unit));
  for (let i = 0; i < ROCK_OCTAVES; i++) {
    rock.push(octave);
    octave = new Matrix3().copy(OCTAVE_ROTATION).multiply(octave).multiplyScalar(OCTAVE_SCALE);
  }
  const mask0 = new Matrix3().identity().multiplyScalar(1 / (MASK_LATTICE * unit));
  const mask1 = new Matrix3().copy(OCTAVE_ROTATION).multiplyScalar(OCTAVE_SCALE / (MASK_LATTICE * unit));
  const biome = new Matrix3().copy(OCTAVE_ROTATION).transpose().multiplyScalar(1 / (BIOME_LATTICE * unit));
  return { rock, mask: [mask0, mask1], biome };
}

export function positiveModulo(value: number, period: number): number {
  return ((value % period) + period) % period;
}

/** Origin of a frame for a camera at `(x, y, z)`, in doubles, modulo the period. Written into `out`. */
export function noiseOrigin(matrix: Matrix3, offset: Vector3, x: number, y: number, z: number, out = new Vector3()): Vector3 {
  out.set(x, y, z).applyMatrix3(matrix).add(offset);
  return out.set(positiveModulo(out.x, NOISE_PERIOD), positiveModulo(out.y, NOISE_PERIOD), positiveModulo(out.z, NOISE_PERIOD));
}

/**
 * 3D value noise, 0..1. `smooth` blends four texel reads in the shader; otherwise the sampler blends one read, which
 * is cheaper but steps slightly (8-bit filter weights), fine for the march but not for normals.
 */
export function valueNoise(noiseTexture: DataTexture, x: any, smooth: boolean): any {
  const p = floor(x) as any;
  const f0 = fract(x);
  const f = f0.mul(f0).mul(float(3).sub(f0.mul(2))) as any;
  const base = p.xy.add(vec2(NOISE_SLICE_SHIFT.x, NOISE_SLICE_SHIFT.y).mul(p.z)).add(0.5).toVar();
  let rg: any;
  if (smooth) {
    const tap = (dx: number, dy: number): any => texture(noiseTexture, base.add(vec2(dx, dy)).div(NOISE_PERIOD), float(0));
    rg = mix(mix(tap(0, 0), tap(1, 0), f.x), mix(tap(0, 1), tap(1, 1), f.x), f.y);
  } else {
    rg = texture(noiseTexture, base.add(f.xy).div(NOISE_PERIOD), float(0));
  }
  return mix(rg.y, rg.x, f.z);
}

/** Value noise at the camera-relative point `x` in a frame. */
export function sampleFrame(noiseTexture: DataTexture, frame: NoiseFrameNodes, x: any, smooth: boolean): any {
  return valueNoise(noiseTexture, frame.uOrigin.add(frame.uMatrix.mul(x)), smooth);
}

/** Most edits the field takes at once. */
export const MAX_TERRAIN_EDITS = 8;

export type TerrainEditKind = 'flatten' | 'soften' | 'carve';
/** Kind codes as stored in the shader (the w of an edit's first vector). */
export const TERRAIN_EDIT_CODE: Readonly<Record<TerrainEditKind, number>> = { flatten: 1, soften: 2, carve: 3 };

/**
 * A local change to the field, applied after the noise and in list order. `centre` is body-relative, in metres.
 * - `flatten`: within `radiusM` of the vertical through `centre`, the ground is level at altitude `heightM` (default
 *   0), blending back to the field over `edgeM`. Keep `heightM` between the solid floor and the plateau top.
 * - `soften`: the same disc keeps `strength` (0..1, default 0.25) of the relief: rounded hills, shallower canyons.
 * - `carve`: removes the rock inside a sphere of `radiusM` at `centre`, its rim rounded over `edgeM`.
 * Edges much narrower than the height they blend make steep field slopes, which the march may step over.
 */
export interface TerrainEdit {
  readonly kind: TerrainEditKind;
  readonly centre: readonly [number, number, number];
  readonly radiusM: number;
  readonly edgeM: number;
  readonly heightM?: number;
  readonly strength?: number;
}

/** The flat pad under the camera poses (+z), as a flatten edit at altitude 0. */
export function padEdit(radiusM: number): TerrainEdit {
  return {
    kind: 'flatten', centre: [0, 0, radiusM], radiusM: PAD_INNER_RAD * radiusM, edgeM: (PAD_OUTER_RAD - PAD_INNER_RAD) * radiusM, heightM: 0,
  };
}

/** Edge widths are kept above this (metres), so the blends stay defined. */
export const MIN_EDGE_M = 1e-3;

/**
 * The shader form of an edit for a camera at `camera` (body-relative, doubles): `a` = centre minus camera (so it stays
 * precise near the camera on an Earth-size body) and the kind code; `b` = (radius, edge, height, strength).
 */
export function packEdit(edit: TerrainEdit, camera: readonly [number, number, number], a: Vector4, b: Vector4): void {
  a.set(edit.centre[0] - camera[0], edit.centre[1] - camera[1], edit.centre[2] - camera[2], TERRAIN_EDIT_CODE[edit.kind]);
  b.set(edit.radiusM, Math.max(edit.edgeM, MIN_EDGE_M), edit.heightM ?? 0, edit.strength ?? 0.25);
}

/**
 * Radius (metres) of a sphere around the edit's centre outside which, within the air band of a body of `radiusM`, the
 * edit cannot change whether a point is solid: a disc edit's cylinder through the band (with a margin for the
 * curvature), a carve's sphere plus its rounded rim.
 */
export function editBoundM(edit: TerrainEdit, radiusM: number): number {
  const reach = edit.radiusM + Math.max(edit.edgeM, MIN_EDGE_M);
  if (edit.kind === 'carve') return reach;
  const centreAltitude = Math.hypot(...edit.centre) - radiusM;
  const span = Math.max(topAltitudeM(radiusM) - centreAltitude, centreAltitude - bottomAltitudeM(radiusM), 0);
  return Math.hypot(reach, span) * 1.05;
}

/** Every edit selected: the mask for field reads that are not along one ray (normals, shadows). */
export const ALL_EDITS = (1 << MAX_TERRAIN_EDITS) - 1;

/** Shader inputs of the edit list: arrays of `MAX_TERRAIN_EDITS` (two vec4, one bound radius) and the count in use. */
export interface TerrainEditNodes {
  readonly a: any;
  readonly b: any;
  readonly bound: any;
  readonly count: any;
}

/**
 * Uniforms for the edit list; `set` packs `edits` for a camera on a body of `radiusM` (call it again whenever the camera
 * moves).
 */
export function terrainEditUniforms(): TerrainEditNodes & {
  set(edits: readonly TerrainEdit[], camera: readonly [number, number, number], radiusM: number): void;
} {
  const a = Array.from({ length: MAX_TERRAIN_EDITS }, () => new Vector4());
  const b = Array.from({ length: MAX_TERRAIN_EDITS }, () => new Vector4());
  const bound = Array.from({ length: MAX_TERRAIN_EDITS }, () => 0);
  const nodes = {
    a: uniformArray(a, 'vec4'), b: uniformArray(b, 'vec4'), bound: uniformArray(bound, 'float'), count: uniform(0, 'int') as any,
  };
  return {
    ...nodes,
    set(edits, camera, radiusM) {
      if (edits.length > MAX_TERRAIN_EDITS) throw new Error(`At most ${MAX_TERRAIN_EDITS} terrain edits`);
      edits.forEach((edit, i) => {
        packEdit(edit, camera, a[i], b[i]);
        bound[i] = editBoundM(edit, radiusM);
      });
      nodes.count.value = edits.length;
    },
  };
}

/**
 * Which edits a ray can meet: bit `i` is set when the segment `t0`..`t1` along the unit direction `d` (camera-relative)
 * passes within edit `i`'s bound. Worked out once per ray, so the march skips the rest.
 */
export const rayEditMask = Fn(([editA, bound, count, d, t0, t1]: any[]) => {
  const mask = int(0).toVar();
  Loop(count, ({ i }: { i: any }) => {
    const centre = editA.element(i).xyz;
    const t = clamp(dot(centre, d), t0, t1);
    If(d.mul(t).sub(centre).length().lessThan(bound.element(i)), () => {
      mask.assign(bitOr(mask, shiftLeft(int(1), i)));
    });
  });
  return mask;
});

/** The edits in `mask` applied to a field value; `x` is camera-relative, `up` the unit up vector there. */
const applyEdits = Fn(([editA, editB, count, mask, value0, x, up, altitude]: any[]) => {
  const value = float(value0).toVar();
  Loop(count, ({ i }: { i: any }) => {
    If(bitAnd(mask, shiftLeft(int(1), i)).equal(0), () => { Continue(); });
    const a = editA.element(i).toVar();
    const b = editB.element(i).toVar();
    const rel = x.sub(a.xyz).toVar();
    If(a.w.lessThan(2.5), () => {
      // Flatten or soften: a disc around the centre's vertical.
      const horizontal = rel.sub(up.mul(dot(rel, up))).length();
      const weight = float(1).sub(smoothstep(b.x, b.x.add(b.y), horizontal));
      const target = select(a.w.lessThan(1.5), altitude.sub(b.z), altitude.add(value.sub(altitude).mul(b.w)));
      value.assign(mix(value, target, weight));
    }).Else(() => {
      // Carve: a smooth maximum of the field and the sphere's outside distance.
      const hole = b.x.sub(rel.length());
      const h = clamp(float(0.5).add(hole.sub(value).mul(0.5).div(b.y)), 0, 1);
      value.assign(mix(value, hole, h).add(b.y.mul(h).mul(float(1).sub(h))));
    });
  });
  return value;
});

/** Canyon mask 0..1: winding channels where the mask noise crosses its middle, and basins where it is high. */
export function canyonAt(noiseTexture: DataTexture, maskFrames: readonly NoiseFrameNodes[], x: any, smooth: boolean): any {
  const v = sampleFrame(noiseTexture, maskFrames[0], x, smooth).mul(0.66)
    .add(sampleFrame(noiseTexture, maskFrames[1], x, smooth).mul(0.34)).toVar();
  const channel = float(1).sub(abs(v.mul(2).sub(1)));
  return max(smoothstep(0.74, 0.93, channel), smoothstep(0.66, 0.8, v));
}

/** Biome blend 0 (canyons) .. 1 (rolling hills) from the biome frame. */
export function biomeAt(noiseTexture: DataTexture, biomeFrame: NoiseFrameNodes, x: any, smooth: boolean): any {
  return smoothstep(BIOME_EDGE[0], BIOME_EDGE[1], sampleFrame(noiseTexture, biomeFrame, x, smooth));
}

/** A biome parameter at blend `biome` (node). */
const blendParam = (pick: (params: BiomeParams) => number, biome: any): any => mix(float(pick(CANYON_BIOME)), float(pick(HILLS_BIOME)), biome);

/**
 * Rock noise sum 0..ROCK_MAX; octaves finer than a pixel fade to their mean, and the biome sets the stretch and each
 * octave's contrast. `unit` is the relief unit in metres.
 */
export function rockAt(
  noiseTexture: DataTexture, rockFrames: readonly NoiseFrameNodes[], unit: any,
  x: any, up: any, altitude: any, footprint: any, smooth: boolean, biome: any = float(0), flat = false,
): any {
  // `flat`: no vertical stretch, for the grounded height surface (sampled on the sphere, where altitude is 0 anyway).
  const stretch = (flat ? float(1) : blendParam((b) => b.stretch, biome)).toVar();
  const stretched = x.add(up.mul(altitude.mul(stretch.sub(1)))).toVar();
  let sum: any = float(0);
  rockFrames.forEach((frame, i) => {
    const lattice = unit.mul(ROCK_LATTICE / OCTAVE_SCALE ** i).div(stretch);
    const contrast = blendParam((b) => b.octaveContrast[i], biome);
    const detail = float(1).sub(smoothstep(lattice.mul(0.25), lattice, footprint)).mul(contrast);
    sum = sum.add(mix(float(0.5), sampleFrame(noiseTexture, frame, stretched, smooth), detail).mul(0.5 ** (i + 1)));
  });
  return sum;
}

/** The biome mask's frame, and an override (node): at 0 or above it replaces the mask everywhere (a single biome). */
export interface BiomeNodes {
  readonly frame: NoiseFrameNodes;
  readonly override: any;
}

/** Everything `densityAt` reads: the texture, the camera and relief unit as nodes, and the frames. */
export interface FieldNodes {
  readonly noiseTexture: DataTexture;
  /** Camera position in body coordinates (node). */
  readonly camera: any;
  /** Relief unit in metres (node). */
  readonly unit: any;
  readonly rockFrames: readonly NoiseFrameNodes[];
  readonly maskFrames: readonly NoiseFrameNodes[];
  /** The biome mask; canyons everywhere if left out. */
  readonly biome?: BiomeNodes;
  /** Rock mode override (node): 0 or above replaces the biomes' `grounded` everywhere (0 wild, 1 grounded); below 0 keeps them. */
  readonly rockOverride?: any;
  /** The edit list; none if left out. */
  readonly edits?: TerrainEditNodes;
}

/** Biome blend at the camera-relative point `x` (0 canyons .. 1 hills). */
export function fieldBiomeAt(field: FieldNodes, x: any, smooth: boolean): any {
  if (!field.biome) return float(0);
  const override = field.biome.override;
  return select(override.greaterThanEqual(0), override, biomeAt(field.noiseTexture, field.biome.frame, x, smooth));
}

/** The grounded warp at the camera-relative point `x` (node, vec3, metres): tangential, see `WARP_FACTOR`. */
function warpAt(field: FieldNodes, x: any, up: any, smooth: boolean): any {
  const n0 = sampleFrame(field.noiseTexture, field.maskFrames[0], x, smooth);
  const n1 = sampleFrame(field.noiseTexture, field.maskFrames[1], x, smooth);
  const m = vec3(n0.sub(0.5).mul(2 * WARP_AMPLITUDE[0]), n1.sub(0.5).mul(2 * WARP_AMPLITUDE[1]), 0).mul(field.unit);
  return m.sub(up.mul(dot(m, up)));
}

/**
 * The grounded density: a height surface read at the warped point `q = x + w(x)`. Relief is the same expression as the
 * wild field's (canyon term plus rock octaves) but sampled on the sphere under `q`, so it depends on the direction of `q`
 * only. `w` is tangential at `x`, so `|x + w|` is exact without cancellation: altitude(q) = altitude(x) + |w|^2 / (|x| + |q|).
 */
function groundedDensity(field: FieldNodes, x: any, up: any, altitude: any, footprint: any, smooth: boolean, biome: any): any {
  const w = warpAt(field, x, up, smooth).toVar();
  const q = x.add(w).toVar();
  const pb = field.camera.add(q).toVar();
  const altitudeQ = altitude.add(dot(w, w).div(field.camera.add(x).length().add(pb.length()))).toVar();
  const upQ = (normalize(pb) as any).toVar();
  const surface = q.sub(upQ.mul(altitudeQ)).toVar();
  const rock = rockAt(field.noiseTexture, field.rockFrames, field.unit, surface, upQ, float(0), footprint, smooth, biome, true);
  const depth = blendParam((b) => b.canyonDepth, biome).toVar();
  const canyon = float(0).toVar();
  If(depth.greaterThan(0), () => { canyon.assign(canyonAt(field.noiseTexture, field.maskFrames, surface, smooth).mul(depth)); });
  return altitudeQ.add(canyon.add(rock.sub(ROCK_MEAN).mul(blendParam((b) => b.rockAmplitude, biome))).mul(field.unit));
}

/** The wild density: altitude plus 3D noise relief. */
function wildDensity(field: FieldNodes, x: any, up: any, altitude: any, footprint: any, smooth: boolean, biome: any): any {
  const rock = rockAt(field.noiseTexture, field.rockFrames, field.unit, x, up, altitude, footprint, smooth, biome);
  const relief = canyonAt(field.noiseTexture, field.maskFrames, x, smooth).mul(blendParam((b) => b.canyonDepth, biome))
    .add(rock.sub(ROCK_MEAN).mul(blendParam((b) => b.rockAmplitude, biome))).mul(field.unit);
  return altitude.add(relief);
}

/** Grounded share 0..1 at a point with biome blend `biome`. */
export function fieldGroundedAt(field: FieldNodes, biome: any): any {
  const perBiome = blendParam((b) => b.grounded, biome);
  return field.rockOverride ? select(field.rockOverride.greaterThanEqual(0), field.rockOverride, perBiome) : perBiome;
}

/**
 * Signed field in metres (negative inside rock), not yet scaled for stepping. `x` is camera-relative. `editMask` (an int
 * node, from `rayEditMask`) limits the edits applied; the default is all of them. Only the rock modes in use are
 * evaluated: wild where the grounded share is 0, grounded where it is 1, both (blended) between.
 */
export function densityAt(field: FieldNodes, x: any, altitude: any, footprint: any, smooth: boolean, editMask: any = int(ALL_EDITS)): any {
  const up = (normalize(field.camera.add(x)) as any).toVar();
  const biome = fieldBiomeAt(field, x, smooth).toVar();
  const grounded = fieldGroundedAt(field, biome).toVar();
  const surface = Fn(([px, pUp, pAltitude, pFootprint, pBiome, share]: any[]) => {
    const wild = float(0).toVar();
    const ground = float(0).toVar();
    If(share.lessThan(1), () => { wild.assign(wildDensity(field, px, pUp, pAltitude, pFootprint, smooth, pBiome)); });
    If(share.greaterThan(0), () => { ground.assign(groundedDensity(field, px, pUp, pAltitude, pFootprint, smooth, pBiome)); });
    return mix(wild, ground, share);
  });
  const value = surface(x, up, altitude, footprint, biome, grounded);
  return field.edits ? applyEdits(field.edits.a, field.edits.b, field.edits.count, editMask, value, x, up, altitude) : value;
}
