import { Object3D, PerspectiveCamera, Vector3 } from 'three';
import { float } from 'three/tsl';
import { PlanetSurfaceMaterial } from '../planet-material/planet-surface-material';
import { getEvalRenderer } from '../planet-material/gpu-eval.testing';
import { meshOf, renderRgba, triangleWith } from '../planet-material/render-eval.testing';
import { AtmosphereBackdrop } from './atmosphere-backdrop';
import { AtmosphereGpuModel } from './atmosphere-gpu-model';
import { PlanetAtmosphereBinding } from './atmosphere-planet-stages';
import { earthAtmosphereProfile } from './atmosphere-presets';
import { scaleAtmosphereProfile } from './atmosphere-scaling';
import type { PhysicalAtmosphereProfile } from './atmosphere-profile';

const SMALL = {
  transmittanceSize: [128, 32],
  multiScatterSize: [32, 16],
  irradianceSize: [32, 8],
  multiScatterDirections: 24,
  irradianceDirections: 16,
} as const;

const RADIUS_M = 64_000;

function smallPlanetModel(): AtmosphereGpuModel {
  const profile = scaleAtmosphereProfile(earthAtmosphereProfile(), { radiusM: RADIUS_M }) as PhysicalAtmosphereProfile;
  return new AtmosphereGpuModel(profile, SMALL);
}

describe('PlanetAtmosphereBinding.sync', () => {
  it('turns the camera and the planet transform into body-frame metres, an altitude and a local frame', () => {
    const model = smallPlanetModel();
    const binding = new PlanetAtmosphereBinding(model, { radiusUnits: 1 });
    const backdrop = new AtmosphereBackdrop(model, { steps: 4, spaceScale: 0 });
    const planet = new Object3D();
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 2);

    binding.setSunBody(0, 0, 1);
    binding.sync(camera, planet, backdrop);

    expect(binding.metersPerUnit.value).toBeCloseTo(RADIUS_M, 6);
    expect(binding.cameraBody.value.z).toBeCloseTo(2 * RADIUS_M, 3);
    expect(binding.cameraAltitude.value).toBeCloseTo(RADIUS_M, 3);
    expect(backdrop.altitude.value).toBeCloseTo(RADIUS_M, 3);

    // Local y is the camera's radial direction (+z here), and the sun sits on it.
    const frame = backdrop.frame.value.elements; // column-major
    const up = new Vector3(0, 0, 1);
    const localUp = new Vector3(frame[1], frame[4], frame[7]).dot(up);
    expect(localUp).toBeCloseTo(1, 6);
    expect(model.sunDirection.value.y).toBeCloseTo(1, 6);
    expect(model.sunDirection.value.length()).toBeCloseTo(1, 6);

    backdrop.dispose();
    model.dispose();
  });

  it('keeps the sun at the same angle to the camera when the planet turns', () => {
    const model = smallPlanetModel();
    const binding = new PlanetAtmosphereBinding(model, { radiusUnits: 1 });
    const backdrop = new AtmosphereBackdrop(model, { steps: 4, spaceScale: 0 });
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 3);

    const planet = new Object3D();
    binding.setSunBody(Math.sin(0.6), 0, Math.cos(0.6));
    binding.sync(camera, planet, backdrop);
    const before = model.sunDirection.value.y;

    // Turn the planet and express the same world-space sun in its new body frame: nothing changes for the camera.
    planet.rotation.set(0.3, 1.1, -0.4);
    planet.updateMatrixWorld();
    const sunBody = new Vector3(Math.sin(0.6), 0, Math.cos(0.6)).applyQuaternion(planet.quaternion.clone().invert());
    binding.setSunBody(sunBody.x, sunBody.y, sunBody.z);
    binding.sync(camera, planet, backdrop);

    expect(model.sunDirection.value.y).toBeCloseTo(before, 5);
    expect(binding.cameraAltitude.value).toBeCloseTo(2 * RADIUS_M, 3);

    backdrop.dispose();
    model.dispose();
  });
});

describe('PlanetAtmosphereBinding.sync, the sky through the morph', () => {
  function synced(cameraAt: [number, number, number], morph: number) {
    const model = smallPlanetModel();
    const binding = new PlanetAtmosphereBinding(model, { radiusUnits: 1 });
    const backdrop = new AtmosphereBackdrop(model, { steps: 4, spaceScale: 0 });
    const camera = new PerspectiveCamera();
    camera.position.set(...cameraAt);
    binding.setSunBody(0.5, -0.2, 0.84);
    binding.morph.value = morph;
    binding.sync(camera, new Object3D(), backdrop);
    const e = backdrop.frame.value.elements;
    // Column-major storage of a row-major set(): row r holds the local axis r in world coordinates.
    const axes = [new Vector3(e[0], e[3], e[6]), new Vector3(e[1], e[4], e[7]), new Vector3(e[2], e[5], e[8])];
    return { model, binding, backdrop, axes };
  }
  const radial = new Vector3(0.5, 0.3, 2).normalize();

  it('leaves what the haze reads (frame, sun, altitude) alone as the morph changes', () => {
    const readings = [0, 0.5, 1].map((morph) => {
      const r = synced([0.5, 0.3, 2], morph);
      const internal = r.binding as unknown as { viewToLocal: { elements: number[] }; sunLocal: Vector3 };
      const out = { view: [...internal.viewToLocal.elements], sun: internal.sunLocal.clone(), alt: r.binding.cameraAltitude.value };
      r.backdrop.dispose();
      r.model.dispose();
      return out;
    });
    for (const other of readings.slice(1)) {
      expect(other.view).toEqual(readings[0].view);
      expect(other.sun.distanceTo(readings[0].sun)).toBe(0);
      expect(other.alt).toBe(readings[0].alt);
    }
  });

  it('points the sky up along the radial direction on the globe and the map normal when flat', () => {
    const globe = synced([0.5, 0.3, 2], 0);
    expect(globe.axes[1].distanceTo(radial)).toBeLessThan(1e-6);
    const flat = synced([0.5, 0.3, 2], 1);
    expect(flat.axes[1].distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-6);
    for (const r of [globe, flat]) {
      r.backdrop.dispose();
      r.model.dispose();
    }
  });

  it('keeps the sky frame orthonormal mid-morph, and over the far side of the globe', () => {
    for (const camera of [[0.5, 0.3, 2], [0, 0, -2]] as [number, number, number][]) {
      for (const morph of [0.25, 0.5, 0.9]) {
        const r = synced(camera, morph);
        for (let i = 0; i < 3; i++) {
          expect(r.axes[i].length()).toBeCloseTo(1, 5);
          for (let j = i + 1; j < 3; j++) expect(Math.abs(r.axes[i].dot(r.axes[j]))).toBeLessThan(1e-5);
        }
        r.backdrop.dispose();
        r.model.dispose();
      }
    }
  });

  it('moves the sky smoothly: a small morph step makes a small change', () => {
    const a = synced([0.5, 0.3, 2], 0.5);
    const b = synced([0.5, 0.3, 2], 0.51);
    expect(a.axes[1].distanceTo(b.axes[1])).toBeLessThan(0.02);
    for (const r of [a, b]) {
      r.backdrop.dispose();
      r.model.dispose();
    }
  });

  it('blends the sky height from the sphere altitude to the height above the map, clamped at zero', () => {
    const camera: [number, number, number] = [0.5, 0.3, 2];
    const sphere = (Math.hypot(...camera) - 1) * RADIUS_M;
    const globe = synced(camera, 0);
    expect(globe.backdrop.altitude.value).toBeCloseTo(sphere, 2);
    const flat = synced(camera, 1);
    expect(flat.backdrop.altitude.value).toBeCloseTo(RADIUS_M, 2);
    const below = synced([0, 0, 0.5], 1);
    expect(below.backdrop.altitude.value).toBe(0);
    for (const r of [globe, flat, below]) {
      r.backdrop.dispose();
      r.model.dispose();
    }
  });

  it('keeps the sun angle under the camera for the sky when flat, and fades the void with the morph', () => {
    const flat = synced([0.5, 0.3, 2], 1);
    const expected = radial.dot(new Vector3(0.5, -0.2, 0.84).normalize());
    expect(flat.model.sunDirection.value.y).toBeCloseTo(expected, 5);
    expect(flat.model.sunDirection.value.length()).toBeCloseTo(1, 5);
    expect(flat.backdrop.voidFade.value).toBe(1);
    const globe = synced([0.5, 0.3, 2], 0);
    expect(globe.backdrop.voidFade.value).toBe(0);
    for (const r of [flat, globe]) {
      r.backdrop.dispose();
      r.model.dispose();
    }
  });
});

describe('PlanetAtmosphereBinding.update', () => {
  it('renders the froxel table once, and again only when the camera or the sun moves', async () => {
    const renderer = await getEvalRenderer();
    const model = smallPlanetModel();
    const binding = new PlanetAtmosphereBinding(model, {
      radiusUnits: 1,
      aerialPerspective: { width: 8, height: 8, slices: 4, steps: 4 },
    });
    const planet = new Object3D();
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 3);
    binding.setSunBody(0, 0, 1);

    binding.sync(camera, planet);
    expect(binding.update(renderer)).toBeTrue();
    binding.sync(camera, planet);
    expect(binding.update(renderer)).toBeFalse();

    camera.position.set(0, 0, 2.5);
    binding.sync(camera, planet);
    expect(binding.update(renderer)).toBeTrue();

    camera.lookAt(0.3, 0, 0);
    binding.sync(camera, planet);
    expect(binding.update(renderer)).toBeTrue();

    binding.setSunBody(1, 0, 1);
    binding.sync(camera, planet);
    expect(binding.update(renderer)).toBeTrue();
    expect(binding.aerialPerspective?.renderCount).toBe(4);

    binding.dispose();
    model.dispose();
  });

  it('stops re-rendering the froxel table once the map is flat', async () => {
    const renderer = await getEvalRenderer();
    const model = smallPlanetModel();
    const binding = new PlanetAtmosphereBinding(model, {
      radiusUnits: 1,
      aerialPerspective: { width: 8, height: 8, slices: 4, steps: 4 },
    });
    const planet = new Object3D();
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 3);
    binding.sync(camera, planet);
    expect(binding.update(renderer)).toBeTrue();

    binding.morph.value = 1;
    camera.position.set(0, 0, 2.5);
    binding.sync(camera, planet);
    expect(binding.update(renderer)).toBeFalse();
    expect(binding.aerialPerspective?.renderCount).toBe(1);

    // Rolling back up picks the table up again, for the camera it has now.
    binding.morph.value = 0.5;
    expect(binding.update(renderer)).toBeTrue();
    expect(binding.aerialPerspective?.renderCount).toBe(2);
    binding.dispose();
    model.dispose();
  });

  it('does nothing without a table', async () => {
    const renderer = await getEvalRenderer();
    const model = smallPlanetModel();
    const binding = new PlanetAtmosphereBinding(model, { radiusUnits: 1 });
    expect(binding.aerialPerspective).toBeUndefined();
    expect(binding.update(renderer)).toBeFalse();
    model.dispose();
  });
});

describe('planet material atmosphere stages on the GPU', () => {
  const VIEW = { left: -3, right: 3, top: 1.5, bottom: -1.5 };
  const corners = [[-3, -1.5, 0], [3, -1.5, 0], [0, 1.5, 0]];
  const triangle = () =>
    triangleWith({
      position: { itemSize: 3, values: corners },
      normal: { itemSize: 3, values: corners.map(() => [0, 0, 1]) },
      aFlatPos: { itemSize: 3, values: corners },
      aFlatNorm: { itemSize: 3, values: corners.map(() => [0, 0, 1]) },
      color: { itemSize: 3, values: corners.map(() => [0.5, 0.5, 0.5]) },
    });

  const pixel = async (material: PlanetSurfaceMaterial) => {
    // The triangle lies in z = 0; a body centre far behind it makes the shaded point's radial direction +z, as its normal.
    material.morph.uBodyCentreScene.value.set(0, 0, -100);
    return (await renderRgba([meshOf(triangle(), material)], VIEW))(64, 32);
  };

  it('lights the surface from the atmosphere: bright towards the sun, dark away from it, and hazed from a distance', async () => {
    const model = smallPlanetModel();
    const binding = new PlanetAtmosphereBinding(model, { radiusUnits: 1, steps: 16 });
    // The surface normal is +z; put the camera 2R up along +z, so the surface point is R below it.
    binding.cameraBody.value.set(0, 0, 2 * RADIUS_M);
    binding.cameraAltitude.value = RADIUS_M;
    binding.metersPerUnit.value = RADIUS_M / 5; // the eval camera sits 5 units from the triangle
    binding.exposure.value = 4;

    const lit = (sun: [number, number, number], withPerspective: boolean) => {
      binding.setSunBody(...sun);
      return new PlanetSurfaceMaterial({
        lighting: { id: 'atmosphere', stage: binding.lighting() },
        ...(withPerspective ? { atmosphere: { id: 'atmosphere', stage: binding.perspective() } } : {}),
      });
    };

    const day = await pixel(lit([0, 0, 1], false));
    const night = await pixel(lit([0, 0, -1], false));
    expect(day[0]).toBeGreaterThan(0);
    expect(day[0]).toBeGreaterThan(night[0] * 20);

    const hazed = await pixel(lit([0, 0, 1], true));
    // Air in front of the surface scatters blue light into the view and removes some of the red.
    expect(hazed[2] / hazed[0]).toBeGreaterThan(day[2] / day[0]);

    model.dispose();
  });

  it('darkens both the direct light and the sky light with either sun visibility', async () => {
    const model = smallPlanetModel();
    const binding = new PlanetAtmosphereBinding(model, { radiusUnits: 1, steps: 16 });
    binding.cameraBody.value.set(0, 0, 2 * RADIUS_M);
    binding.cameraAltitude.value = RADIUS_M;
    binding.metersPerUnit.value = RADIUS_M / 5;
    binding.exposure.value = 4;
    const make = (occluded: boolean) => {
      const material = new PlanetSurfaceMaterial({ lighting: { id: 'atmosphere', stage: binding.lighting() } });
      if (occluded) material.addSunOcclusion({ id: 'eclipse', occlusion: () => float(0) });
      return material;
    };
    // Sun straight on: both the direct light and the sky light reach the surface. Sun behind the surface: only the (tiny) twilight sky.
    binding.setSunBody(0, 0, 1);
    const full = await pixel(make(false));
    expect(full[0]).toBeGreaterThan(0);

    binding.sunVisibility.value = 0;
    const planetWide = await pixel(make(false));
    expect(planetWide[0]).toBeLessThan(full[0] * 0.02);
    expect(planetWide[1]).toBeLessThan(full[1] * 0.02);
    expect(planetWide[2]).toBeLessThan(full[2] * 0.02);

    binding.sunVisibility.value = 1;
    const own = await pixel(make(true));
    expect(own[0]).toBeLessThan(full[0] * 0.02);
    expect(own[1]).toBeLessThan(full[1] * 0.02);
    expect(own[2]).toBeLessThan(full[2] * 0.02);
    model.dispose();
  });

  it('hazes a flat map from the slab alone, whether or not the globe has a table', async () => {
    const model = smallPlanetModel();
    const plain = new PlanetAtmosphereBinding(model, { radiusUnits: 1, steps: 16 });
    const tabled = new PlanetAtmosphereBinding(model, { radiusUnits: 1, steps: 16, aerialPerspective: { width: 8, height: 8, slices: 4, steps: 4 } });
    const results: number[][] = [];
    for (const binding of [plain, tabled]) {
      binding.cameraBody.value.set(0, 0, 2 * RADIUS_M);
      binding.cameraAltitude.value = RADIUS_M;
      binding.metersPerUnit.value = RADIUS_M / 5;
      binding.exposure.value = 4;
      binding.morph.value = 1;
      binding.setSunBody(0, 0, 1);
      results.push(
        Array.from(
          await pixel(new PlanetSurfaceMaterial({ lighting: { id: 'atmosphere', stage: binding.lighting() }, atmosphere: { id: 'atmosphere', stage: binding.perspective() } })),
        ),
      );
    }
    expect(results[0][2]).toBeGreaterThan(0);
    for (let c = 0; c < 3; c++) expect(results[1][c]).toBeCloseTo(results[0][c], 6);
    model.dispose();
  });
});
