/* eslint-disable @typescript-eslint/no-explicit-any */
import { clamp, exp, float, int, vec2, vec3 } from 'three/tsl';
import {
  MAX_LATTICE_STEPS,
  bakeHeights,
  createTextureHeightSource,
  domainPoint,
  frustumNormals,
  type CameraAxes,
  type TextureHeightSource,
  type HeightSource,
  type LodDomain,
  type LodSelector,
  type NodeCoverHook,
  type SelectorSettings,
  type SelectorView,
  type Vec3,
} from 'triangular-engine/lod-surface/core';

/**
 * Plan 080 w2, spike part: land under the water, and the test that tells which water leaves lie entirely under it.
 *
 * The question the owner asked is "avoid rendering complex water under terrain". The water body is a second lod-surface
 * body with its own quadtree selection, and today the selector knows nothing about land: it spends leaves, vertices and
 * (behind the land's depth) fragments on water that nobody can see. This file holds the pure parts of finding out how
 * much, and of the cull test a library hook would apply:
 *
 * - a land height field of Gaussian islands over a seabed (`landHeightM`), with a CPU twin and TSL nodes (`createWaterLodSpikeLand`);
 * - `landLowerBoundM`: a lower bound of the land over a square, exact for this field because every island is a decreasing
 *   function of distance (the minimum over a square is at its far corner, bounded below by the far-corner distance);
 * - `isDrySquare`: the water leaf is dry when that bound is above the highest water surface;
 * - `measureLeaves`: runs the test over the leaves a `LodSelector` selected.
 */

/** One island: a Gaussian bump of `peakM` metres with standard deviation `sigmaM`, centred at (`x`, `z`). */
export interface IIsland {
  readonly x: number;
  readonly z: number;
  readonly sigmaM: number;
  readonly peakM: number;
}

/** Height of the seabed where there is no island, metres (negative: below the water). */
export const SEABED_M = -30;
/** The water's rest level, metres. */
export const SEA_LEVEL_M = 0;

/**
 * The islands: a long bay-and-coast near the origin for the eye-level views, a large island east of it, and a scatter
 * further out. Fixed, so a view means the same thing in every run.
 */
export const ISLANDS: readonly IIsland[] = [
  { x: 0, z: -600, sigmaM: 450, peakM: 70 },
  { x: 700, z: -300, sigmaM: 300, peakM: 45 },
  { x: -800, z: -900, sigmaM: 600, peakM: 90 },
  { x: 4_000, z: -2_000, sigmaM: 1_800, peakM: 160 },
  { x: -3_500, z: 2_500, sigmaM: 1_200, peakM: 110 },
  { x: 1_500, z: 4_500, sigmaM: 700, peakM: 60 },
  { x: -9_000, z: -6_000, sigmaM: 3_500, peakM: 220 },
  { x: 12_000, z: 8_000, sigmaM: 2_500, peakM: 140 },
];

/** Land height at (x, z), metres: the seabed plus every island. */
export function landHeightM(x: number, z: number, islands: readonly IIsland[] = ISLANDS): number {
  let h = SEABED_M;
  for (const island of islands) {
    const dx = x - island.x;
    const dz = z - island.z;
    h += island.peakM * Math.exp(-(dx * dx + dz * dz) / (2 * island.sigmaM * island.sigmaM));
  }
  return h;
}

/** Distance from (cx, cz) to the nearest and the farthest point of the square of half-side `half` centred at (sx, sz). */
function squareDistances(cx: number, cz: number, sx: number, sz: number, half: number): { near: number; far: number } {
  const dx = Math.abs(cx - sx);
  const dz = Math.abs(cz - sz);
  const nearX = Math.max(dx - half, 0);
  const nearZ = Math.max(dz - half, 0);
  return { near: Math.hypot(nearX, nearZ), far: Math.hypot(dx + half, dz + half) };
}

/**
 * Lower bound of the land over the axis-aligned square of half-side `half` centred at (x, z). Every island decreases with
 * distance, so each one contributes at least its value at the square's farthest point from its centre. Never above the true
 * minimum, and equal to the sum of the islands' lowest values (not the lowest value of the sum), so it is conservative.
 */
export function landLowerBoundM(x: number, z: number, half: number, islands: readonly IIsland[] = ISLANDS): number {
  let bound = SEABED_M;
  for (const island of islands) {
    const { far } = squareDistances(island.x, island.z, x, z, half);
    bound += island.peakM * Math.exp(-(far * far) / (2 * island.sigmaM * island.sigmaM));
  }
  return bound;
}

/** The highest the water surface can be: its rest level plus the wave amplitudes (and any margin the caller wants). */
export function waterCeilingM(waveBoundM: number, marginM = 0): number {
  return SEA_LEVEL_M + waveBoundM + marginM;
}

/** True when the land is above the water everywhere on the square, so no water can be seen on it. */
export function isDrySquare(x: number, z: number, half: number, ceilingM: number, islands: readonly IIsland[] = ISLANDS): boolean {
  return landLowerBoundM(x, z, half, islands) > ceilingM;
}

/**
 * Metres of land the cover hook wants above the water's highest surface before it calls a leaf covered. The land mesh is
 * piecewise linear between its vertices and a bump is concave on top, so the drawn land sags below the analytic height by
 * roughly `peak / sigma^2 * spacing^2 / 8` (under a metre for these islands at their leaf spacing); a margin of a few metres
 * keeps a covered leaf from showing water through the sag.
 */
export const COVER_MARGIN_M = 3;

/**
 * The library cover hook for the water body: a water leaf is covered when the land over its footprint is above the highest
 * the water can be (`heightBoundM`, waves and detail noise included) plus `marginM`. The footprint is the axis-aligned box
 * around the leaf's four corners (a plane of the equal-angle warp is linear, so that box is the leaf itself). Camera-independent,
 * as a `NodeCoverHook` must be; allocates nothing per call.
 */
export function createLandCoverHook(islands: readonly IIsland[] = ISLANDS, marginM = COVER_MARGIN_M): NodeCoverHook {
  const position: Vec3 = [0, 0, 0];
  const normal: Vec3 = [0, 0, 0];
  return {
    covered(node, selector) {
      const domain = selector.settings.domain;
      const root = selector.root[node];
      const size = 1 / 2 ** selector.level[node];
      const u0 = selector.i[node] * size;
      const v0 = selector.j[node] * size;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let corner = 0; corner < 4; corner++) {
        domainPoint(domain, root, u0 + (corner & 1) * size, v0 + (corner >> 1) * size, position, normal);
        minX = Math.min(minX, position[0]);
        maxX = Math.max(maxX, position[0]);
        minZ = Math.min(minZ, position[2]);
        maxZ = Math.max(maxZ, position[2]);
      }
      const half = Math.max(maxX - minX, maxZ - minZ) / 2;
      return isDrySquare((minX + maxX) / 2, (minZ + maxZ) / 2, half, waterCeilingM(selector.settings.heightBoundM, marginM), islands);
    },
  };
}

/** Water depth D at (x, z): the sea level minus the land height, metres. Positive over water, negative on dry land. */
export function waterDepthM(x: number, z: number, islands: readonly IIsland[] = ISLANDS): number {
  return SEA_LEVEL_M - landHeightM(x, z, islands);
}

/**
 * What the shore review's one mechanism does to the waves (ER 080, 2026-11-02 shoreline review): the wave height is scaled by
 * `smoothstep(0, rampM, D)`, so the water is flat at the waterline (D = 0) and on dry land, and has its full waves from
 * `rampM` metres of depth. The shore is then exactly where the land crosses the sea level, and no crest can stand above land.
 */
export function shoreWeight(depthM: number, rampM: number): number {
  const t = Math.min(1, Math.max(0, depthM / rampM));
  return t * t * (3 - 2 * t);
}

/** What {@link auditShore} finds. */
export interface IShoreAudit {
  /** Sample points that lie on dry land (land above the sea level). */
  readonly dryPoints: number;
  /** Dry points where the water surface is above the land: the crescents. */
  readonly violations: number;
  /** Largest height of the water surface over the land at a dry point, metres (0 when none). */
  readonly maxExcessM: number;
  /** Mean of the same over the violations, metres. */
  readonly meanExcessM: number;
}

/**
 * The crescent gate (CPU): over a square grid of `halfM` and `stepM`, at every dry point (land above the sea level) the water
 * surface `waterAt` must not stand above the land by more than `toleranceM`. The land height is the analytic one the land
 * body draws (its mesh sags below it by under a metre between vertices, which the tolerance allows for).
 */
export function auditShore(
  waterAt: (x: number, z: number) => number,
  halfM: number,
  stepM: number,
  toleranceM = 0.05,
  islands: readonly IIsland[] = ISLANDS,
  landAt: (x: number, z: number) => number = (x, z) => landHeightM(x, z, islands),
): IShoreAudit {
  let dry = 0;
  let violations = 0;
  let maxExcess = 0;
  let excessSum = 0;
  for (let x = -halfM; x <= halfM; x += stepM) {
    for (let z = -halfM; z <= halfM; z += stepM) {
      const land = landAt(x, z);
      if (land <= SEA_LEVEL_M) continue;
      dry++;
      const excess = waterAt(x, z) - land;
      if (excess > toleranceM) {
        violations++;
        excessSum += excess;
        if (excess > maxExcess) maxExcess = excess;
      }
    }
  }
  return { dryPoints: dry, violations, maxExcessM: maxExcess, meanExcessM: violations > 0 ? excessSum / violations : 0 };
}

/** What the shore look reads (ER 080, 2026-11-02 shoreline review, experiment 4): every length is a water depth D or a distance in D. */
export interface IShoreLookParams {
  /** Depth over which the waterline foam falls from full (at D = 0) to none, metres. */
  readonly edgeM: number;
  /** Depth from which there are no breaker lines, metres. */
  readonly zoneM: number;
  /** Distance between breaker lines, metres of depth. */
  readonly spacingM: number;
  /** Speed at which the breaker lines travel towards the shore, metres of depth per second. */
  readonly speedMS: number;
  /** Depth scale of the water colour: the deep colour is reached from a few of these, metres. */
  readonly tintScaleM: number;
}

/**
 * The look the spike starts with (untuned). The spike's seabed is 30 m below the sea level, so no water here is deeper than 30 m:
 * the breaker zone and the colour scale are sized to that. A planet's oceans need these scales from the sea's own depth range.
 */
export const SHORE_LOOK: IShoreLookParams = { edgeM: 3, zoneM: 20, spacingM: 6, speedMS: 2, tintScaleM: 8 };

function smooth(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Foam at water depth `depthM` and time `timeS`, 0 to 1: a band at the waterline (full at D = 0, gone at `edgeM`) and breaker
 * lines, which are stripes of constant D that travel towards the shore and fade out by `zoneM`. Depends on D alone, so it
 * follows the shore wherever the land crosses the sea level, with no coast map.
 */
export function shoreFoam(depthM: number, timeS: number, look: IShoreLookParams = SHORE_LOOK): number {
  const edge = 1 - smooth(0, look.edgeM, depthM);
  const phase = (depthM + look.speedMS * timeS) / look.spacingM;
  const stripe = smooth(0.75, 1, 0.5 + 0.5 * Math.cos(2 * Math.PI * phase));
  const breakers = (1 - smooth(look.edgeM, look.zoneM, depthM)) * stripe * 0.8;
  return Math.max(edge, breakers);
}

/** Water colour depth term at `depthM`, 0 (shallow) to 1 (deep): the light the water absorbs on the way down and up. */
export function shoreDeepness(depthM: number, look: IShoreLookParams = SHORE_LOOK): number {
  return 1 - Math.exp(-Math.max(depthM, 0) / look.tintScaleM);
}

/** What {@link auditShoreLook} finds. */
export interface IShoreLookAudit {
  /** Sample points over water (land at or below the sea level). */
  readonly wetPoints: number;
  /** Water points within half of `edgeM` of the waterline. */
  readonly edgePoints: number;
  /** Of those, the ones whose foam is under one half: a gap in the waterline foam. Must be 0. */
  readonly edgeGaps: number;
  /** Water points deeper than `zoneM` that have any foam. Must be 0. */
  readonly farFoam: number;
  /** Mean deepness of the water within 2 m of the waterline. */
  readonly shallowDeepness: number;
  /** Mean deepness of the water deeper than `zoneM`. */
  readonly deepDeepness: number;
}

/**
 * The shore look gate (CPU): over a square grid, the foam must cover the waterline without a gap, be gone in deep water, and the
 * colour must go from shallow to deep with the depth. `lookAt` is the page's own look at a point (so its uniforms and the
 * land it reads are what is judged), returning foam and deepness.
 */
export function auditShoreLook(
  lookAt: (x: number, z: number) => { readonly foam: number; readonly deepness: number },
  halfM: number,
  stepM: number,
  look: IShoreLookParams = SHORE_LOOK,
  islands: readonly IIsland[] = ISLANDS,
): IShoreLookAudit {
  let wet = 0;
  let edge = 0;
  let gaps = 0;
  let far = 0;
  let shallowSum = 0;
  let shallowCount = 0;
  let deepSum = 0;
  let deepCount = 0;
  for (let x = -halfM; x <= halfM; x += stepM) {
    for (let z = -halfM; z <= halfM; z += stepM) {
      const depth = waterDepthM(x, z, islands);
      if (depth < 0) continue;
      wet++;
      const { foam, deepness } = lookAt(x, z);
      if (depth <= look.edgeM / 2) {
        edge++;
        if (foam < 0.5) gaps++;
      }
      if (depth <= 2) {
        shallowSum += deepness;
        shallowCount++;
      }
      if (depth > look.zoneM) {
        if (foam > 0) far++;
        deepSum += deepness;
        deepCount++;
      }
    }
  }
  return {
    wetPoints: wet,
    edgePoints: edge,
    edgeGaps: gaps,
    farFoam: far,
    shallowDeepness: shallowCount > 0 ? shallowSum / shallowCount : 0,
    deepDeepness: deepCount > 0 ? deepSum / deepCount : 0,
  };
}

/** The naive control: judges a square by the land under its centre only, so a shore cell is wrongly called dry. */
export function isDryByCentre(x: number, z: number, ceilingM: number, islands: readonly IIsland[] = ISLANDS): boolean {
  return landHeightM(x, z, islands) > ceilingM;
}

/** TSL twin of {@link landHeightM} at a plane-frame position node. */
export function landHeightNode(position: any, islands: readonly IIsland[] = ISLANDS): any {
  let h: any = float(SEABED_M);
  for (const island of islands) {
    const dx = position.x.sub(island.x);
    const dz = position.z.sub(island.z);
    h = h.add(exp(dx.mul(dx).add(dz.mul(dz)).div(-2 * island.sigmaM * island.sigmaM)).mul(island.peakM));
  }
  return h;
}

/**
 * The islands baked into the library's plane height texture (ER 080, shoreline review, experiment 5): what a real terrain gives
 * the water. `source` is the `TextureHeightSource` the land's `<flatTerrain>` draws and the water reads, so both see the same
 * texels. `bakeMs` is the CPU time of the bake and `megabytes` the texture's size.
 */
export interface IBakedLand {
  readonly source: TextureHeightSource;
  /** Side of the square the texture covers, metres. */
  readonly sizeM: number;
  /** Texture size exponent: 2^k texel cells per side. */
  readonly k: number;
  readonly bakeMs: number;
  readonly megabytes: number;
}

/** Texture size exponent of the spike's baked land: 2^11 cells over 100 km is 49 m per texel (16.8 MB). */
export const BAKED_LAND_K = 11;

/** Bakes the islands over a `sizeM` square at 2^`k` texel cells per side. Deterministic. */
export function bakeWaterLodSpikeLand(sizeM: number, k: number = BAKED_LAND_K, islands: readonly IIsland[] = ISLANDS): IBakedLand {
  const began = performance.now();
  const baked = bakeHeights({ kind: 'plane', warp: 'equal-angle', sizeM, k }, (x, _y, z) => landHeightM(x, z, islands));
  const bakeMs = performance.now() - began;
  return { source: createTextureHeightSource('bumps-baked', baked), sizeM, k, bakeMs, megabytes: baked.texels.byteLength / 1e6 };
}

/**
 * TSL height of the baked land at a plane-frame position node: the library's own lattice read (four texel loads and a
 * float32 bilinear blend), with the lattice coordinate from the position (PLANE_FRAME: u = +X, v = -Z), clamped to the texture.
 */
export function bakedLandHeightNode(land: IBakedLand, position: any): any {
  const steps = MAX_LATTICE_STEPS;
  const lattice = vec2(
    clamp(position.x.div(land.sizeM).add(0.5).mul(steps), 0, steps),
    clamp(position.z.negate().div(land.sizeM).add(0.5).mul(steps), 0, steps),
  );
  return land.source.lattice!.heightNode(int(0), lattice);
}

/** CPU twin of {@link bakedLandHeightNode}: the same texels and float32 arithmetic. */
export function bakedLandHeightM(land: IBakedLand, x: number, z: number): number {
  return land.source.heightAt(x, 0, z);
}

/** What {@link auditTerrainRead} finds. */
export interface ITerrainReadAudit {
  /** Grid points compared. */
  readonly points: number;
  /** Largest |D(baked) - D(analytic)| over the grid, metres. */
  readonly maxDepthErrorM: number;
  /** Mean of the same, metres. */
  readonly meanDepthErrorM: number;
  /** Points where the two disagree on wet or dry, all of them. */
  readonly signFlips: number;
  /** Points that disagree on wet or dry although the analytic water depth is more than `clearM` from zero: there are none unless the bake is wrong. */
  readonly clearFlips: number;
  /** Points whose analytic depth is within `clearM` of the waterline (the only ones allowed to flip). */
  readonly nearWaterline: number;
}

/**
 * The correctness gate for the baked read (CPU): over a square grid, the water depth D from the baked land against D from the
 * analytic islands. A bilinear texture cannot be exact between its texels, so the gate is on the error in metres and on wet/dry
 * flips away from the waterline (where a flip only moves the shore by the error divided by the slope).
 */
export function auditTerrainRead(
  analyticAt: (x: number, z: number) => number,
  bakedAt: (x: number, z: number) => number,
  halfM: number,
  stepM: number,
  clearM = 1,
): ITerrainReadAudit {
  let points = 0;
  let maxError = 0;
  let errorSum = 0;
  let flips = 0;
  let clearFlips = 0;
  let near = 0;
  for (let x = -halfM; x <= halfM; x += stepM) {
    for (let z = -halfM; z <= halfM; z += stepM) {
      const a = SEA_LEVEL_M - analyticAt(x, z);
      const b = SEA_LEVEL_M - bakedAt(x, z);
      const error = Math.abs(a - b);
      points++;
      errorSum += error;
      if (error > maxError) maxError = error;
      if (Math.abs(a) <= clearM) near++;
      if (a > 0 !== b > 0) {
        flips++;
        if (Math.abs(a) > clearM) clearFlips++;
      }
    }
  }
  return { points, maxDepthErrorM: maxError, meanDepthErrorM: points > 0 ? errorSum / points : 0, signFlips: flips, clearFlips, nearWaterline: near };
}

/**
 * `HeightSource` for the land's own `<flatTerrain>`. Analytic, with the CPU twin and TSL nodes reading the one island table;
 * `boundM` is the largest |height| (the seabed or every peak at once).
 */
export function createWaterLodSpikeLand(islands: readonly IIsland[] = ISLANDS): HeightSource {
  const boundM = Math.max(Math.abs(SEABED_M), Math.abs(SEABED_M + islands.reduce((sum, island) => sum + island.peakM, 0)));
  return {
    id: 'bumps',
    boundM,
    heightAt: (x, _y, z) => landHeightM(x, z, islands),
    heightNode(position: any) {
      return landHeightNode(position, islands);
    },
    gradientNode(position: any) {
      let gx: any = float(0);
      let gz: any = float(0);
      for (const island of islands) {
        const dx = position.x.sub(island.x);
        const dz = position.z.sub(island.z);
        const sigma2 = island.sigmaM * island.sigmaM;
        const bump = exp(dx.mul(dx).add(dz.mul(dz)).div(-2 * sigma2)).mul(island.peakM / sigma2).negate();
        gx = gx.add(bump.mul(dx));
        gz = gz.add(bump.mul(dz));
      }
      return vec3(gx, 0, gz);
    },
  } as HeightSource;
}

/** A camera for the CPU-only selection: where it is, what it looks at, and the lens. */
export interface ILandView {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  /** Vertical field of view, degrees. */
  readonly fovDeg: number;
  readonly aspect: number;
  /** Drawing buffer height, pixels. */
  readonly heightPx: number;
}

/**
 * The selector settings `<flatTerrain>` builds for the plane (distance mode, 16-cell patches, default hysteresis), so a
 * headless selection matches the page's body. `heightBoundM` is the water body's global height bound.
 */
export function planeSelectorSettings(sizeM: number, cellPixels: number, leafCap: number, heightBoundM: number): SelectorSettings {
  return {
    domain: { kind: 'plane', sizeM, warp: 'equal-angle' },
    patchCells: 16,
    mode: 'distance',
    fixedLevel: 5,
    cellPixels,
    leafCap,
    heightBoundM,
    cull: true,
    hysteresis: 0.15,
  };
}

/** Fills a `SelectorView` for `view` (camera axes from the look direction with +Y up; the frustum from the lens). */
export function selectorViewFor(view: ILandView): SelectorView {
  const [px, py, pz] = view.position;
  let fx = view.target[0] - px;
  let fy = view.target[1] - py;
  let fz = view.target[2] - pz;
  const length = Math.hypot(fx, fy, fz);
  fx /= length;
  fy /= length;
  fz /= length;
  // right = forward x worldUp (0, 1, 0), up = right x forward
  let rx = -fz;
  let rz = fx;
  const rLength = Math.hypot(rx, rz);
  rx /= rLength;
  rz /= rLength;
  const axes: CameraAxes = {
    right: [rx, 0, rz],
    forward: [fx, fy, fz],
    // up = right x forward
    up: [-rz * fy, rz * fx - rx * fz, rx * fy],
  };
  const fov = (view.fovDeg * Math.PI) / 180;
  const frustum = frustumNormals(axes, fov, view.aspect, new Float64Array(12));
  return { camera: [px, py, pz], pixelAngle: (2 * Math.tan(fov / 2)) / view.heightPx, frustum };
}

/** What `measureLeaves` finds in one selection. */
export interface ILeafCull {
  /** Leaves the selector chose (drawn and frustum-culled). */
  readonly leaves: number;
  /** Selected leaves inside the frustum: the ones drawn. */
  readonly drawn: number;
  /** Drawn leaves lying entirely under land by the conservative test. */
  readonly dryDrawn: number;
  /** Drawn leaves the centre-only control calls dry. */
  readonly dryDrawnByCentre: number;
  /** Drawn leaves the centre-only control calls dry although water can be seen on them: the control's wrong calls. */
  readonly centreWrongCalls: number;
  /** Drawn leaves the conservative test calls dry although a dense sample of the leaf finds a wet point: must be 0. */
  readonly conservativeWrongCalls: number;
  /** Drawn leaves with some wet point (not dry). */
  readonly wetDrawn: number;
  /** Leaves the calls above were made on: the drawn ones, or every selected leaf for scope 'all'. */
  readonly checked: number;
  /** Leaves in the frustum that the selector's cover hook hid this frame (0 without a hook). */
  readonly covered: number;
  /** Nodes that still wanted to split when the leaf cap stopped the selection. */
  readonly unmet: number;
  readonly capHit: boolean;
  readonly deepestLevel: number;
  /** Mean longest edge of the drawn leaves that hold water, metres: smaller is finer water where it can be seen. */
  readonly wetEdgeMeanM: number;
}

/** Corner points per side the exact check samples a leaf with (9 x 9 = 81 points). */
const CHECK_STEPS = 8;

/**
 * Runs the dry test over the drawn leaves of `selector` (a plane domain) and checks every call against a dense sample of
 * the leaf's footprint. A leaf's footprint is the square spanned by its four corners; with the equal-angle plane warp its
 * edges are not axis-aligned in general, so the axis-aligned box around the corners is used (larger, so the test stays conservative).
 *
 * The first `stats.drawn` entries of `selector.leaves` are the drawn ones; scope 'all' checks every selected leaf instead, which
 * is how the leaves a cover hook removed are audited.
 */
export function measureLeaves(
  selector: LodSelector,
  domain: LodDomain,
  ceilingM: number,
  islands: readonly IIsland[] = ISLANDS,
  scope: 'drawn' | 'all' = 'drawn',
): ILeafCull {
  const position: Vec3 = [0, 0, 0];
  const normal: Vec3 = [0, 0, 0];
  const drawn = selector.stats.drawn;
  const checked = scope === 'all' ? selector.stats.leaves : drawn;
  let wetEdgeSum = 0;
  let wetEdgeCount = 0;
  let dry = 0;
  let dryCentre = 0;
  let centreWrong = 0;
  let conservativeWrong = 0;
  for (let k = 0; k < checked; k++) {
    const node = selector.leaves[k];
    const root = selector.root[node];
    const size = 1 / 2 ** selector.level[node];
    const u0 = selector.i[node] * size;
    const v0 = selector.j[node] * size;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let wet = false;
    for (let a = 0; a <= CHECK_STEPS; a++) {
      for (let b = 0; b <= CHECK_STEPS; b++) {
        domainPoint(domain, root, u0 + (a / CHECK_STEPS) * size, v0 + (b / CHECK_STEPS) * size, position, normal);
        const x = position[0];
        const z = position[2];
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
        if (landHeightM(x, z, islands) <= ceilingM) wet = true;
      }
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const half = Math.max(maxX - minX, maxZ - minZ) / 2;
    const isDry = isDrySquare(cx, cz, half, ceilingM, islands);
    const centreDry = isDryByCentre(cx, cz, ceilingM, islands);
    if (isDry) dry++;
    if (centreDry) dryCentre++;
    if (isDry && wet) conservativeWrong++;
    if (centreDry && wet) centreWrong++;
    if (k < drawn && !isDry) {
      wetEdgeSum += selector.edge[node];
      wetEdgeCount++;
    }
  }
  return {
    leaves: selector.stats.leaves,
    drawn,
    dryDrawn: dry,
    dryDrawnByCentre: dryCentre,
    centreWrongCalls: centreWrong,
    conservativeWrongCalls: conservativeWrong,
    wetDrawn: checked - dry,
    checked,
    covered: selector.stats.covered,
    unmet: selector.stats.unmet,
    capHit: selector.stats.capHit,
    deepestLevel: selector.stats.deepestLevel,
    wetEdgeMeanM: wetEdgeCount > 0 ? wetEdgeSum / wetEdgeCount : 0,
  };
}
