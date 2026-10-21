import { IcosahedronGeometry, TorusKnotGeometry } from 'three';
import { CloudVolumeAtlasLayout } from './cloud-volume-atlas';
import { bakeMeshSdf } from './cloud-volume-mesh-sdf';

/** Decodes the packed bytes back to metres at texel (x, y, z). */
function reader(data: Uint8Array, n: number, bandMeters: number): (x: number, y: number, z: number) => number {
  const layout = new CloudVolumeAtlasLayout(n);
  return (x, y, z) => {
    const px = layout.pixelOf(x, y, z);
    const byte = data[(px.y * layout.width + px.x) * 4 + layout.slotOf(z).channel];
    return (byte / 255 - 0.5) * 2 * bandMeters;
  };
}

describe('bakeMeshSdf', () => {
  const n = 32;
  const box = [100, 100, 100] as const;

  it('matches the analytic distance of a sphere inside the band and has the right sign everywhere', () => {
    const sphere = new IcosahedronGeometry(1, 4);
    const { data, bandMeters } = bakeMeshSdf(sphere.getAttribute('position').array, null, n, box, { padding: 0.2 });
    const read = reader(data, n, bandMeters);
    const radius = 30; // box 100 * (1 - 2 * 0.2) / 2 diameter 60
    const voxel = box[0] / n;
    let worst = 0;
    for (let z = 0; z < n; z += 2) for (let y = 0; y < n; y += 2) for (let x = 0; x < n; x += 2) {
      const d = Math.hypot((x + 0.5) * voxel - 50, (y + 0.5) * voxel - 50, (z + 0.5) * voxel - 50) - radius;
      const got = read(x, y, z);
      if (Math.abs(d) < bandMeters * 0.9) worst = Math.max(worst, Math.abs(got - d));
      else expect(Math.sign(got)).toBe(Math.sign(d));
    }
    expect(worst).toBeLessThan(voxel * 0.35);
  });

  it('keeps a torus knot hollow: the hole in the middle reads as outside', () => {
    const knot = new TorusKnotGeometry(1, 0.25, 160, 16);
    const { data, bandMeters } = bakeMeshSdf(knot.getAttribute('position').array, knot.getIndex()!.array, n, box, { padding: 0.05 });
    const read = reader(data, n, bandMeters);
    let inside = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (read(x, y, z) < 0) inside++;
    // A thin tube fills only a small share of its bounding box.
    expect(inside).toBeGreaterThan(n ** 3 * 0.03);
    expect(inside).toBeLessThan(n ** 3 * 0.3);
    // The box corners are far from the mesh.
    expect(read(0, 0, 0)).toBeGreaterThan(0);
  });
});
