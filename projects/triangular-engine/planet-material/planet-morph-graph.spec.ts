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
import { getEvalRenderer } from './gpu-eval.testing';
import { PlanetSurfaceMaterial } from './planet-surface-material';

/**
 * End-to-end check of stage 1 on a real GPU backend: the vertex attributes, the shader-side
 * projection, the seam-cull varying and the fragment mask, all through `PlanetSurfaceMaterial`.
 * (The maths alone is covered by `projection-nodes.spec.ts`.)
 */
describe('planetMorphGraph on the GPU', () => {
  const W = 128;
  const H = 64;

  /** Unit direction at (lon, lat) in the identity frame: +Z is lon 0, +X is lon pi/2. */
  const dirAt = (lon: number, lat: number): [number, number, number] => [
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
    Math.cos(lat) * Math.cos(lon),
  ];

  function triangleGeometry(corners: [number, number][]): BufferGeometry {
    const dirs = corners.map(([lon, lat]) => dirAt(lon, lat));
    const geometry = new BufferGeometry();
    const flat = (fill: (k: number) => number[]) =>
      new BufferAttribute(new Float32Array([0, 1, 2].flatMap(fill)), 3);
    geometry.setAttribute('position', flat((k) => dirs[k]));
    geometry.setAttribute('normal', flat((k) => dirs[k]));
    geometry.setAttribute('color', flat(() => [1, 1, 1]));
    geometry.setAttribute('aFlatPos', flat(() => [0, 0, 0]));
    geometry.setAttribute('aFlatNorm', flat(() => [0, 0, 1]));
    geometry.setAttribute('aOtherDir1', flat((k) => dirs[(k + 1) % 3]));
    geometry.setAttribute('aOtherDir2', flat((k) => dirs[(k + 2) % 3]));
    return geometry;
  }

  /** Renders to a W x H target; returns alpha per pixel (0 = nothing drawn). */
  async function alphaOf(
    material: PlanetSurfaceMaterial,
    geometries: BufferGeometry[],
    objects: BatchedMesh[] = [],
  ) {
    const renderer = await getEvalRenderer();
    const scene = new Scene();
    scene.add(new AmbientLight(0xffffff, 1));
    for (const geometry of geometries) {
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    for (const object of objects) scene.add(object);
    // Map space for radius 1: x in [-pi, pi], y in [-pi/2, pi/2].
    const camera = new OrthographicCamera(-Math.PI, Math.PI, Math.PI / 2, -Math.PI / 2, -10, 10);
    camera.position.set(0, 0, 5);
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
    const pixels = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, W, H)) as Float32Array;
    target.dispose();
    return (x: number, y: number) => pixels[((H - 1 - y) * W + x) * 4 + 3];
  }

  function dynamicMaterial(): PlanetSurfaceMaterial {
    const material = new PlanetSurfaceMaterial({ seamCullAttributes: true });
    material.morph.uMorph.value = 1;
    material.morph.uProjMode.value = 1;
    material.morph.uProjectionType.value = 0; // equirectangular
    material.morph.uMapWidth.value = 2 * Math.PI;
    material.morph.uMapHeight.value = Math.PI;
    material.morph.uRadius.value = 1;
    return material;
  }

  // Straddles lon = pi: corners at lon +-(pi - 0.1). Projected, it spans almost the whole map width.
  const seamTriangle = (): BufferGeometry =>
    triangleGeometry([[Math.PI - 0.1, -0.1], [-Math.PI + 0.1, -0.1], [Math.PI - 0.1, -0.5]]);
  // A small triangle around lon 0, lat 0.7..1.0: far from the seam triangle's rows.
  const plainTriangle = (): BufferGeometry =>
    triangleGeometry([[-0.3, 0.7], [0.3, 0.7], [0, 1.0]]);

  // Pixel at the map centre, inside the seam triangle's stretched span and nowhere near the plain triangle.
  const seamSpanPixel: [number, number] = [W / 2, Math.round(H * (0.5 + 0.2 / Math.PI))];
  // Pixel inside the plain triangle (lon 0, lat 0.8).
  const plainPixel: [number, number] = [W / 2, Math.round(H * (0.5 - 0.8 / Math.PI))];

  it('culls a triangle that straddles the antimeridian and keeps one that does not', async () => {
    const alpha = await alphaOf(dynamicMaterial(), [seamTriangle(), plainTriangle()]);
    expect(alpha(...plainPixel)).withContext('plain triangle').toBeGreaterThan(0.5);
    expect(alpha(...seamSpanPixel)).withContext('seam-spanning triangle').toBe(0);
  });

  /**
   * A streamed patch the way `TerrainSurfaceComponent` draws it: positions relative to the patch centre,
   * instance matrix `centre - anchor`, and the anchor in the batch's own position.
   */
  function streamedPatch(anchor: [number, number, number]): BatchedMesh {
    const corners: [number, number][] = [[-0.3, 0.7], [0.3, 0.7], [0, 1.0]];
    const dirs = corners.map(([lon, lat]) => dirAt(lon, lat));
    const centre = dirs[0].map((_, axis) => (dirs[0][axis] + dirs[1][axis] + dirs[2][axis]) / 3);
    const attribute = (fill: (k: number) => number[]) =>
      new BufferAttribute(new Float32Array([0, 1, 2].flatMap(fill)), 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', attribute((k) => dirs[k].map((v, a) => v - centre[a])));
    geometry.setAttribute('normal', attribute((k) => dirs[k]));
    geometry.setAttribute('color', attribute(() => [1, 1, 1]));
    // Flat position as the worker bakes it (equirectangular, centre 0/0), relative to the sphere centre.
    geometry.setAttribute(
      'aFlatPos',
      attribute((k) => [corners[k][0] - centre[0], corners[k][1] - centre[1], -centre[2]]),
    );
    geometry.setAttribute('aFlatNorm', attribute(() => [0, 0, 1]));
    const batch = new BatchedMesh(1, 3, 3, dynamicMaterial());
    batch.frustumCulled = false;
    batch.position.set(...anchor);
    const id = batch.addInstance(batch.addGeometry(geometry));
    batch.setMatrixAt(id, new Matrix4().makeTranslation(
      centre[0] - anchor[0], centre[1] - anchor[1], centre[2] - anchor[2],
    ));
    return batch;
  }

  it('projects a batched streamed patch to its map position wherever the batch anchor sits', async () => {
    for (const anchor of [[0, 0, 0], [0.4, -0.3, 2.5]] as [number, number, number][]) {
      const batch = streamedPatch(anchor);
      const alpha = await alphaOf(batch.material as PlanetSurfaceMaterial, [], [batch]);
      expect(alpha(...plainPixel)).withContext(`anchor ${anchor}`).toBeGreaterThan(0.5);
    }
  });

  it('draws the stretched triangle when the seam cull is removed (the check can fail)', async () => {
    const material = dynamicMaterial();
    material.maskNode = null;
    material.needsUpdate = true;
    const alpha = await alphaOf(material, [seamTriangle()]);
    expect(alpha(...seamSpanPixel)).toBeGreaterThan(0.5);
  });
});
