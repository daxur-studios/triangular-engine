import { createPlanetMorphUniforms } from './planet-morph-nodes';
import { planetOceanMaterial } from './planet-ocean-material';
import { PlanetSurfaceMaterial } from './planet-surface-material';
import { meshOf, renderRgba, triangleWith } from './render-eval.testing';

describe('planetOceanMaterial', () => {
  const corners = [[-3, -1.5, 0], [3, -1.5, 0], [0, 1.5, 0]];
  const geometry = () =>
    triangleWith({
      position: { itemSize: 3, values: corners },
      normal: { itemSize: 3, values: corners.map(() => [0, 0, 1]) },
      aSpherePos: { itemSize: 3, values: corners },
      aSphereNorm: { itemSize: 3, values: corners.map(() => [0, 0, 1]) },
      aFlatPos: { itemSize: 3, values: corners },
      aFlatNorm: { itemSize: 3, values: corners.map(() => [0, 0, 1]) },
    });
  const view = { left: -Math.PI, right: Math.PI, top: Math.PI / 2, bottom: -Math.PI / 2 };

  it('is a translucent PlanetSurfaceMaterial with a solid base layer and the shared morph', () => {
    const morph = createPlanetMorphUniforms();
    const { material } = planetOceanMaterial({ morph });
    expect(material instanceof PlanetSurfaceMaterial).toBeTrue();
    expect(material.transparent).toBeTrue();
    expect(material.opacity).toBe(0.68);
    expect(material.depthWrite).toBeFalse();
    expect(material.morph).toBe(morph);
    expect(material.stackKey).toContain('layers:base');
    expect(material.stackKey).not.toContain('vertexColor');
  });

  it('draws at its opacity, and a colour change is a uniform write (no recompile)', async () => {
    const { material, color } = planetOceanMaterial({ color: '#000000', opacity: 0.5 });
    const version = material.version;
    const read = await renderRgba([meshOf(geometry(), material)], view, undefined, { ambient: true });
    expect(read(64, 32)[3]).toBeCloseTo(0.5, 2);
    const dark = read(64, 32)[0];

    color.value.set('#ffffff');
    const lit = (await renderRgba([meshOf(geometry(), material)], view, undefined, { ambient: true }))(64, 32)[0];
    expect(material.version).toBe(version);
    expect(lit).toBeGreaterThan(dark + 0.05);
  });
});
