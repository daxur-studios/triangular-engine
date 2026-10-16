import { FloatType, NearestFilter, RGBAFormat, RenderTarget, Vector4 } from 'three';
import { NodeMaterial, QuadMesh, WebGPURenderer } from 'three/webgpu';
import { int, screenCoordinate, uniformArray } from 'three/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Test helper: evaluates a TSL graph on a real GPU backend (`WebGPURenderer` with `forceWebGL`, so it
 * runs in headless Chrome) and reads the result back. There is no CPU interpreter for TSL, so this is
 * how specs compare a TSL `Fn` with its CPU reference.
 *
 * Each input row is one pixel; `build` receives `at(slot)`, a vec4 node that reads slot `slot` of that
 * row, and returns a vec4 node, the output pixel. Not shipped: nothing in the public API imports this.
 */

let rendererPromise: Promise<WebGPURenderer> | undefined;

export function getEvalRenderer(): Promise<WebGPURenderer> {
  rendererPromise ??= (async () => {
    const renderer = new WebGPURenderer({ forceWebGL: true, antialias: false });
    await renderer.init();
    return renderer;
  })();
  return rendererPromise;
}

export type GpuRow = readonly (readonly number[])[];

export async function evaluateOnGpu(
  rows: readonly GpuRow[],
  build: (at: (slot: number) => any) => any,
): Promise<Float32Array> {
  const renderer = await getEvalRenderer();
  const count = rows.length;
  const slots = Math.max(...rows.map((row) => row.length));

  const arrays = Array.from({ length: slots }, (_, slot) =>
    uniformArray(
      rows.map((row) => {
        const v = row[slot] ?? [0, 0, 0, 0];
        return new Vector4(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0);
      }),
      'vec4',
    ),
  );
  const index = int(screenCoordinate.x);
  const material = new NodeMaterial();
  material.fragmentNode = build((slot) => (arrays[slot] as any).element(index));

  const target = new RenderTarget(count, 1, {
    type: FloatType,
    format: RGBAFormat,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: false,
  });
  const quad = new QuadMesh(material);
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  quad.render(renderer);
  renderer.setRenderTarget(previous);
  const pixels = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, count, 1)) as Float32Array;
  target.dispose();
  material.dispose();
  return pixels;
}
