import { FOREST_CROWN_WIDTH_M, FOREST_SPACING_M, FOREST_TREE_HEIGHT_M, PIXEL_PER_DISTANCE, TREE_SEED, TREE_TONE_SALT, cellHash } from './forest-field';
import type { Vec3 } from './runway-site';

/**
 * Spike S1 (Plan 063): per-tree shading of the forest's far form, on the CPU. `forest-layer.ts` is the TSL twin; every
 * constant it repeats lives here. Replaces the height-field shadow march (Q3 failed by owner judgement: it marched over
 * the smooth density field, so it drew dark blobs instead of tree shadows).
 *
 * Each pixel finds the trees the scatter placed near it, from the same body-fixed cell hash (`scatterCells`), and draws
 * them: a crown disc lit as a dome, a per-tree tone, and a soft shadow ellipse on the ground. Once a tree is under about
 * 2 px the pattern blends into one average ({@link forestAverage}), fitted to the pattern's own mean.
 *
 * **Temporary:** the planet lighting stage reads only the sphere normal, and its `sunVisibility` dims the sky light
 * too. Until the library takes a normal and a direct-shadow input, all shading here goes into the albedo, scaled by a
 * fixed sky share ({@link FOREST_SKY_SHARE}). Remove the light and shadow factors when those inputs land.
 */

/** Share of a flat surface's light that comes from the sky, assumed for the albedo-baked shading (temporary). */
export const FOREST_SKY_SHARE = 0.25;
/** The crown's shading normal leans this far from the up axis toward the dome (or face) normal. The instances use it too. */
export const CROWN_NORMAL_LEAN = 0.3;
/** Per-tree brightness spread (±) and hue spread (±, red against blue), from the tree's own draw. */
export const TREE_TONE_RANGE = 0.12;
export const TREE_HUE_RANGE = 0.05;
/** Uniform scale of a tree from its cell's attribute draw (the instances use the same range). */
export const TREE_SCALE_RANGE: readonly [number, number] = [0.75, 1.25];
/** Height of the crown's centre over the ground, as a share of the tree height (the cone runs from 0.12 H to H). */
export const CROWN_CENTRE_SHARE = 0.56;
/** Length of the crown cone, as a share of the tree height. */
export const CROWN_LENGTH_SHARE = 0.88;
/** Shadow ellipse: across = crown radius x this. */
export const SHADOW_WIDTH_SHARE = 0.85;
/** Shadow ellipse: along = crown radius + this x crown length / tan(elevation), capped at {@link SHADOW_MAX_M}. */
export const SHADOW_STRETCH = 0.35;
/** Inner softness of the shadow ellipse (share of its radius); the outer edge widens by a pixel. */
export const SHADOW_SOFTNESS = 0.4;
/** Smallest tan(sun elevation) the shadows use, about 2°. */
export const MIN_SUN_TAN = 0.035;
/** The per-tree pattern blends into the average while the crown shrinks from this many pixels to this many. */
export const PATTERN_FADE_PIXELS: readonly [number, number] = [3, 2];
/** Lattice columns looked at per axis, and cells along the dominant axis of each column (see {@link treesNear}). */
export const LOOKUP_COLUMNS = 3;
export const LOOKUP_CELLS_PER_COLUMN = 5;
/**
 * Every scatter tree whose base is within this tangent distance of the lookup point is found (3 x 3 columns: at least
 * one cell each way, less half a cell's shell spread along a non-dominant axis, whose share of the up vector is at most
 * 1/√2). Crowns and shadows stay inside it, so the lookup is exact and nothing ends in a line.
 */
export const LOOKUP_RADIUS_M = FOREST_SPACING_M * (1 - Math.SQRT1_2 / 2);
/** Longest semi-axis of a shadow ellipse: inside {@link LOOKUP_RADIUS_M} with room for the soft edge. */
export const SHADOW_MAX_M = 7.25;
/**
 * Farthest a shadow's centre is drawn from its tree's foot. Equal to {@link SHADOW_MAX_M}: the ellipse's near end
 * (`x = a` from the centre, toward the sun) then reaches the foot at the longest, so the shadow stays attached to its
 * tree. Uncapped, the shift (`CROWN_CENTRE_SHARE x H / tan`) reaches 100+ m at low sun while the ellipse stops at
 * {@link SHADOW_MAX_M}, and a short blob slides away from its tree (long attached shadows are a follow-up).
 */
export const SHADOW_OFFSET_MAX_M = SHADOW_MAX_M;
/** `cellHash` draws (offsets from `seed * 8`) of a tree: 5 is its size (the library lattice's), 6 its tone. 0 to 2 jitter, 3 keep, 4 yaw. */
export const TREE_SCALE_DRAW = 5;
export const TREE_TONE_DRAW = TREE_TONE_SALT;

const smooth = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scaleV = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

/** Scale of a tree from its attribute draw. */
export const treeScale = (draw: number): number => TREE_SCALE_RANGE[0] + draw * (TREE_SCALE_RANGE[1] - TREE_SCALE_RANGE[0]);

/** Colour factor of one tree from its tone draw: brightness ±12 %, a slight red/blue hue shift. Mean about 1 per channel. */
export function treeTone(draw: number): Vec3 {
  const brightness = 1 + (draw - 0.5) * 2 * TREE_TONE_RANGE;
  const h = draw * 13.7;
  const hue = (h - Math.floor(h) - 0.5) * 2;
  return [brightness * (1 + hue * TREE_HUE_RANGE), brightness * (1 + hue * TREE_HUE_RANGE * 0.3), brightness * (1 - hue * TREE_HUE_RANGE)];
}

/** How far a shadow falls from the foot of what casts it: `heightM / tan(elevation)`, with the elevation floored at about 2°. */
export function crownShadowOffsetM(heightM: number, tanElevation: number): number {
  return heightM / Math.max(tanElevation, MIN_SUN_TAN);
}

/**
 * Where a tree's shadow centre is drawn: {@link crownShadowOffsetM} of the crown centre, capped at
 * {@link SHADOW_OFFSET_MAX_M} so the ellipse (itself capped at {@link SHADOW_MAX_M}) stays attached to its tree.
 */
export function crownShadowShiftM(heightM: number, tanElevation: number): number {
  return Math.min(crownShadowOffsetM(heightM, tanElevation), SHADOW_OFFSET_MAX_M);
}

/**
 * Light on shaded ground relative to lit flat ground: the sky share alone over sky plus direct sun. 1 when the sun is
 * down (nothing to shade). Stands in for a direct-shadow input to the lighting stage (temporary).
 */
export function shadowFactor(sinElevation: number): number {
  return FOREST_SKY_SHARE / (FOREST_SKY_SHARE + (1 - FOREST_SKY_SHARE) * Math.max(sinElevation, 0));
}

/**
 * Light on a crown point relative to flat ground under the same sun. The crown is a dome: `o` is the point's offset
 * from the crown centre in the tangent plane (metres, body frame), `crownRadiusM` its radius, `sun` the unit direction
 * to the sun and `sinElevation` its height over the local horizon. The dome normal leans by {@link CROWN_NORMAL_LEAN}
 * toward the up axis, as the instances' shading normal does, so both forms take the same light. Above 1 on the sun
 * side, below it on the far side.
 */
export function crownLight(o: Vec3, crownRadiusM: number, sun: Vec3, sinElevation: number): number {
  const d = len(o);
  const clamped = d > crownRadiusM ? scaleV(o, crownRadiusM / d) : o;
  const s2 = Math.min((d * d) / (crownRadiusM * crownRadiusM), 1);
  const z = Math.sqrt(1 - s2);
  const lean = CROWN_NORMAL_LEAN;
  const domeDotSun = dot(clamped, sun) / crownRadiusM + z * sinElevation;
  const norm = Math.sqrt((1 - lean) ** 2 + lean ** 2 + 2 * lean * (1 - lean) * z);
  const nDotL = ((1 - lean) * sinElevation + lean * domeDotSun) / norm;
  const A = FOREST_SKY_SHARE;
  const relative = (A + (1 - A) * Math.max(nDotL, 0)) / (A + (1 - A) * Math.max(sinElevation, 0));
  // Below the horizon the stage gives sky light only, so there is nothing to shade.
  return 1 + (relative - 1) * Math.min(Math.max(sinElevation / 0.05, 0), 1);
}

/** One tree found by {@link treesNear}. */
export interface INearTree {
  /** Tree base minus the lookup point, in the lookup point's tangent plane (metres, body frame). */
  readonly offset: Vec3;
  readonly scale: number;
  readonly toneDraw: number;
}

/** The dominant body axis of a direction, with the tie rule of `scatterCells`. */
export function dominantAxis(n: Vec3): 0 | 1 | 2 {
  const [x, y, z] = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
  return x >= y && x >= z ? 0 : y >= z ? 1 : 2;
}

/**
 * The trees the scatter placed near a body-fixed point, found from the cell hash alone: what each far-form pixel does.
 *
 * The scatter keeps one candidate per lattice cell whose jittered point lies in the one-cell shell above the datum.
 * Here the point is lifted to the middle of that shell; along the two non-dominant axes the lookup takes the point's
 * own column and both neighbours (3 x 3 columns), and in each column the {@link LOOKUP_CELLS_PER_COLUMN} cells around
 * the shell (the shell crosses at most 3.7 cells of a column, at the cube's corners). A candidate counts when it is in
 * the shell and its keep draw is under `density` (the pixel's density, not the tree's own: it varies over hundreds of
 * metres, a tree is 12 m). Every tree within {@link LOOKUP_RADIUS_M} is found; farther ones may be.
 *
 * Why not 2 x 2 columns: on a face tilted against the lattice, a candidate half a cell above or below the shell's
 * middle sits up to 4 m sideways of where it stands, so a tree 3 m away can belong to a column a whole cell off.
 */
export function treesNear(point: Vec3, radiusM: number, density: number, spacingM: number = FOREST_SPACING_M, seed: number = TREE_SEED): INearTree[] {
  const S = spacingM;
  const n = scaleV(point, 1 / len(point));
  const k = dominantAxis(n);
  const u = (k + 1) % 3;
  const v = (k + 2) % 3;
  const rho = radiusM + S / 2;
  const q = scaleV(n, rho);
  const iu0 = Math.floor(q[u] / S);
  const iv0 = Math.floor(q[v] / S);
  const found: INearTree[] = [];
  const cell = [0, 0, 0];
  for (let iu = iu0 - 1; iu <= iu0 + 1; iu += 1) {
    for (let iv = iv0 - 1; iv <= iv0 + 1; iv += 1) {
      const du = q[u] - (iu + 0.5) * S;
      const dv = q[v] - (iv + 0.5) * S;
      // Where the shell's middle crosses this column (the sphere's tangent plane is exact enough over a cell or two).
      const kColumn = q[k] + (q[u] * du + q[v] * dv) / q[k];
      const ikFirst = Math.floor(kColumn / S - 2);
      for (let j = 0; j < LOOKUP_CELLS_PER_COLUMN; j += 1) {
        cell[k] = ikFirst + j;
        cell[u] = iu;
        cell[v] = iv;
        const [cx, cy, cz] = cell;
        const candidate: Vec3 = [
          (cx + cellHash(cx, cy, cz, seed * 8)) * S,
          (cy + cellHash(cx, cy, cz, seed * 8 + 1)) * S,
          (cz + cellHash(cx, cy, cz, seed * 8 + 2)) * S,
        ];
        const rel = sub(candidate, q);
        const up = dot(rel, n);
        const tangent = sub(rel, scaleV(n, up));
        const radial = up + dot(tangent, tangent) / (2 * rho);
        if (radial < -S / 2 || radial >= S / 2) continue;
        if (cellHash(cx, cy, cz, seed * 8 + 3) >= density) continue;
        found.push({ offset: tangent, scale: treeScale(cellHash(cx, cy, cz, seed * 8 + TREE_SCALE_DRAW)), toneDraw: cellHash(cx, cy, cz, seed * 8 + TREE_TONE_DRAW) });
      }
    }
  }
  return found;
}

/** 1 inside the lookup radius, 0 at it: the last half metre where a tree may or may not have been found. */
export const withinLookup = (distanceM: number): number => 1 - smooth(LOOKUP_RADIUS_M - 0.5, LOOKUP_RADIUS_M, distanceM);

/** The sun at a point: height over the local horizon and the unit horizontal direction toward it. */
export function localSun(n: Vec3, sun: Vec3): { sinElevation: number; tanElevation: number; toSun: Vec3 } {
  const sinElevation = dot(sun, n);
  const horizontal = sub(sun, scaleV(n, sinElevation));
  const cosElevation = len(horizontal);
  return {
    sinElevation,
    tanElevation: Math.max(sinElevation / Math.max(cosElevation, 1e-4), MIN_SUN_TAN),
    toSun: scaleV(horizontal, 1 / Math.max(cosElevation, 1e-6)),
  };
}

/** Far-form albedo at a pixel, as weights: `albedo = ground x below + tree * treeAlbedo` (per channel for `tree`). */
export interface IForestSample {
  readonly ground: number;
  readonly tree: Vec3;
}

/**
 * The per-tree pattern at a body-fixed point: what `forest-layer.ts` draws before the average takes over.
 *
 * 1. Ground shadows. A tree's shadow centre lies `crown centre height / tan(elevation)` (of the mean tree, capped at
 *    {@link SHADOW_OFFSET_MAX_M}) away from the sun, so the trees
 *    that can shade this pixel stand near the point that far toward the sun: a second {@link treesNear} there. Each
 *    shadow is a soft ellipse (across: 0.85 crown radius; along: crown radius plus the crown's length over
 *    tan(elevation), capped at {@link SHADOW_MAX_M}) and darkens the ground to {@link shadowFactor}.
 * 2. Crowns over it, each a disc of its crown radius with a soft edge a pixel wide, coloured by
 *    `tone x` {@link crownLight}, mixed in by `crownWeight` (the layer's fade-in against the instances).
 *
 * Both fade to nothing at {@link LOOKUP_RADIUS_M} from their tree, so the result equals drawing every tree.
 */
export function forestPattern(point: Vec3, radiusM: number, sun: Vec3, density: number, pixelM: number, crownWeight = 1): IForestSample {
  const n = scaleV(point, 1 / len(point));
  const { sinElevation, tanElevation, toSun } = localSun(n, sun);
  const H = FOREST_TREE_HEIGHT_M;
  const crownRadius = FOREST_CROWN_WIDTH_M / 2;

  // Every shadow falls the mean tree's offset from its foot (a tree's size scales its ellipse, not the offset), capped at
  // SHADOW_OFFSET_MAX_M so it stays attached; the casters of this pixel stand within the lookup radius of the point
  // that far toward the sun.
  const offset = crownShadowShiftM(CROWN_CENTRE_SHARE * H, tanElevation);
  const sunward = add(point, scaleV(toSun, offset));
  let shade = 0;
  for (const tree of treesNear(sunward, radiusM, density)) {
    // Pixel relative to this tree's shadow centre: base = sunward + offset, shadow centre = base - toSun x offset.
    const r = scaleV(tree.offset, -1);
    const x = dot(r, toSun);
    const y = Math.sqrt(Math.max(dot(r, r) - x * x, 0));
    const rc = crownRadius * tree.scale;
    const a = Math.min(rc + (SHADOW_STRETCH * CROWN_LENGTH_SHARE * H * tree.scale) / tanElevation, SHADOW_MAX_M);
    const b = rc * SHADOW_WIDTH_SHARE;
    const e = Math.hypot(x / a, y / b);
    shade = Math.max(shade, (1 - smooth(1 - SHADOW_SOFTNESS, 1 + pixelM / b, e)) * withinLookup(Math.sqrt(dot(r, r))));
  }
  let ground = 1 + (shadowFactor(sinElevation) - 1) * shade;
  let tree: Vec3 = [0, 0, 0];
  const edge = Math.max(pixelM * 0.5, 0.3);
  for (const t of treesNear(point, radiusM, density)) {
    const o = scaleV(t.offset, -1);
    const rc = crownRadius * t.scale;
    const c = (1 - smooth(rc - edge, rc + edge, len(o))) * withinLookup(len(o)) * crownWeight;
    const colour = scaleV(treeTone(t.toneDraw), crownLight(o, rc, sun, sinElevation));
    ground *= 1 - c;
    tree = add(scaleV(tree, 1 - c), scaleV(colour, c));
  }
  return { ground, tree };
}

/**
 * Fits of the pattern's own mean ({@link forestPatternMean}, 800 samples x 6 sun azimuths on a tilted face, densities
 * 0.25 to 1, sun 3° to 89°); `forest-shading.spec.ts` re-measures and fails if the pattern drifts from them.
 *
 * - Crown cover at density `d`: `c0 d + c1 d²` (max error 0.006).
 * - Mean crown light at `s = sin(elevation)`: `l0 + l1 exp(-s / l2)`: about 0.99, rising at low sun because the lit
 *   side of a dome gains more than the flat ground does (max error 0.008).
 * - Mean shade of the ground between the crowns: `d x h0 x smoothstep(0, h1, shadow offset in metres)`: no visible
 *   shadow at noon (it falls under the crown), about 0.47 of the ground once the offset passes a crown (max error 0.04).
 */
export const COVER_FIT: readonly [number, number] = [0.6678, -0.054];
export const CROWN_LIGHT_FIT: readonly [number, number, number] = [0.9887, 0.2485, 0.093];
export const GROUND_SHADE_FIT: readonly [number, number] = [0.4668, 9.85];

/** The parts of {@link forestAverage}: crown cover, mean crown light, mean shade of the ground between crowns. */
export function forestAverageParts(sinElevation: number, density: number): { cover: number; light: number; shade: number } {
  const d = Math.min(Math.max(density, 0), 1);
  const s = Math.max(sinElevation, 0);
  const cover = COVER_FIT[0] * d + COVER_FIT[1] * d * d;
  const light = CROWN_LIGHT_FIT[0] + CROWN_LIGHT_FIT[1] * Math.exp(-s / CROWN_LIGHT_FIT[2]);
  const tanElevation = Math.max(s / Math.max(Math.sqrt(1 - Math.min(s * s, 1)), 1e-4), MIN_SUN_TAN);
  const shade = d * GROUND_SHADE_FIT[0] * smooth(0, GROUND_SHADE_FIT[1], crownShadowShiftM(CROWN_CENTRE_SHARE * FOREST_TREE_HEIGHT_M, tanElevation));
  return { cover, light: 1 + (light - 1) * Math.min(Math.max(sinElevation / 0.05, 0), 1), shade };
}

/**
 * The forest's mean look once a tree is under about 2 px, as the same weights as {@link forestPattern}. A function of
 * the sun's height and the density only, fitted to the pattern's own mean so the blend makes no brightness step.
 * `crownWeight` is the pattern's: the crowns' share while the instances still draw them (the layer's fade weight).
 */
export function forestAverage(sinElevation: number, density: number, crownWeight = 1): { ground: number; tree: number } {
  const parts = forestAverageParts(sinElevation, density);
  const cover = parts.cover * crownWeight;
  return { ground: (1 - cover) * (1 + (shadowFactor(sinElevation) - 1) * parts.shade), tree: cover * parts.light };
}

/** Camera distances over which the pattern blends into the average, from the crown width and {@link PATTERN_FADE_PIXELS}. */
export function patternFadeBand(crownWidthM: number = FOREST_CROWN_WIDTH_M): { startM: number; endM: number } {
  return { startM: crownWidthM / (PATTERN_FADE_PIXELS[0] * PIXEL_PER_DISTANCE), endM: crownWidthM / (PATTERN_FADE_PIXELS[1] * PIXEL_PER_DISTANCE) };
}

/** Options of {@link forestPatternMean}. */
export interface IPatternMeanOptions {
  readonly radiusM: number;
  /** Unit direction of the patch centre. */
  readonly centre: Vec3;
  readonly sunElevationDeg: number;
  readonly density: number;
  /** Sun azimuths (degrees) averaged over: the lattice is not isotropic. */
  readonly azimuthsDeg?: readonly number[];
  /** Samples per azimuth, on a sunflower disc of `patchM` radius. */
  readonly samples?: number;
  readonly patchM?: number;
}

/** Mean of {@link forestPattern} over a patch and its parts: what {@link forestAverage} is fitted to. */
export function forestPatternMean(options: IPatternMeanOptions): { ground: number; tree: number; cover: number; light: number; shade: number } {
  const { radiusM, centre, sunElevationDeg, density } = options;
  const azimuths = options.azimuthsDeg ?? [0, 37, 90, 151, 220, 300];
  const samples = options.samples ?? 1500;
  const patchM = options.patchM ?? 150;
  const n = scaleV(centre, 1 / len(centre));
  const east = (() => {
    const e: Vec3 = [-n[2], 0, n[0]];
    const l = len(e) || 1;
    return len(e) > 1e-6 ? scaleV(e, 1 / l) : ([1, 0, 0] as Vec3);
  })();
  const north: Vec3 = [n[1] * east[2] - n[2] * east[1], n[2] * east[0] - n[0] * east[2], n[0] * east[1] - n[1] * east[0]];
  const el = (sunElevationDeg * Math.PI) / 180;
  let ground = 0;
  let tree = 0;
  let cover = 0;
  let shadeSum = 0;
  let visible = 0;
  let count = 0;
  for (const azDeg of azimuths) {
    const az = (azDeg * Math.PI) / 180;
    const sun: Vec3 = add(scaleV(n, Math.sin(el)), add(scaleV(east, Math.cos(el) * Math.cos(az)), scaleV(north, Math.cos(el) * Math.sin(az))));
    for (let i = 0; i < samples; i += 1) {
      const r = patchM * Math.sqrt((i + 0.5) / samples);
      const angle = i * 2.399963229728653;
      const p = add(scaleV(n, radiusM + 100), add(scaleV(east, r * Math.cos(angle)), scaleV(north, r * Math.sin(angle))));
      const sample = forestPattern(p, radiusM, sun, density, 0.25);
      const noCrowns = forestPattern(p, radiusM, sun, density, 0.25, 0);
      const t = (sample.tree[0] + sample.tree[1] + sample.tree[2]) / 3;
      const c = 1 - sample.ground / noCrowns.ground;
      ground += sample.ground;
      tree += t;
      cover += c;
      shadeSum += (1 - noCrowns.ground) * (1 - c);
      visible += 1 - c;
      count += 1;
    }
  }
  const sf = shadowFactor(Math.sin(el));
  return {
    ground: ground / count,
    tree: tree / count,
    cover: cover / count,
    light: cover > 0 ? tree / cover : 1,
    shade: visible > 0 && sf < 1 ? shadeSum / visible / (1 - sf) : 0,
  };
}
