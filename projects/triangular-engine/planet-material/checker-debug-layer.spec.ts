import { vec4 } from 'three/tsl';
import { checkerDebugLayer, checkerParity } from './checker-debug-layer';
import { evaluateOnGpu } from './gpu-eval.testing';
import { PlanetSurfaceMaterial } from './planet-surface-material';
import { SURFACE_LAYER_ORDER } from './planet-surface-layers';
import { meshOf, renderRgba, triangleWith } from './render-eval.testing';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('checkerDebugLayer maths on the GPU', () => {
  // Every pixel shares one cell coordinate, so `fwidth` is zero and the filter saturates: a crisp checker.
  const crisp = (cx: number, cy: number) =>
    evaluateOnGpu(
      Array.from({ length: 8 }, () => [[cx, cy, 0, 0]]),
      (at) => vec4(checkerParity(at(0).xy), 0, 0, 1),
    );

  it('marks even cells 0 and odd cells 1', async () => {
    // `sin(pi * cells)` is positive over `[0, 1)`, `[2, 3)`, ... and negative over `[1, 2)`, `[3, 4)`, ...
    expect((await crisp(0.25, 0.25))[0])
      .withContext('same band in x and y')
      .toBeCloseTo(0, 3);
    expect((await crisp(1.25, 1.25))[0])
      .withContext('same band in x and y')
      .toBeCloseTo(0, 3);
    expect((await crisp(0.25, 1.25))[0])
      .withContext('opposite bands')
      .toBeCloseTo(1, 3);
    expect((await crisp(1.25, 0.25))[0])
      .withContext('opposite bands')
      .toBeCloseTo(1, 3);
  });

  it('fades toward grey instead of aliasing when cells are sub-pixel', async () => {
    // Adjacent pixels ~2 cells apart, so `fwidth` is large and the square wave cannot saturate.
    const rows = [
      [[0.25, 0.25, 0, 0]],
      [[2.25, 2.25, 0, 0]],
      [[0.25, 0.25, 0, 0]],
      [[2.25, 2.25, 0, 0]],
    ];
    const out = await evaluateOnGpu(rows, (at) =>
      vec4(checkerParity(at(0).xy), 0, 0, 1),
    );
    for (let i = 0; i < rows.length; i++) {
      expect(out[i * 4])
        .withContext(`pixel ${i}`)
        .toBeGreaterThan(0.3);
      expect(out[i * 4])
        .withContext(`pixel ${i}`)
        .toBeLessThan(0.7);
    }
  });
});

describe('checkerDebugLayer in a PlanetSurfaceMaterial', () => {
  const view = { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6 };
  const spread = (values: number[]) =>
    Math.max(...values) - Math.min(...values);

  function geometry() {
    return triangleWith({
      position: {
        itemSize: 3,
        values: [
          [-1.5, -1.5, 0],
          [1.5, -1.5, 0],
          [0, 1.5, 0],
        ],
      },
      normal: {
        itemSize: 3,
        values: [
          [0, 0, 1],
          [0, 0, 1],
          [0, 0, 1],
        ],
      },
      color: {
        itemSize: 3,
        values: [
          [1, 1, 1],
          [1, 1, 1],
          [1, 1, 1],
        ],
      },
      uv: {
        itemSize: 2,
        values: [
          [0, 0],
          [1, 0],
          [0.5, 1],
        ],
      },
      aFlatPos: {
        itemSize: 3,
        values: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
      },
      aFlatNorm: {
        itemSize: 3,
        values: [
          [0, 0, 1],
          [0, 0, 1],
          [0, 0, 1],
        ],
      },
    });
  }

  it('replaces the albedo with a two-tone checker over the uv space, and toggles without recompiling', async () => {
    const checker = checkerDebugLayer({ space: 'uv', cellSize: 0.25 });
    const surface = new PlanetSurfaceMaterial();
    surface.addSurfaceLayer({
      id: 'checkerDebug',
      order: SURFACE_LAYER_ORDER.game,
      layer: checker.layer,
    });
    const mesh = meshOf(geometry(), surface);
    const draw = async (): Promise<number[]> => {
      const read = await renderRgba(
        [mesh],
        view,
        { width: 64, height: 64 },
        { ambient: true },
      );
      // Sample well inside the triangle (its centroid), so no background pixel is read.
      const out: number[] = [];
      for (let y = 34; y <= 47; y += 3)
        for (let x = 24; x <= 40; x += 3) out.push(read(x, y)[0]);
      return out;
    };

    checker.enabled.value = 0;
    const off = await draw();
    const key = surface.stackKey;
    const version = surface.version;

    checker.enabled.value = 1;
    const on = await draw();

    // A uniform base (the vertex colour) versus a checker with two distinct tones.
    expect(spread(off)).withContext('disabled base is flat').toBeLessThan(0.05);
    expect(spread(on))
      .withContext('checker has light and dark cells')
      .toBeGreaterThan(0.1);
    // The toggle is a uniform write, so the shader cache key and version are untouched.
    expect(surface.stackKey).toBe(key);
    expect(surface.version).toBe(version);
  });
});
