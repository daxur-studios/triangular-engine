import { Object3D, PerspectiveCamera, Scene } from 'three';
import { uniform } from 'three/tsl';
import { getEvalRenderer } from '../planet-material/gpu-eval.testing';
import { PlanetSurfaceMaterial } from '../planet-material/planet-surface-material';
import { PlanetAtmosphere, type IAtmosphereSurface, type PlanetAtmosphereOptions } from './planet-atmosphere';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SMALL = {
  transmittanceSize: [128, 32],
  multiScatterSize: [32, 16],
  irradianceSize: [32, 8],
  multiScatterDirections: 24,
  irradianceDirections: 16,
} as const;

const RADIUS_M = 64_000;

function smallAtmosphere(options: Partial<PlanetAtmosphereOptions> = {}): PlanetAtmosphere {
  return new PlanetAtmosphere({
    radiusM: RADIUS_M,
    radiusUnits: 1,
    planet: new Object3D(),
    tables: SMALL,
    skyView: { width: 16, height: 8 },
    backdrop: { steps: 4, spaceScale: 0 },
    aerialPerspective: { width: 8, height: 8, slices: 4, steps: 4 },
    ...options,
  });
}

/** Records the stage calls a planet material would receive. */
class FakeSurface implements IAtmosphereSurface {
  lighting: { id: string } | null = null;
  haze: { id: string } | null = null;
  calls = 0;
  setLightingStage(entry: { id: string } | null): void {
    this.lighting = entry;
    this.calls++;
  }
  setAtmosphereStage(entry: { id: string } | null): void {
    this.haze = entry;
    this.calls++;
  }
}

describe('PlanetAtmosphere', () => {
  it('builds the model at the given radius and scales metres to world units', () => {
    const atmosphere = smallAtmosphere();
    expect(atmosphere.model.profile.planetRadiusM).toBeCloseTo(RADIUS_M, 3);
    expect(atmosphere.binding.metersPerUnit.value).toBeCloseTo(RADIUS_M, 3);
    expect(atmosphere.object).toBe(atmosphere.backdrop.mesh);
    atmosphere.dispose();
  });

  it('rebakes only when the air or the size changes', () => {
    const atmosphere = smallAtmosphere();
    const version = atmosphere.model.profileVersion;

    expect(atmosphere.configure({ radiusM: RADIUS_M, preset: undefined })).toBeFalse();
    expect(atmosphere.model.profileVersion).toBe(version);

    // World units alone rescale, no bake.
    expect(atmosphere.configure({ radiusUnits: 2 })).toBeFalse();
    expect(atmosphere.binding.metersPerUnit.value).toBeCloseTo(RADIUS_M / 2, 3);
    expect(atmosphere.model.profileVersion).toBe(version);

    expect(atmosphere.configure({ thickness: 0.05 })).toBeTrue();
    expect(atmosphere.model.profileVersion).toBe(version + 1);
    expect(atmosphere.model.profile.topAltitudeM / RADIUS_M).toBeCloseTo(0.05, 4);

    expect(atmosphere.configure({ radiusM: 2 * RADIUS_M })).toBeTrue();
    expect(atmosphere.model.profile.planetRadiusM).toBeCloseTo(2 * RADIUS_M, 3);
    expect(atmosphere.binding.metersPerUnit.value).toBeCloseTo(RADIUS_M, 3);

    expect(atmosphere.configure({ preset: 'mars' })).toBeTrue();
    atmosphere.dispose();
  });

  it('puts both stages on a surface once, swaps them by option and takes them off again', () => {
    const atmosphere = smallAtmosphere();
    const surface = new FakeSurface();

    atmosphere.withAtmosphere(surface).withAtmosphere(surface);
    expect(surface.lighting?.id).toBe('atmosphere');
    expect(surface.haze?.id).toBe('atmosphere');
    expect(surface.calls).toBe(2);
    expect(atmosphere.hasSurface(surface)).toBeTrue();

    atmosphere.withAtmosphere(surface, { haze: false });
    expect(surface.lighting?.id).toBe('atmosphere');
    expect(surface.haze).toBeNull();
    expect(surface.calls).toBe(3);

    atmosphere.withoutAtmosphere(surface);
    expect(surface.lighting).toBeNull();
    expect(atmosphere.hasSurface(surface)).toBeFalse();
    atmosphere.dispose();
  });

  it('fits the planet material and clears its stages on dispose', () => {
    const atmosphere = smallAtmosphere();
    const material = new PlanetSurfaceMaterial();
    // Compile-time contract: the planet material is an atmosphere surface without either entry importing the other.
    const surface: IAtmosphereSurface = material;
    const ocean = new FakeSurface();
    atmosphere.withAtmosphere(surface).withAtmosphere(ocean);
    expect(material.stackKey).toContain('lighting:atmosphere');
    expect(material.stackKey).toContain('atmosphere:atmosphere');

    const scene = new Scene();
    scene.add(atmosphere.object);
    atmosphere.dispose();
    expect(material.stackKey).not.toContain('atmosphere');
    expect(ocean.lighting).toBeNull();
    expect(atmosphere.object.parent).toBeNull();
    material.dispose();
  });

  it('shares a morph uniform with the material instead of owning one', () => {
    const shared = uniform(0.25);
    const atmosphere = smallAtmosphere({ morph: shared as any });
    expect(atmosphere.binding.morph as unknown).toBe(shared);
    expect(atmosphere.morph).toBe(0.25);
    shared.value = 0.5;
    expect(atmosphere.morph).toBe(0.5);
    atmosphere.morph = 0.75;
    expect(shared.value).toBe(0.75);
    atmosphere.dispose();
  });

  it('reads the camera in update and hides the sky when off', async () => {
    const renderer = await getEvalRenderer();
    const atmosphere = smallAtmosphere();
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 1.5);

    atmosphere.update(renderer, camera);
    expect(atmosphere.binding.cameraAltitude.value).toBeCloseTo(RADIUS_M / 2, 0);
    expect(atmosphere.object.visible).toBeTrue();

    atmosphere.enabled = false;
    atmosphere.update(renderer, camera);
    expect(atmosphere.object.visible).toBeFalse();

    atmosphere.enabled = true;
    atmosphere.sky = false;
    atmosphere.update(renderer, camera);
    expect(atmosphere.object.visible).toBeFalse();
    atmosphere.dispose();
  });
});
