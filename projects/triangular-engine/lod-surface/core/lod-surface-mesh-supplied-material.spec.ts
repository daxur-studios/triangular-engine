import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { LodDomain } from './lod-domain';
import { createHeightSource } from './lod-height';
import { CAP_SLACK } from './lod-selector';
import { createLodSurfaceMesh } from './lod-surface-mesh';

const PLANE: LodDomain = { kind: 'plane', sizeM: 10_000, warp: 'equal-angle' };

function surfaceFor(material?: MeshBasicNodeMaterial) {
  return createLodSurfaceMesh({
    domain: PLANE,
    patchCells: 16,
    source: createHeightSource('flat', 'plane'),
    capacity: 64 + CAP_SLACK,
    ...(material ? { material } : {}),
  });
}

describe('lod-surface-mesh: a supplied material outlives its surface', () => {
  it('flags the material for each surface built on it, so the renderer does not reuse the earlier surface\'s compiled program', () => {
    const material = new MeshBasicNodeMaterial();
    const first = surfaceFor(material);
    const afterFirst = material.version;
    expect(afterFirst).toBeGreaterThan(0);
    const firstPosition = material.positionNode;

    first.dispose();
    const second = surfaceFor(material);
    expect(material.version).toBeGreaterThan(afterFirst);
    expect(material.positionNode).not.toBe(firstPosition);
    second.dispose();
  });

  it('leaves the version of the default material alone: a new material compiles fresh anyway', () => {
    const surface = surfaceFor();
    expect(surface.material.version).toBe(0);
    surface.dispose();
  });
});
