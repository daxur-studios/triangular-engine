import { Vector3 } from 'three';
import { moonEclipseOcclusion, nightLightsEmissive, roadLayer } from './planet-extension-examples';
import { createPlanetDayNightUniforms, simpleDayNightLighting } from './planet-lighting';
import { PlanetSurfaceMaterial } from './planet-surface-material';
import { SURFACE_LAYER_ORDER } from './planet-surface-layers';
import { meshOf, renderRgba, triangleWith } from './render-eval.testing';

const VIEW = { left: -3, right: 3, top: 1.5, bottom: -1.5 };
const corners = [[-3, -1.5, 0], [3, -1.5, 0], [0, 1.5, 0]];
const ambient = { ambient: true };

/** A triangle covering the view whose every vertex has sphere normal `normal` and a red vertex colour. */
function tri(normal: number[]) {
  return triangleWith({
    position: { itemSize: 3, values: corners },
    normal: { itemSize: 3, values: corners.map(() => normal) },
    aFlatPos: { itemSize: 3, values: corners },
    aFlatNorm: { itemSize: 3, values: corners.map(() => [0, 0, 1]) },
    color: { itemSize: 3, values: corners.map(() => [1, 0, 0]) },
  });
}

/**
 * Renders the triangle and reads its centre pixel. The triangle lies in the z = 0 plane, so a far-away body centre
 * at `-radial * 100` makes the shaded point's radial direction `radial` (to within 2e-4 rad), whatever `normal` is.
 */
async function pixel(material: PlanetSurfaceMaterial, normal: number[], radial: number[] = normal) {
  material.morph.uBodyCentreScene.value.set(-radial[0] * 100, -radial[1] * 100, -radial[2] * 100);
  const read = await renderRgba([meshOf(tri(normal), material)], VIEW, undefined, ambient);
  return read(64, 32);
}

describe('planet extension examples on the GPU', () => {
  describe('roadLayer', () => {
    // The road is the great circle 90 degrees from +Y, i.e. the equator: y = 0.
    const withRoad = (halfWidth = 0.05) => {
      const road = roadLayer({ axis: new Vector3(0, 1, 0), halfWidth, color: '#0000ff' });
      const material = new PlanetSurfaceMaterial();
      material.addSurfaceLayer({ id: 'roads', order: SURFACE_LAYER_ORDER.game, layer: road.layer });
      return { road, material };
    };

    it('paints the road on its great circle and leaves the rest of the surface alone', async () => {
      const baseline = await pixel(new PlanetSurfaceMaterial(), [1, 0, 0]);
      const onRoad = await pixel(withRoad().material, [1, 0, 0]);
      expect(onRoad[0]).toBeLessThan(baseline[0] * 0.1);
      expect(onRoad[2]).toBeGreaterThan(baseline[2] + 0.02);

      const farNormal = [0, Math.sin(0.5), Math.cos(0.5)];
      const off = await pixel(withRoad().material, farNormal);
      const offBaseline = await pixel(new PlanetSurfaceMaterial(), farNormal);
      expect(off[0]).toBeCloseTo(offBaseline[0], 4);
      expect(off[2]).toBeCloseTo(offBaseline[2], 4);
    });

    it('follows the radial direction, not the relief-tilted surface normal', async () => {
      // Radial direction on the equator (on the road); the normal is tilted 53 degrees off it, as on a steep slope.
      const tilted = [0, 0.8, 0.6];
      const equator = [0, 0, 1];
      const baseline = await pixel(new PlanetSurfaceMaterial(), tilted, equator);
      const onRoad = await pixel(withRoad(0.2).material, tilted, equator);
      expect(onRoad[2]).toBeGreaterThan(baseline[2] + 0.02);
      // The mirror case: radial direction 53 degrees off the road, normal on the equator: no road.
      const offBaseline = await pixel(new PlanetSurfaceMaterial(), equator, tilted);
      const off = await pixel(withRoad(0.2).material, equator, tilted);
      expect(off[2]).toBeCloseTo(offBaseline[2], 4);
    });

    it('is a uniform write to change the width or the colour, never a recompile', () => {
      const { road, material } = withRoad();
      const key = material.stackKey;
      const version = material.version;
      road.halfWidth.value = 0.2;
      road.color.value.set('#ff00ff');
      road.opacity.value = 0.5;
      expect(material.stackKey).toBe(key);
      expect(material.version).toBe(version);
      expect(key).toContain('layers:vertexColor|roads');
    });

    it('widens when the width uniform grows, so a point just off the road joins it', async () => {
      const near = [0, Math.sin(0.04), Math.cos(0.04)];
      const narrow = await pixel(withRoad(0.01).material, near);
      const wide = await pixel(withRoad(0.1).material, near);
      expect(wide[2]).toBeGreaterThan(narrow[2] + 0.02);
    });
  });

  describe('moonEclipseOcclusion', () => {
    const visibility = async (normal: number[]) => {
      const eclipse = moonEclipseOcclusion({
        sunDirection: new Vector3(0, 0, 1),
        moonPosition: new Vector3(0, 0, 3),
        moonRadius: 0.27,
        planetRadius: 1,
      });
      const material = new PlanetSurfaceMaterial();
      material.addSunOcclusion({ id: 'moon', occlusion: eclipse.occlusion });
      const baseline = await pixel(new PlanetSurfaceMaterial(), normal);
      const lit = await pixel(material, normal);
      // The default occluder lighting is `baseline * mix(0.15, 1, visibility)`.
      return (lit[0] / baseline[0] - 0.15) / 0.85;
    };

    it('is in full shadow under the moon and fully lit away from it', async () => {
      expect(await visibility([0, 0, 1])).toBeCloseTo(0, 1);
      expect(await visibility([0, 1, 0])).toBeCloseTo(1, 1);
    });

    it('brightens smoothly from the umbra out through the penumbra', async () => {
      const samples: number[] = [];
      // Seen from the planet's surface the moon (radius 0.27, centre 3 away) spans about 0.13 rad, and the
      // penumbra runs from a point 0.26 to 0.29 rad round from the sub-moon point.
      for (const angle of [0, 0.1, 0.2, 0.26, 0.27, 0.28, 0.29, 0.4]) {
        samples.push(await visibility([0, Math.sin(angle), Math.cos(angle)]));
      }
      for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1] - 0.02);
      expect(samples[0]).toBeLessThan(0.1);
      expect(samples[samples.length - 1]).toBeGreaterThan(0.95);
      // Somewhere in the transition it is neither shadowed nor lit.
      expect(samples.some((v) => v > 0.15 && v < 0.85)).toBeTrue();
    });

    it('does not shade a point when the moon is on the far side of the planet from the sun', async () => {
      const eclipse = moonEclipseOcclusion({
        sunDirection: new Vector3(0, 0, 1),
        moonPosition: new Vector3(0, 0, -3),
        moonRadius: 0.27,
        planetRadius: 1,
      });
      const material = new PlanetSurfaceMaterial();
      material.addSunOcclusion({ id: 'moon', occlusion: eclipse.occlusion });
      const baseline = await pixel(new PlanetSurfaceMaterial(), [0, 0, 1]);
      const lit = await pixel(material, [0, 0, 1]);
      expect(lit[0] / baseline[0]).toBeCloseTo(1, 2);
    });

    it('moves the shadow with a uniform write, no recompile', () => {
      const eclipse = moonEclipseOcclusion();
      const material = new PlanetSurfaceMaterial();
      material.addSunOcclusion({ id: 'moon', occlusion: eclipse.occlusion });
      const key = material.stackKey;
      const version = material.version;
      eclipse.moonPosition.value.set(0, 3, 0);
      eclipse.moonRadius.value = 0.5;
      expect(material.stackKey).toBe(key);
      expect(material.version).toBe(version);
    });
  });

  describe('nightLightsEmissive', () => {
    it('adds light on the night side only, through the emissive stack', async () => {
      const lights = nightLightsEmissive({ color: '#00ff00', strength: 0.5 });
      const make = () => {
        const material = new PlanetSurfaceMaterial();
        material.addEmissive({ id: 'cityLights', emissive: lights.emissive });
        return material;
      };
      const baseline = await pixel(new PlanetSurfaceMaterial(), [0, 0, 1]);

      lights.sunDirection.value.set(0, 0, 1); // the point faces the sun: day
      const day = await pixel(make(), [0, 0, 1]);
      expect(day[1]).toBeCloseTo(baseline[1], 3);

      lights.sunDirection.value.set(0, 0, -1); // the point faces away: night
      const night = await pixel(make(), [0, 0, 1]);
      expect(night[1]).toBeGreaterThan(baseline[1] + 0.3);
      expect(night[0]).toBeCloseTo(baseline[0], 3);
    });

    it('keeps the lights at full strength on the night side under day/night lighting', async () => {
      const lights = nightLightsEmissive({ color: '#00ff00', strength: 0.5 });
      const day = createPlanetDayNightUniforms();
      day.uDayNightEnabled.value = 1;
      day.uSunDirection.value.set(0, 0, -1);
      lights.sunDirection.value.set(0, 0, -1); // night at the point
      const plain = new PlanetSurfaceMaterial({ lighting: { id: 'dayNight', stage: simpleDayNightLighting(day) } });
      const lit = new PlanetSurfaceMaterial({ lighting: { id: 'dayNight', stage: simpleDayNightLighting(day) } });
      lit.addEmissive({ id: 'cityLights', emissive: lights.emissive });
      const without = await pixel(plain, [0, 0, 1]);
      const withLights = await pixel(lit, [0, 0, 1]);
      // The night floor dims the lit colour only: the green channel gains the whole emissive 0.5 (not 0.5 x 0.018).
      expect(withLights[1] - without[1]).toBeGreaterThan(0.45);
    });
  });
});
