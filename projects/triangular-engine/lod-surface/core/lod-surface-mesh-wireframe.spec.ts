import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { LodDomain } from './lod-domain';
import { createHeightSource } from './lod-height';
import { CAP_SLACK } from './lod-selector';
import { createLodSurfaceMesh } from './lod-surface-mesh';

const SPHERE: LodDomain = { kind: 'sphere', sizeM: 10_000, warp: 'equal-angle' };

describe('lod-surface-mesh: wireframe', () => {
  it('flags the material only when the value changes, so an unchanged call every frame costs no recompile', () => {
    const material = new MeshBasicNodeMaterial();
    const surface = createLodSurfaceMesh({
      domain: SPHERE,
      patchCells: 16,
      source: createHeightSource('flat', 'sphere'),
      capacity: 64 + CAP_SLACK,
      material,
    });
    const version = material.version;

    surface.setWireframe(false);
    surface.setWireframe(false);
    expect(material.version).toBe(version);

    surface.setWireframe(true);
    expect(material.wireframe).toBeTrue();
    expect(material.version).toBe(version + 1);

    surface.setWireframe(true);
    expect(material.version).toBe(version + 1);

    surface.setWireframe(false);
    expect(material.version).toBe(version + 2);
    surface.dispose();
  });
});
