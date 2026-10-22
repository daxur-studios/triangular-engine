import { Fn, abs, clamp, exp, float, floor, length, min, mix, normalize, pow, select, smoothstep, uint, vec3 } from 'three/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A procedural star field (Plan 049, Phase 5): no texture and no geometry, one evaluation per sky pixel.
 *
 * The sphere of directions is split like a cube map: six faces, each an `N x N` grid of cells. A cell holds at most one
 * star, placed and coloured by an integer hash of the cell, so the field is the same on every GPU and the CPU twin
 * ({@link starFieldStar}) finds the same stars. Each layer is a grid of its own size; the coarse layer holds the few
 * bright stars, the fine one the many faint ones.
 *
 * A star is drawn as a Gaussian about half a pixel wide, so it stays a point at any field of view. A layer fades out
 * once its cells are under a few pixels across, which keeps a wide or low-resolution view from shimmering.
 *
 * The output is display-referred (added after exposure): the stars are not physical radiance, which a fixed exposure
 * tuned for the day sky would show as black.
 */
export interface StarFieldLayer {
  /** Cells along each edge of a cube face. */
  readonly cells: number;
  /** Share of cells that hold a star, 0..1. */
  readonly density: number;
  /** Display brightness of the brightest star of the layer. */
  readonly brightness: number;
  /** Exponent on the hashed brightness: higher makes most stars of the layer faint. */
  readonly falloff: number;
  /** Hash seed of the layer, under 2^31. */
  readonly seed: number;
}

export const STAR_FIELD_LAYERS: readonly StarFieldLayer[] = [
  { cells: 40, density: 0.6, brightness: 1.6, falloff: 4, seed: 0x1b873593 },
  { cells: 110, density: 0.5, brightness: 0.8, falloff: 3, seed: 0x2545f491 },
  { cells: 280, density: 0.45, brightness: 0.45, falloff: 2, seed: 0x68e31da4 },
];

/** Gaussian width of a star in pixels (one standard deviation). */
export const STAR_SIGMA_PIXELS = 0.55;
/** A layer is hidden below this many pixels per cell and fully drawn above {@link STAR_FADE_FULL_PIXELS}. */
export const STAR_FADE_START_PIXELS = 3;
export const STAR_FADE_FULL_PIXELS = 6;

const HASH_MULTIPLIER = 0x45d9f3b;
const BLUE = [0.72, 0.82, 1] as const;
const WHITE = [1, 1, 1] as const;
const ORANGE = [1, 0.82, 0.6] as const;

/** One star of the field, as the CPU twin finds it. */
export interface StarFieldStar {
  /** Unit direction in the star frame. */
  readonly direction: readonly [number, number, number];
  /** Display brightness times colour at the star's centre. */
  readonly radiance: readonly [number, number, number];
}

/** The integer hash the shader uses (two rounds of xor-shift-multiply), as an unsigned 32-bit number. */
export function starHash(x: number): number {
  let v = Math.imul(((x >>> 16) ^ x) >>> 0, HASH_MULTIPLIER) >>> 0;
  v = Math.imul(((v >>> 16) ^ v) >>> 0, HASH_MULTIPLIER) >>> 0;
  return ((v >>> 16) ^ v) >>> 0;
}

/** The top 24 bits of a hash as a number in [0, 1), exact in float32. */
export function starHashUnit(h: number): number {
  return (h >>> 8) / 16777216;
}

/** Cube face (0..5: +x, -x, +y, -y, +z, -z) and cell of a direction on a grid of `cells` per edge. */
export function starFieldCell(direction: readonly [number, number, number], cells: number): { face: number; i: number; j: number } {
  const [x, y, z] = direction;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  let face: number;
  let u: number;
  let v: number;
  if (ax >= ay && ax >= az) {
    face = x > 0 ? 0 : 1;
    u = z / ax;
    v = y / ax;
  } else if (ay >= az) {
    face = y > 0 ? 2 : 3;
    u = x / ay;
    v = z / ay;
  } else {
    face = z > 0 ? 4 : 5;
    u = x / az;
    v = y / az;
  }
  const i = Math.min(Math.floor((u * 0.5 + 0.5) * cells), cells - 1);
  const j = Math.min(Math.floor((v * 0.5 + 0.5) * cells), cells - 1);
  return { face, i, j };
}

/** The star in one cell of a layer, or undefined when the cell is empty. The CPU twin of the shader. */
export function starFieldStar(layer: StarFieldLayer, face: number, i: number, j: number): StarFieldStar | undefined {
  const n = layer.cells;
  const key = (face * n + j) * n + i;
  const h0 = starHash((key ^ layer.seed) >>> 0);
  if (starHashUnit(h0) >= layer.density) return undefined;
  const h1 = starHash(h0);
  const h2 = starHash(h1);
  const h3 = starHash(h2);
  const h4 = starHash(h3);
  const su = ((i + 0.15 + 0.7 * starHashUnit(h1)) / n) * 2 - 1;
  const sv = ((j + 0.15 + 0.7 * starHashUnit(h2)) / n) * 2 - 1;
  const sign = face % 2 === 0 ? 1 : -1;
  const axis = Math.floor(face / 2);
  const p = axis === 0 ? [sign, sv, su] : axis === 1 ? [su, sign, sv] : [su, sv, sign];
  const l = Math.hypot(p[0], p[1], p[2]);
  const brightness = layer.brightness * Math.pow(starHashUnit(h3), layer.falloff);
  const t = starHashUnit(h4);
  const a = Math.min(1, Math.max(0, t * 2));
  const b = Math.min(1, Math.max(0, t * 2 - 1));
  const colour = [0, 1, 2].map((c) => {
    const cool = BLUE[c] + (WHITE[c] - BLUE[c]) * a;
    return cool + (ORANGE[c] - cool) * b;
  });
  return {
    direction: [p[0] / l, p[1] / l, p[2] / l],
    radiance: [brightness * colour[0], brightness * colour[1], brightness * colour[2]],
  };
}

function smoothstepCpu(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The star field's display radiance along a unit direction, on the CPU: what {@link starField} draws there. */
export function starFieldAt(
  direction: readonly [number, number, number],
  pixelAngle: number,
  layers: readonly StarFieldLayer[] = STAR_FIELD_LAYERS,
): [number, number, number] {
  const l = Math.hypot(direction[0], direction[1], direction[2]);
  const d = [direction[0] / l, direction[1] / l, direction[2] / l] as const;
  const sigma = pixelAngle * STAR_SIGMA_PIXELS;
  const total: [number, number, number] = [0, 0, 0];
  for (const layer of layers) {
    const { face, i, j } = starFieldCell(d, layer.cells);
    const star = starFieldStar(layer, face, i, j);
    if (!star) continue;
    const s = star.direction;
    const chord = Math.hypot(d[0] - s[0], d[1] - s[1], d[2] - s[2]);
    const profile = Math.exp(-0.5 * (chord / sigma) ** 2);
    const fade = smoothstepCpu(STAR_FADE_START_PIXELS, STAR_FADE_FULL_PIXELS, Math.PI / 2 / layer.cells / pixelAngle);
    for (let c = 0; c < 3; c++) total[c] += star.radiance[c] * profile * fade;
  }
  return total;
}

const hashNode = (x: any): any => {
  const m = uint(HASH_MULTIPLIER);
  const s = uint(16);
  const a = x.shiftRight(s).bitXor(x).mul(m).toVar();
  const b = a.shiftRight(s).bitXor(a).mul(m).toVar();
  return b.shiftRight(s).bitXor(b).toVar();
};

const unitNode = (h: any): any => float(h.shiftRight(uint(8))).div(16777216);

/**
 * Display radiance of the star field along a unit direction `dir` (star frame), for pixels `pixelAngle` radians
 * across. Call inside a TSL `Fn`.
 */
export function starField(dir: any, pixelAngle: any, layers: readonly StarFieldLayer[] = STAR_FIELD_LAYERS): any {
  return Fn(() => {
    const d: any = normalize(dir).toVar();
    const ax = abs(d.x);
    const ay = abs(d.y);
    const az = abs(d.z);
    const isX = ax.greaterThanEqual(ay).and(ax.greaterThanEqual(az)).toVar();
    const isY = isX.not().and(ay.greaterThanEqual(az)).toVar();
    const major = select(isX, ax, select(isY, ay, az)).toVar();
    const u = select(isX, d.z, d.x).div(major).toVar();
    const v = select(isX, d.y, select(isY, d.z, d.y)).div(major).toVar();
    const positive = select(isX, d.x, select(isY, d.y, d.z)).greaterThan(0);
    const sign = select(positive, float(1), float(-1)).toVar();
    const face = select(isX, float(0), select(isY, float(2), float(4))).add(select(positive, float(0), float(1))).toVar();
    const sigma = pixelAngle.mul(STAR_SIGMA_PIXELS).toVar();
    const total = vec3(0).toVar();

    for (const layer of layers) {
      const n = layer.cells;
      const i = min(floor(u.mul(0.5).add(0.5).mul(n)), n - 1);
      const j = min(floor(v.mul(0.5).add(0.5).mul(n)), n - 1);
      const key = uint(face.mul(n).add(j).mul(n).add(i));
      const h0 = hashNode(key.bitXor(uint(layer.seed)));
      const h1 = hashNode(h0);
      const h2 = hashNode(h1);
      const h3 = hashNode(h2);
      const h4 = hashNode(h3);
      const su = i.add(0.15).add(unitNode(h1).mul(0.7)).div(n).mul(2).sub(1);
      const sv = j.add(0.15).add(unitNode(h2).mul(0.7)).div(n).mul(2).sub(1);
      const point = select(isX, vec3(sign, sv, su), select(isY, vec3(su, sign, sv), vec3(su, sv, sign)));
      const chord = length(d.sub(normalize(point)));
      const exists = select(unitNode(h0).lessThan(layer.density), float(1), float(0));
      const brightness = pow(unitNode(h3), layer.falloff).mul(layer.brightness);
      const t = unitNode(h4);
      const cool = mix(vec3(...BLUE), vec3(...WHITE), clamp(t.mul(2), 0, 1));
      const colour = mix(cool, vec3(...ORANGE), clamp(t.mul(2).sub(1), 0, 1));
      const profile = exp(chord.div(sigma).pow(2).mul(-0.5));
      const cellPixels = float((Math.PI / 2) / n).div(pixelAngle);
      const fade = smoothstep(STAR_FADE_START_PIXELS, STAR_FADE_FULL_PIXELS, cellPixels);
      total.addAssign(colour.mul(brightness.mul(profile).mul(exists).mul(fade)));
    }
    return total;
  })();
}
