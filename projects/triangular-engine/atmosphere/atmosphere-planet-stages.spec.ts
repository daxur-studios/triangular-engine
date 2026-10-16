import { Object3D, PerspectiveCamera, Vector3 } from 'three';
import { PlanetSurfaceMaterial } from '../planet-material/planet-surface-material';
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

  const pixel = async (material: PlanetSurfaceMaterial) => (await renderRgba([meshOf(triangle(), material)], VIEW))(64, 32);

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
});
