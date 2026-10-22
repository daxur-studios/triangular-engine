import { unitM } from './planet-shape-field';
import { generateNoiseBytes } from './planet-shape-noise';
import {
  BEHIND_FOOTPRINTS, OFF_SURFACE_FOOTPRINTS, TERRAIN_SAMPLE_STRIDE, compareTerrainDepth, labFieldCpu, referenceMarchCpu, terrainFrameFromRgba,
  type TerrainDepthFrame,
} from './planet-shape-terrain-quality';

/** A frame of `width` x `height` whose pixel gives (distance, field), or `undefined` for sky. */
function frame(width: number, height: number, pixel: (column: number, row: number) => readonly [number, number] | undefined): TerrainDepthFrame {
  const distance = new Float32Array(width * height).fill(Number.NaN);
  const field = new Float32Array(width * height).fill(Number.NaN);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const value = pixel(column, row);
      if (value) [distance[row * width + column], field[row * width + column]] = value;
    }
  }
  return { width, height, distance, field, ranOut: 0 };
}

describe('planet shape terrain quality', () => {
  it('reads the probe: ground where alpha is 1, the field in blue, and counts the pixels that ran out', () => {
    const rgba = new Float32Array([5, 0, 0.5, 1, 7, 1, -2, 1, 9, 0, 0, 0, 0, 0, 0, 0]);
    const read = terrainFrameFromRgba(rgba, 4, 1);
    expect(read.distance[0]).toBe(5);
    expect(read.field[0]).toBe(0.5);
    expect(read.distance[1]).toBe(7);
    expect(read.field[1]).toBe(-2);
    expect(Number.isNaN(read.distance[2])).toBeTrue();
    expect(Number.isNaN(read.field[2])).toBeTrue();
    expect(Number.isNaN(read.distance[3])).toBeTrue();
    expect(read.ranOut).toBe(1);
  });

  it('passes a stop short along the ray on the surface, and counts points off it, behind it, holes and edge shifts', () => {
    // A wall 1000 m away over the left 24 of 32 columns; a footprint there is 1 m.
    const pixelAngle = 0.001;
    const width = 32;
    const height = 16;
    const reference = frame(width, height, (column) => (column < 24 ? [1000, 0.1] : undefined));
    const same = compareTerrainDepth(reference, reference, pixelAngle);
    expect(same.wrongShare).toBe(0);
    expect(same.drawnReference).toBe(24 * height);
    expect(same.fieldFootprints.length).toBe((24 / TERRAIN_SAMPLE_STRIDE) * (height / TERRAIN_SAMPLE_STRIDE));
    expect(same.referenceFieldMax).toBeCloseTo(0.1, 6);
    const fast = frame(width, height, (column, row) => {
      // Row 0: 10 footprints short, on the surface (a cone stop at a grazing angle): fine.
      if (row === 0 && column < 3) return [1000 - 10, 1];
      // Row 1: as short, but the field says it is off the surface: a band.
      if (row === 1 && column < 2) return [1000 - 10, OFF_SURFACE_FOOTPRINTS + 2];
      // Row 2: behind the wall, through it; row 3: behind, but within the line.
      if (row === 2 && column < 4) return [1000 + BEHIND_FOOTPRINTS + 2, 0];
      if (row === 3 && column < 5) return [1000 + BEHIND_FOOTPRINTS - 1, 0];
      // A 3 x 3 hole well inside the wall, and the wall's edge a column wider.
      if (row >= 6 && row < 9 && column >= 6 && column < 9) return undefined;
      if (column === 24) return [1000, 0];
      return column < 24 ? [1000, 0] : undefined;
    });
    const result = compareTerrainDepth(fast, reference, pixelAngle);
    expect(result.offSurface).toBe(2);
    expect(result.behind).toBe(4);
    expect(result.coverageWrong).toBe(9);
    expect(result.edgeShift).toBe(height);
    expect(result.wrongShare).toBeCloseTo(15 / (25 * height), 10);
  });

  it('marches the CPU twin onto the ground the field reports, straight down and slanted', () => {
    const radiusM = 600_000;
    const u = unitM(radiusM);
    const field = labFieldCpu({ bodyId: '600km', rayBiome: 'canyons', rayRock: 'biome', rayEdits: 'landforms' }, generateNoiseBytes());
    const pixelAngle = 1e-4;
    let checked = 0;
    for (let i = 0; i < 12; i++) {
      // East of the poses, through canyon country, the road and the arch's legs.
      const a = ((2 + i * 2) * u) / radiusM;
      const b = ((-4 + (i % 5) * 2) * u) / radiusM;
      const up: [number, number, number] = [Math.sin(a) * Math.cos(b), Math.sin(b), Math.cos(a) * Math.cos(b)];
      const ground = field.groundHeightAt(up);
      const above = ground + 3 * u;
      const origin: [number, number, number] = [up[0] * (radiusM + above), up[1] * (radiusM + above), up[2] * (radiusM + above)];
      const down = referenceMarchCpu(field, origin, [-up[0], -up[1], -up[2]], pixelAngle, 1e7);
      // Straight down, the first rock is the outermost surface `groundHeightAt` finds.
      expect(Math.abs(down - (above - ground))).withContext(`column ${i}`).toBeLessThan(u * 0.01);
      // Slanted, the hit is ground: the field is zero there and rock just past it.
      const s = 0.6;
      const east: [number, number, number] = [Math.cos(a), 0, -Math.sin(a)];
      const d: [number, number, number] = [0, 1, 2].map((k) => east[k] * s - up[k] * Math.sqrt(1 - s * s)) as [number, number, number];
      const t = referenceMarchCpu(field, origin, d, pixelAngle, 1e7);
      expect(Number.isNaN(t)).withContext(`slanted ${i}`).toBeFalse();
      const at = (distance: number): [number, number, number] => [origin[0] + d[0] * distance, origin[1] + d[1] * distance, origin[2] + d[2] * distance];
      expect(field.density(at(t * 0.999), t * pixelAngle)).withContext(`air before, ${i}`).toBeGreaterThan(-u * 0.01);
      expect(field.density(at(t + u * 0.02), t * pixelAngle)).withContext(`rock after, ${i}`).toBeLessThan(u * 0.01);
      checked++;
    }
    expect(checked).toBe(12);
  });

  it('builds the field the lab draws: biome and rock overrides, and the preset ops', () => {
    const bytes = generateNoiseBytes();
    const canyons = labFieldCpu({ bodyId: '600km', rayBiome: 'canyons', rayRock: 'grounded', rayEdits: 'landforms' }, bytes);
    expect(canyons.biomeOverride).toBe(0);
    expect(canyons.groundedOverride).toBe(1);
    expect(canyons.shapeOps.map((op) => op.id)).toContain('road');
    const blend = labFieldCpu({ bodyId: '64km', rayBiome: 'blend', rayRock: 'biome', rayEdits: 'pad' }, bytes);
    expect(blend.biomeOverride).toBeUndefined();
    expect(blend.groundedOverride).toBeUndefined();
    expect(blend.radiusM).toBe(64_000);
  });
});
