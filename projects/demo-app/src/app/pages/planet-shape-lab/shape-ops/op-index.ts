import { angleBetween, type AltitudeBand, type ShapeBounds, type V3 } from './shape-op';

/**
 * Plan 055 Phase 1b: which ops can touch a place. The body sphere is split into cube-face tiles (`tilesPerFace`² per
 * face, gnomonic), and every op is listed in each tile its bounds' caps meet, in apply order. A sample then applies only
 * its tile's ops, and the march gets a per-tile altitude band: thin over plains, tall only where ops raise or cut.
 *
 * Every op is the identity outside its caps, so applying only a tile's ops gives exactly the value of applying them all.
 * The value is still only a distance estimate for that tile: a march must not step past the tile's edge on it, since the
 * next tile's ops may raise the ground there.
 */
export interface ShapeOpIndex {
  readonly tilesPerFace: number;
  /** Positions in the op list of the ops that can touch `direction`'s tile, ascending (apply order). */
  opsAt(direction: V3): readonly number[];
  /** The base band widened by the bounds of every op in `direction`'s tile. */
  bandAt(direction: V3): AltitudeBand;
  /** Tile id (face * n² + j * n + i) of a direction, for packing per-tile lists. */
  tileOf(direction: V3): number;
  /** The op list and band of tile `tile` (what the shader twin packs). */
  opsInTile(tile: number): readonly number[];
  bandInTile(tile: number): AltitudeBand;
  readonly stats: { readonly tiles: number; readonly entries: number; readonly maxPerTile: number };
}

/** Face `f`: axis `f >> 1`, sign `+` for even. (u, v) are the next two axes over the major component. */
function faceAxes(face: number): { axis: number; sign: number } {
  return { axis: face >> 1, sign: face & 1 ? -1 : 1 };
}

function directionOf(face: number, u: number, v: number): [number, number, number] {
  const { axis, sign } = faceAxes(face);
  const d: [number, number, number] = [0, 0, 0];
  d[axis] = sign;
  d[(axis + 1) % 3] = u;
  d[(axis + 2) % 3] = v;
  const length = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / length, d[1] / length, d[2] / length];
}

/** Face and (u, v) in [-1, 1] of a direction; `null` when the direction is not in front of `face`. */
function project(direction: V3, face: number): { u: number; v: number } | null {
  const { axis, sign } = faceAxes(face);
  const major = direction[axis] * sign;
  if (major <= 1e-9) return null;
  return { u: direction[(axis + 1) % 3] / major, v: direction[(axis + 2) % 3] / major };
}

function faceOf(direction: V3): number {
  const ax = Math.abs(direction[0]);
  const ay = Math.abs(direction[1]);
  const az = Math.abs(direction[2]);
  const axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
  return axis * 2 + (direction[axis] >= 0 ? 0 : 1);
}

/** Angular radius of a whole face around its normal (the corner angle). */
const FACE_ANGLE = Math.acos(1 / Math.sqrt(3));

/** Caps wider than this list on whole faces (the gnomonic box would be loose anyway). */
const WIDE_CAP = 0.6;

const CAP_SAMPLES = 32;

/**
 * Tiles are grown by this (radians) in the cap test, so a float32 direction that lands a hair across a tile border (the
 * shader twin's lookup) still finds every op that touches it. About 6 m on an Earth-size body.
 */
const TILE_MARGIN = 1e-6;

export function buildShapeOpIndex(bounds: readonly (readonly ShapeBounds[])[], base: AltitudeBand, tilesPerFace = 32): ShapeOpIndex {
  const n = tilesPerFace;
  const tiles = 6 * n * n;
  const centres: [number, number, number][] = [];
  const radii: number[] = [];
  for (let face = 0; face < 6; face++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const at = (a: number, b: number) => directionOf(face, ((i + a) / n) * 2 - 1, ((j + b) / n) * 2 - 1);
        const centre = at(0.5, 0.5);
        centres.push(centre);
        // A tile is a convex spherical quad, so its farthest point from the centre is a corner.
        radii.push(Math.max(...[at(0, 0), at(1, 0), at(0, 1), at(1, 1)].map((corner) => angleBetween(centre, corner))) + TILE_MARGIN);
      }
    }
  }
  const lists: number[][] = Array.from({ length: tiles }, () => []);
  const bands: AltitudeBand[] = Array.from({ length: tiles }, () => base);

  const tileRange = (cap: ShapeBounds, face: number): [number, number, number, number] => {
    const whole: [number, number, number, number] = [0, n - 1, 0, n - 1];
    if (cap.angle > WIDE_CAP) return whole;
    // The cap's gnomonic image is convex (an ellipse); box its sampled rim, grown so the gaps between samples are covered.
    const { direction: c, angle } = cap;
    const helper: V3 = Math.abs(c[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const e1 = normalizeCross(c, helper);
    const e2 = normalizeCross(c, e1);
    let uMin = Infinity;
    let uMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (let s = 0; s <= CAP_SAMPLES; s++) {
      const point: V3 = s === CAP_SAMPLES ? c : rim(c, e1, e2, angle, (s / CAP_SAMPLES) * Math.PI * 2);
      const uv = project(point, face);
      if (!uv) return whole;
      uMin = Math.min(uMin, uv.u);
      uMax = Math.max(uMax, uv.u);
      vMin = Math.min(vMin, uv.v);
      vMax = Math.max(vMax, uv.v);
    }
    const grow = 0.05 * Math.max(uMax - uMin, vMax - vMin) + 2 / n;
    const tile = (x: number) => Math.min(n - 1, Math.max(0, Math.floor(((x + 1) / 2) * n)));
    return [tile(uMin - grow), tile(uMax + grow), tile(vMin - grow), tile(vMax + grow)];
  };

  let entries = 0;
  bounds.forEach((pieces, op) => {
    const touched = new Set<number>();
    for (const cap of pieces) {
      for (let face = 0; face < 6; face++) {
        const { axis, sign } = faceAxes(face);
        const normal: [number, number, number] = [0, 0, 0];
        normal[axis] = sign;
        if (angleBetween(cap.direction, normal) > cap.angle + FACE_ANGLE) continue;
        const [i0, i1, j0, j1] = tileRange(cap, face);
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const t = face * n * n + j * n + i;
            if (angleBetween(cap.direction, centres[t]) > cap.angle + radii[t]) continue;
            bands[t] = { bottomM: Math.min(bands[t].bottomM, cap.bottomM), topM: Math.max(bands[t].topM, cap.topM) };
            touched.add(t);
          }
        }
      }
    }
    for (const t of touched) lists[t].push(op);
    entries += touched.size;
  });

  const tileOf = (direction: V3): number => {
    const face = faceOf(direction);
    const { u, v } = project(direction, face)!;
    const tile = (x: number) => Math.min(n - 1, Math.max(0, Math.floor(((x + 1) / 2) * n)));
    return face * n * n + tile(v) * n + tile(u);
  };
  return {
    tilesPerFace: n,
    opsAt: (direction) => lists[tileOf(direction)],
    bandAt: (direction) => bands[tileOf(direction)],
    tileOf,
    opsInTile: (tile) => lists[tile],
    bandInTile: (tile) => bands[tile],
    stats: { tiles, entries, maxPerTile: lists.reduce((most, list) => Math.max(most, list.length), 0) },
  };
}

function normalizeCross(a: V3, b: V3): [number, number, number] {
  const c: [number, number, number] = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const length = Math.hypot(c[0], c[1], c[2]);
  return [c[0] / length, c[1] / length, c[2] / length];
}

/** The point `angle` radians from `c` in the direction at `phi` around it. */
function rim(c: V3, e1: V3, e2: V3, angle: number, phi: number): V3 {
  const s = Math.sin(angle);
  const k = Math.cos(angle);
  const x = Math.cos(phi) * s;
  const y = Math.sin(phi) * s;
  return [c[0] * k + e1[0] * x + e2[0] * y, c[1] * k + e1[1] * x + e2[1] * y, c[2] * k + e1[2] * x + e2[2] * y];
}
