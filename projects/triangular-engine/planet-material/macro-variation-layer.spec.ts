import {
  AmbientLight,
  BatchedMesh,
  BufferAttribute,
  BufferGeometry,
  FloatType,
  Matrix4,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  RenderTarget,
  RGBAFormat,
  Scene,
} from 'three';
import { float, vec4 } from 'three/tsl';
import { sampleTerrainMacroVariation } from 'triangular-engine/terrain';
import { evaluateOnGpu, getEvalRenderer } from './gpu-eval.testing';
import {
  macroVariationLayer,
  terrainMacroApply,
  terrainMacroHash3,
  terrainMacroValueNoise3,
  terrainMacroVariation3,
} from './macro-variation-layer';
import { PlanetSurfaceMaterial } from './planet-surface-material';
import { SURFACE_LAYER_ORDER } from './planet-surface-layers';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('macro variation maths on the GPU', () => {
  // The hash is `fract(sin(dot(p, k)) * 43758.5453)`. In float32 the dot product alone is off by ~1e-5, which
  // the 44000x multiplier turns into ~0.4, so the GPU hash cannot equal the float64 CPU hash (the GLSL patch
  // has the same property). What can be pinned: the hash is in [0, 1) and deterministic, the noise
  // interpolates the GPU's own hashes exactly like the CPU sampler interpolates its own, and the coordinate
  // transform (position / scale + offset, scale clamped to >= 1) is the CPU's.
  const lattice = [0, 1].flatMap((z) => [0, 1].flatMap((y) => [0, 1].map((x) => [x, y, z])));
  const smooth = (t: number) => t * t * (3 - 2 * t);

  it('hashes lattice points into [0, 1)', async () => {
    const out = await evaluateOnGpu(lattice.map((c) => [[c[0] + 3, c[1] - 2, c[2], 0]]), (at) =>
      vec4(terrainMacroHash3(at(0).xyz), 0, 0, 1),
    );
    lattice.forEach((_, i) => {
      expect(out[i * 4]).toBeGreaterThanOrEqual(0);
      expect(out[i * 4]).toBeLessThan(1);
    });
    expect(new Set(lattice.map((_, i) => out[i * 4].toFixed(4))).size).toBeGreaterThan(4);
  });

  it('interpolates its own lattice hashes with the CPU sampler trilinear smoothstep scheme', async () => {
    const cells = [[2, -3, 1], [0, 0, 0], [5, 4, -2]];
    const frac = [[0.3, 0.6, 0.2], [0.9, 0.1, 0.7], [0.5, 0.5, 0.5]];
    const corners = cells.flatMap((c) => lattice.map((o) => [c[0] + o[0], c[1] + o[1], c[2] + o[2], 0]));
    const hashes = await evaluateOnGpu(corners.map((c) => [c]), (at) => vec4(terrainMacroHash3(at(0).xyz), 0, 0, 1));
    const noise = await evaluateOnGpu(
      cells.map((c, i) => [[c[0] + frac[i][0], c[1] + frac[i][1], c[2] + frac[i][2], 0]]),
      (at) => vec4(terrainMacroValueNoise3(at(0).xyz), 0, 0, 1),
    );
    cells.forEach((_, i) => {
      const h = (k: number) => hashes[(i * 8 + k) * 4];
      const [tx, ty, tz] = frac[i].map(smooth);
      const lerp = (a: number, b: number, t: number) => a * (1 - t) + b * t;
      const expected = lerp(
        lerp(lerp(h(0), h(1), tx), lerp(h(2), h(3), tx), ty),
        lerp(lerp(h(4), h(5), tx), lerp(h(6), h(7), tx), ty),
        tz,
      );
      expect(noise[i * 4]).withContext(`cell ${cells[i]}`).toBeCloseTo(expected, 4);
    });
  });

  it('applies the CPU sampler offset and scale (noise at p == noise of p/scale + offset)', async () => {
    // Same noise coordinate reached two ways: scale 1 at `coord - offset`, and scale 8 at 8x that.
    const coord = [2.3, -3.6, 1.2];
    const offset = [17.3, -9.1, 4.7];
    const base = coord.map((v, k) => v - offset[k]);
    const wide = await evaluateOnGpu(
      [[[base[0] * 8, base[1] * 8, base[2] * 8, 0]]],
      (at) => vec4(terrainMacroVariation3(at(0).xyz, float(8)), 0, 0, 1),
    );
    const narrow = await evaluateOnGpu(
      [[[base[0], base[1], base[2], 0]]],
      (at) => vec4(terrainMacroVariation3(at(0).xyz, float(1)), 0, 0, 1),
    );
    expect(wide[0]).toBeCloseTo(narrow[0], 3);
    // And the CPU sampler agrees on that identity, which pins the offsets to the CPU's.
    expect(sampleTerrainMacroVariation(base.map((v) => v * 8) as [number, number, number], 8)).toBeCloseTo(
      sampleTerrainMacroVariation(base as [number, number, number], 1),
      6,
    );
  });

  it('clamps a scale below 1 to 1', async () => {
    const run = (scale: number) =>
      evaluateOnGpu([[[3.2, -1.7, 5.5, 0]]], (at) => vec4(terrainMacroVariation3(at(0).xyz, float(scale)), 0, 0, 1));
    expect((await run(0.01))[0]).toBeCloseTo((await run(1))[0], 5);
  });

  it('tints warm/cool symmetrically around 0.5 and not at all with land factor 0', async () => {
    const rows = [[[0.5, 0, 0, 0]], [[1, 0, 0, 0]], [[0, 0, 0, 0]], [[1, 0, 0, 0]]];
    const lands = [1, 1, 1, 0];
    const tinted = await evaluateOnGpu(
      rows.map((r, i) => [r[0], [lands[i], 0, 0, 0]]),
      (at) => {
        const rgb = terrainMacroApply(at(0).xxx.mul(0).add(0.5), at(0).x, float(1), at(1).x);
        return vec4(rgb as any, 1);
      },
    );
    expect(tinted[0]).toBeCloseTo(0.5, 4); // variation 0.5: no tint
    expect(tinted[4]).toBeCloseTo(0.5 * 1.12, 4); // variation 1: warm in red
    expect(tinted[6]).toBeCloseTo(0.5 * (1 + 0.055), 4); // ... and a little in blue
    expect(tinted[8]).toBeCloseTo(0.5 * 0.88, 4); // variation 0: cool
    expect(tinted[12]).toBeCloseTo(0.5, 4); // land factor 0: untouched
  });
});

describe('macroVariationLayer in a PlanetSurfaceMaterial', () => {
  const W = 64;
  const H = 64;

  function triangle(): BufferGeometry {
    const geometry = new BufferGeometry();
    const attr = (values: number[], size = 3) => new BufferAttribute(new Float32Array(values), size);
    const corners = [-1.5, -1.5, 0, 1.5, -1.5, 0, 0, 1.5, 0];
    geometry.setAttribute('position', attr(corners));
    geometry.setAttribute('normal', attr([0, 0, 1, 0, 0, 1, 0, 0, 1]));
    geometry.setAttribute('color', attr(Array(9).fill(1)));
    geometry.setAttribute('aFlatPos', attr(Array(9).fill(0)));
    geometry.setAttribute('aFlatNorm', attr([0, 0, 1, 0, 0, 1, 0, 0, 1]));
    geometry.setAttribute('uv', attr([0, 0, 1, 0, 0.5, 1], 2));
    geometry.setAttribute('terrainMacroLandFactor', attr([1, 1, 1], 1));
    return geometry;
  }

  function material(): PlanetSurfaceMaterial {
    const m = new PlanetSurfaceMaterial();
    const macro = macroVariationLayer({ scaleM: 1, strength: 1 });
    m.addSurfaceLayer({ id: 'macro', order: SURFACE_LAYER_ORDER.macroVariation, layer: macro.layer });
    return m;
  }

  /** Renders `object` with the camera centred on `look`; returns the rgb at a few pixels. */
  async function pixels(object: Mesh | BatchedMesh, look: [number, number]) {
    const renderer = await getEvalRenderer();
    const scene = new Scene();
    scene.add(new AmbientLight(0xffffff, 1));
    object.frustumCulled = false;
    scene.add(object);
    const camera = new OrthographicCamera(-2, 2, 2, -2, -10, 10);
    camera.position.set(look[0], look[1], 5);
    const target = new RenderTarget(W, H, {
      type: FloatType,
      format: RGBAFormat,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
    });
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, camera);
    renderer.setRenderTarget(previous);
    const data = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, W, H)) as Float32Array;
    target.dispose();
    return [
      [24, 40],
      [32, 24],
      [40, 36],
    ].map(([x, y]) => [0, 1, 2].map((c) => data[((H - 1 - y) * W + x) * 4 + c]));
  }

  const offset = new Matrix4().makeTranslation(13.7, -4.2, 9.1);

  function translatedMesh(): Mesh {
    const mesh = new Mesh(triangle(), material());
    mesh.position.set(13.7, -4.2, 9.1);
    return mesh;
  }

  function batched(matrix: Matrix4): BatchedMesh {
    const batch = new BatchedMesh(1, 3, 3, material());
    const geometry = triangle();
    geometry.setIndex([0, 1, 2]);
    const id = batch.addInstance(batch.addGeometry(geometry));
    batch.setMatrixAt(id, matrix);
    return batch;
  }

  it('samples the same body-fixed field through a BatchedMesh translation as through the model matrix', async () => {
    const viaModel = await pixels(translatedMesh(), [13.7, -4.2]);
    const viaBatch = await pixels(batched(offset), [13.7, -4.2]);
    viaModel.forEach((rgb, i) =>
      rgb.forEach((v, c) => expect(viaBatch[i][c]).withContext(`pixel ${i} channel ${c}`).toBeCloseTo(v, 3)),
    );
  });

  it('does depend on the translation (the check can fail)', async () => {
    const atOffset = await pixels(batched(offset), [13.7, -4.2]);
    const atOrigin = await pixels(batched(new Matrix4()), [0, 0]);
    const worst = Math.max(...atOffset.flatMap((rgb, i) => rgb.map((v, c) => Math.abs(v - atOrigin[i][c]))));
    expect(worst).toBeGreaterThan(0.002);
  });
});
