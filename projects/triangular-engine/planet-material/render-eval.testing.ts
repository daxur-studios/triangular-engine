import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  FloatType,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  RenderTarget,
  RGBAFormat,
  Scene,
  type Material,
} from 'three';
import { getEvalRenderer } from './gpu-eval.testing';

/**
 * Test helper: draws meshes to a small float target with an orthographic camera and returns an RGBA
 * reader (`x`, `y` from the top-left). Not shipped; nothing in the public API imports it.
 */
export async function renderRgba(
  meshes: Mesh[],
  view: { left: number; right: number; top: number; bottom: number },
  size: { width: number; height: number } = { width: 128, height: 64 },
  options: { ambient?: boolean } = {},
): Promise<(x: number, y: number) => [number, number, number, number]> {
  const renderer = await getEvalRenderer();
  const scene = new Scene();
  if (options.ambient) scene.add(new AmbientLight(0xffffff, 1));
  for (const mesh of meshes) {
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
  const camera = new OrthographicCamera(view.left, view.right, view.top, view.bottom, -10, 10);
  camera.position.set(0, 0, 5);
  const { width, height } = size;
  const target = new RenderTarget(width, height, {
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
  const data = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height)) as Float32Array;
  target.dispose();
  return (x, y) => {
    const o = ((height - 1 - y) * width + x) * 4;
    return [data[o], data[o + 1], data[o + 2], data[o + 3]];
  };
}

/** A non-indexed triangle with named float attributes, one value list per vertex (`itemSize` floats each). */
export function triangleWith(
  attributes: Record<string, { itemSize: number; values: number[][] }>,
): BufferGeometry {
  const geometry = new BufferGeometry();
  for (const [name, { itemSize, values }] of Object.entries(attributes)) {
    geometry.setAttribute(name, new BufferAttribute(new Float32Array(values.flat()), itemSize));
  }
  return geometry;
}

export function meshOf(geometry: BufferGeometry, material: Material): Mesh {
  return new Mesh(geometry, material);
}
