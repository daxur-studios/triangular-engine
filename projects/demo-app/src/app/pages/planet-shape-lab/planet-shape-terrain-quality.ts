import { REFERENCE_STEP_SCALE } from './planet-shape-field';
import { createTerrainFieldCpu, type TerrainFieldCpu } from './planet-shape-field-cpu';
import { bodyById, type BodyId } from './planet-shape-config';
import { shapeOpPreset, type TerrainEditPresetId } from './planet-shape-edits';
import { generateNoiseBytes } from './planet-shape-noise';
import { pixelRay, type QualityProbeCamera } from './planet-shape-quality';
import type { RayBiome, RayRock } from './planet-shape-tests';

/**
 * Plan 055: how wrong the raymarched terrain's march is, as numbers. The GPU draws the view twice into float targets:
 * with the march as the screen uses it (`fast`, without the pre-pass) and with a slow reference march that trusts the
 * field a sixteenth as far, never steps under a pixel and hits only on a crossing (`planet-shape-raymarch-lit.ts`). Each
 * also writes the field at the point it drew, in pixel footprints.
 *
 * The fast march stops within half a pixel cone of the ground, which at a grazing angle can be many footprints short
 * along the ray while the field says it is on the surface; that is how it is meant to work. So a pixel drawn by both is
 * wrong only when its fast point is
 * - off the surface: the field there is more than `OFF_SURFACE_FOOTPRINTS` from zero (bands, a refinement that landed
 *   off the wall, a ray that ran out of steps), or
 * - behind the reference by more than `BEHIND_FOOTPRINTS` along the ray: it went through ground the reference hit.
 * A pixel drawn by one march only is wrong when it is more than `EDGE_PIXELS` from the reference's outline (a sliver,
 * a hole, ground that is not there); nearer, it is an edge drawn a little fatter or thinner, counted apart.
 *
 * The reference is checked in turn on a few pixels against the same march on the CPU twin of the field, in doubles
 * (`referenceMarchCpu`), so a fault in the shader's field cannot hide in both GPU frames.
 *
 * Pure functions only, so the spec can feed them synthetic frames.
 */

/** Offscreen size of the terrain probe. The reference march is slow; width a multiple of 16 for an unpadded readback. */
export const TERRAIN_PROBE_SIZE = { width: 480, height: 270 } as const;

/** A drawn point whose field is further than this from zero (footprints) is off the surface. */
export const OFF_SURFACE_FOOTPRINTS = 4;

/** A fast point this far behind the reference (footprints along the ray) went through ground. */
export const BEHIND_FOOTPRINTS = 4;

/**
 * Drawn by one march only within this many pixels of the reference's outline: an edge shift, not wrong. The fast march
 * draws the far horizon up to 3 or 4 pixels fat (its half-pixel cone at a grazing angle); at 3, the landform views of
 * 2026-10-22 kept at most 0.12% of their pixels past it.
 */
export const EDGE_PIXELS = 3;

/** Every this many pixels in x and y, one error sample: the saved result stays small, the counts use every pixel. */
export const TERRAIN_SAMPLE_STRIDE = 4;

/** Pixels whose reference is checked against the CPU march: a grid of this many columns and rows. */
export const CPU_CHECK_GRID = { columns: 8, rows: 5 } as const;

export interface TerrainDepthFrame {
  readonly width: number;
  readonly height: number;
  /** Distance along the pixel's ray in metres; `NaN` on sky. Row 0 is the top (WebGPU texture origin). */
  readonly distance: Float32Array;
  /** The field at the drawn point, in footprints there; `NaN` on sky. */
  readonly field: Float32Array;
  /** Pixels whose march ran out of steps inside the band (drawn where they stopped). */
  readonly ranOut: number;
}

/**
 * The probe readback (RGBA float: red distance, green 1 where the steps ran out, blue the field at the drawn point in
 * footprints, alpha 1 on ground) as a frame.
 */
export function terrainFrameFromRgba(rgba: Float32Array, width: number, height: number): TerrainDepthFrame {
  const distance = new Float32Array(width * height);
  const field = new Float32Array(width * height);
  let ranOut = 0;
  for (let i = 0; i < width * height; i++) {
    const drawn = rgba[i * 4 + 3] === 1;
    distance[i] = drawn ? rgba[i * 4] : Number.NaN;
    field[i] = drawn ? rgba[i * 4 + 2] : Number.NaN;
    if (rgba[i * 4 + 1] === 1) ranOut++;
  }
  return { width, height, distance, field, ranOut };
}

export interface TerrainDepthComparison {
  readonly drawnFast: number;
  readonly drawnReference: number;
  /**
   * Pixels drawn by both whose fast point is in front of the reference by more than `BEHIND_FOOTPRINTS` along the ray,
   * with the field there further than `OFF_SURFACE_FOOTPRINTS` from zero.
   */
  readonly offSurface: number;
  /** Pixels drawn by both whose fast point is behind the reference by more than `BEHIND_FOOTPRINTS`, on the surface. */
  readonly behind: number;
  /** Pixels drawn by one march only, more than `EDGE_PIXELS` from the reference's outline. */
  readonly coverageWrong: number;
  /** Pixels drawn by one march only, within `EDGE_PIXELS` of the reference's outline. */
  readonly edgeShift: number;
  /** `offSurface + behind + coverageWrong` over the pixels either frame draws. */
  readonly wrongShare: number;
  /** |field at the fast point| in footprints, every `TERRAIN_SAMPLE_STRIDE` pixels where both draw. */
  readonly fieldFootprints: number[];
  /** The most |field at the reference point| in footprints: the reference's own stop, near 0. */
  readonly referenceFieldMax: number;
}

/** Compares a fast frame with the reference; `pixelAngle` is radians per probe pixel (the footprint per metre of distance). */
export function compareTerrainDepth(fast: TerrainDepthFrame, reference: TerrainDepthFrame, pixelAngle: number): TerrainDepthComparison {
  const { width, height } = fast;
  if (reference.width !== width || reference.height !== height) throw new Error('Fast and reference frames differ in size');
  const ref = reference.distance;
  /** Whether a pixel within `EDGE_PIXELS` is drawn by the reference as `drawn`. */
  const nearOutline = (column: number, row: number, drawn: boolean): boolean => {
    for (let dy = -EDGE_PIXELS; dy <= EDGE_PIXELS; dy++) {
      for (let dx = -EDGE_PIXELS; dx <= EDGE_PIXELS; dx++) {
        const c = column + dx;
        const r = row + dy;
        if (c >= 0 && r >= 0 && c < width && r < height && !Number.isNaN(ref[r * width + c]) === drawn) return true;
      }
    }
    return false;
  };
  let drawnFast = 0;
  let drawnReference = 0;
  let either = 0;
  let offSurface = 0;
  let behind = 0;
  let coverageWrong = 0;
  let edgeShift = 0;
  let referenceFieldMax = 0;
  const fieldFootprints: number[] = [];
  const half = TERRAIN_SAMPLE_STRIDE >> 1;
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const i = row * width + column;
      const f = fast.distance[i];
      const r = ref[i];
      const inFast = !Number.isNaN(f);
      const inReference = !Number.isNaN(r);
      if (inFast) drawnFast++;
      if (inReference) {
        drawnReference++;
        referenceFieldMax = Math.max(referenceFieldMax, Math.abs(reference.field[i]));
      }
      if (!inFast && !inReference) continue;
      either++;
      if (inFast !== inReference) {
        if (nearOutline(column, row, !inReference)) edgeShift++;
        else coverageWrong++;
        continue;
      }
      const field = Math.abs(fast.field[i]);
      if (row % TERRAIN_SAMPLE_STRIDE === half && column % TERRAIN_SAMPLE_STRIDE === half) fieldFootprints.push(field);
      const along = (f - r) / (r * pixelAngle);
      if (Math.abs(along) <= BEHIND_FOOTPRINTS) continue;
      if (along > 0) behind++;
      else if (field > OFF_SURFACE_FOOTPRINTS) offSurface++;
    }
  }
  return {
    drawnFast, drawnReference, offSurface, behind, coverageWrong, edgeShift,
    wrongShare: either ? (offSurface + behind + coverageWrong) / either : 0, fieldFootprints, referenceFieldMax,
  };
}

/** What a terrain v2 view is drawn from: enough to build the CPU twin of its field. */
export interface TerrainFieldSettings {
  readonly bodyId: BodyId;
  readonly rayBiome: RayBiome;
  readonly rayRock: RayRock;
  readonly rayEdits: TerrainEditPresetId;
}

/** The CPU twin of the field the lab draws for these settings (biome and rock overrides, the shape ops of the preset). */
export function labFieldCpu(settings: TerrainFieldSettings, bytes: Uint8Array = generateNoiseBytes()): TerrainFieldCpu {
  const radiusM = bodyById(settings.bodyId).radiusM;
  const biome = settings.rayBiome === 'canyons' ? 0 : settings.rayBiome === 'hills' ? 1 : undefined;
  const rock = settings.rayRock === 'wild' ? 0 : settings.rayRock === 'grounded' ? 1 : undefined;
  const field = createTerrainFieldCpu(radiusM, bytes, [], biome, rock);
  field.setShapeOps(shapeOpPreset(settings.rayEdits, radiusM));
  return field;
}

/** Most steps of the CPU reference march before it gives up (`NaN`). */
const CPU_MAX_STEPS = 20_000;
const CPU_REFINE_PIXELS = 0.05;

/**
 * The reference march on the CPU twin, in doubles: from `origin` along unit `direction`, step by the field times
 * `REFERENCE_STEP_SCALE` (at least a pixel, never past the nearest union shape) until the field is negative, then bisect
 * to a twentieth of a pixel. Returns the distance, or `NaN` if the ray leaves upwards above the field's band or passes
 * `maxM`. Below the band is the solid floor, as on the GPU.
 */
export function referenceMarchCpu(
  field: TerrainFieldCpu, origin: readonly [number, number, number], direction: readonly [number, number, number], pixelAngle: number, maxM: number,
): number {
  const radiusM = field.radiusM;
  const band = field.band;
  const point = (t: number): [number, number, number] => [origin[0] + direction[0] * t, origin[1] + direction[1] * t, origin[2] + direction[2] * t];
  const fieldAt = (t: number) => field.density(point(t), t * pixelAngle);
  let previous = 0;
  let fieldPrevious = Number.NaN;
  let t = 0;
  for (let n = 0; n < CPU_MAX_STEPS && t <= maxM; n++) {
    const p = point(t);
    const length = Math.hypot(p[0], p[1], p[2]);
    const altitude = length - radiusM;
    if (altitude < band.bottomM) return t;
    const rising = (p[0] * direction[0] + p[1] * direction[1] + p[2] * direction[2]) / length > 0;
    if (altitude > band.topM && rising) return Number.NaN;
    const footprint = t * pixelAngle;
    const value = field.density(p, footprint);
    if (value < 0) {
      if (Number.isNaN(fieldPrevious)) return t;
      let lo = previous;
      let hi = t;
      let fieldLo = fieldPrevious;
      let fieldHi = value;
      while (hi - lo > footprint * CPU_REFINE_PIXELS) {
        const mid = (lo + hi) / 2;
        const fieldMid = fieldAt(mid);
        if (fieldMid < 0) {
          hi = mid;
          fieldHi = fieldMid;
        } else {
          lo = mid;
          fieldLo = fieldMid;
        }
      }
      return lo + ((hi - lo) * fieldLo) / (fieldLo - fieldHi);
    }
    previous = t;
    fieldPrevious = value;
    t += Math.max(Math.min(value * REFERENCE_STEP_SCALE, field.reach(p, footprint)), footprint, 1e-3);
  }
  return Number.NaN;
}

export interface ReferenceCpuCheck {
  /** Grid pixels compared (both draw); the others are skipped. */
  readonly compared: number;
  /** Grid pixels drawn by one of GPU reference and CPU march only. */
  readonly coverageMismatch: number;
  /** |GPU reference - CPU march| in footprints, per compared pixel. */
  readonly errorFootprints: number[];
}

/** Checks the GPU reference frame against `referenceMarchCpu` on a `CPU_CHECK_GRID` of its pixels. */
export function checkReferenceOnCpu(reference: TerrainDepthFrame, field: TerrainFieldCpu, camera: QualityProbeCamera, pixelAngle: number): ReferenceCpuCheck {
  const { width, height } = reference;
  let compared = 0;
  let coverageMismatch = 0;
  const errorFootprints: number[] = [];
  for (let gy = 0; gy < CPU_CHECK_GRID.rows; gy++) {
    for (let gx = 0; gx < CPU_CHECK_GRID.columns; gx++) {
      const column = Math.floor(((gx + 0.5) / CPU_CHECK_GRID.columns) * width);
      const row = Math.floor(((gy + 0.5) / CPU_CHECK_GRID.rows) * height);
      const [dx, dy, dz] = pixelRay(camera, width, height, column, row);
      const cpu = referenceMarchCpu(field, camera.position, [dx, dy, dz], pixelAngle, camera.far);
      const gpu = reference.distance[row * width + column];
      if (Number.isNaN(cpu) !== Number.isNaN(gpu)) coverageMismatch++;
      if (Number.isNaN(cpu) || Number.isNaN(gpu)) continue;
      compared++;
      errorFootprints.push(Math.abs(gpu - cpu) / (cpu * pixelAngle));
    }
  }
  return { compared, coverageMismatch, errorFootprints };
}
