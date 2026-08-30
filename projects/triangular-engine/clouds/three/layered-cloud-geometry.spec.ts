import { buildLayeredCloudGeometry } from './layered-cloud-geometry';
import { createLayeredCloudMaterial } from './layered-cloud-material';

describe('3D Layered Cloud Geometry & Material', () => {
  it('builds 1-3 layer geometry for thin upper clouds with baked vertex attributes', () => {
    const geom = buildLayeredCloudGeometry({
      layerCount: 2,
      baseRadius: 2.0,
      totalHeight: 0.15,
      pointsPerLayer: 8,
      seed: 42,
    });

    expect(geom).toBeDefined();
    expect(geom.getAttribute('position')).toBeDefined();
    expect(geom.getAttribute('aLayerIndex')).toBeDefined();
    expect(geom.getAttribute('aNormalizedHeight')).toBeDefined();
    expect(geom.getAttribute('aRadialDist')).toBeDefined();
    expect(geom.getAttribute('aPolarAngle')).toBeDefined();
    expect(geom.getAttribute('aRandomJitter')).toBeDefined();

    geom.dispose();
  });

  it('builds 4-8 layer geometry for volumetric lower cumulus clouds', () => {
    const geom = buildLayeredCloudGeometry({
      layerCount: 6,
      baseRadius: 1.5,
      totalHeight: 0.8,
      pointsPerLayer: 8,
      seed: 123,
    });

    expect(geom.getAttribute('position').count).toBeGreaterThan(50);
    geom.dispose();
  });

  it('creates layered cloud shader material with default uniforms', () => {
    const mat = createLayeredCloudMaterial({
      morphStrength: 0.3,
      opacity: 0.6,
      faceted: true,
    });

    expect(mat.uniforms['uMorphStrength'].value).toBe(0.3);
    expect(mat.uniforms['uOpacity'].value).toBe(0.6);
    expect(mat.uniforms['uFaceted'].value).toBe(1.0);

    mat.dispose();
  });
});
