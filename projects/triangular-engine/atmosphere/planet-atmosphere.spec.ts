import { Object3D, PerspectiveCamera, Scene, Vector3 } from 'three';
import { uniform } from 'three/tsl';
import { getEvalRenderer } from '../planet-material/gpu-eval.testing';
import { PlanetSurfaceMaterial } from '../planet-material/planet-surface-material';
import { PlanetAtmosphere, skyShellFade, type IAtmosphereSurface, type PlanetAtmosphereOptions } from './planet-atmosphere';

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
    expect(atmosphere.object.children).toContain(atmosphere.backdrop.mesh);
    atmosphere.dispose();
  });

  it('keeps sky bodies in its group, points them from the body frame and frees them', async () => {
    const renderer = await getEvalRenderer();
    const planet = new Object3D();
    planet.rotation.y = Math.PI / 2;
    const atmosphere = smallAtmosphere({ planet });
    atmosphere.sunDirection.set(0, 0, 1);
    const moon = atmosphere.addSkyBody({ direction: [1, 0, 0] });
    expect(atmosphere.object.children).toContain(moon.body.mesh);
    expect(atmosphere.skyBodies).toEqual([moon]);

    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 1.5);
    atmosphere.update(renderer, camera);
    // A quarter turn about y takes body +x to world -z and body +z to world +x.
    expect(moon.body.direction.value.z).toBeCloseTo(-1, 6);
    expect(moon.body.sunDirection.value.x).toBeCloseTo(1, 6);
    expect(atmosphere.backdrop.objectAir.value).toBe(1);

    // Without the sky the body stays, seen through no air.
    atmosphere.sky = false;
    atmosphere.update(renderer, camera);
    expect(atmosphere.backdrop.objectAir.value).toBe(0);
    expect(moon.body.mesh.visible).toBeTrue();

    atmosphere.removeSkyBody(moon);
    expect(moon.body.mesh.parent).toBeNull();
    expect(atmosphere.skyBodies.length).toBe(0);
    atmosphere.addSkyBody();
    atmosphere.dispose();
    expect(atmosphere.skyBodies.length).toBe(0);
  });

  it('turns the stars with the planet and their own rotation', async () => {
    const renderer = await getEvalRenderer();
    const planet = new Object3D();
    planet.rotation.y = Math.PI / 2;
    const atmosphere = smallAtmosphere({ planet });
    atmosphere.stars = 2;
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 1.5);
    atmosphere.update(renderer, camera);
    expect(atmosphere.backdrop.stars.value).toBe(2);
    // World -z is body +x, which is star +x while the stars have no rotation of their own.
    const world = new Vector3(0, 0, -1).applyMatrix3(atmosphere.backdrop.starFrame.value);
    expect(world.x).toBeCloseTo(1, 6);

    atmosphere.starRotation.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
    atmosphere.update(renderer, camera);
    // The stars turned a quarter about body z, so body +x is their -y.
    const turned = new Vector3(0, 0, -1).applyMatrix3(atmosphere.backdrop.starFrame.value);
    expect(turned.y).toBeCloseTo(-1, 6);
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

  it('swaps the haze stage for the beyond-range one only when asked, and only once', () => {
    const atmosphere = smallAtmosphere();
    const surface = new FakeSurface();
    atmosphere.withAtmosphere(surface);
    const nearStage = (surface.haze as unknown as { stage: unknown }).stage;

    atmosphere.withAtmosphere(surface, { beyondRange: true });
    const farStage = (surface.haze as unknown as { stage: unknown }).stage;
    expect(farStage).not.toBe(nearStage);
    expect(surface.calls).toBe(3);

    atmosphere.withAtmosphere(surface, { beyondRange: true });
    expect(surface.calls).toBe(3);
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
    expect(atmosphere.backdrop.mesh.visible).toBeTrue();

    atmosphere.enabled = false;
    atmosphere.update(renderer, camera);
    expect(atmosphere.backdrop.mesh.visible).toBeFalse();

    atmosphere.enabled = true;
    atmosphere.sky = false;
    atmosphere.update(renderer, camera);
    expect(atmosphere.backdrop.mesh.visible).toBeFalse();
    atmosphere.dispose();
  });

  it('gives the backdrop its shell, so a non-owner in space draws only its bounds and a far one not at all', async () => {
    const renderer = await getEvalRenderer();
    const planet = new Object3D();
    const atmosphere = smallAtmosphere({ planet, backdrop: { steps: 4, spaceScale: 0, ownsSky: false } });
    const camera = new PerspectiveCamera(50, 1, 0.1, 100_000);
    const top = atmosphere.model.uTopAltitude.value as number;
    const shellRadius = 1 + top / RADIUS_M;

    camera.position.set(0, 0, 20);
    camera.lookAt(0, 0, 0);
    atmosphere.update(renderer, camera);
    expect(atmosphere.backdrop.coverage).toBe('bounded');
    expect(atmosphere.backdrop.apparentAngularRadius).toBeCloseTo(Math.asin(shellRadius / 20), 6);
    expect(atmosphere.backdrop.mesh.visible).toBeTrue();
    expect(atmosphere.backdrop.objectAir.value).toBe(1);

    camera.position.set(0, 0, 5000);
    camera.lookAt(0, 0, 0);
    atmosphere.update(renderer, camera);
    expect(atmosphere.backdrop.coverage).toBe('culled');
    expect(atmosphere.backdrop.mesh.visible).toBeFalse();
    expect(atmosphere.backdrop.objectAir.value).toBe(0);

    // The next frame brings it back from the planet's own scale and position.
    planet.position.set(0, 0, 4900);
    planet.scale.setScalar(50);
    atmosphere.update(renderer, camera);
    expect(atmosphere.backdrop.coverage).toBe('bounded');
    expect(atmosphere.backdrop.mesh.visible).toBeTrue();
    atmosphere.dispose();
  });

  it('keeps a default atmosphere the full-screen sky owner', async () => {
    const renderer = await getEvalRenderer();
    const atmosphere = smallAtmosphere();
    const camera = new PerspectiveCamera(50, 1, 0.1, 100_000);
    camera.position.set(0, 0, 5000);
    camera.lookAt(0, 0, 0);
    atmosphere.update(renderer, camera);
    expect(atmosphere.backdrop.ownsSky).toBeTrue();
    expect(atmosphere.backdrop.coverage).toBe('full');
    expect(atmosphere.backdrop.mesh.visible).toBeTrue();
    atmosphere.dispose();
  });
});

describe('skyShellFade: the unbent sky shell leaves as the planet unrolls', () => {
  const TOP = 100_000;
  it('keeps the sky on the globe, and near the ground whatever the morph', () => {
    expect(skyShellFade(0, 10 * TOP, TOP)).toBe(0);
    expect(skyShellFade(1, 0, TOP)).toBe(0);
    expect(skyShellFade(1, TOP, TOP)).toBe(0);
  });

  it('from orbit (4 air heights) no ghost globe is left once a third of the way to the map, at 0.5 and above', () => {
    for (const morph of [0.35, 0.5, 0.85, 1]) expect(skyShellFade(morph, 4 * TOP, TOP)).toBe(1);
    // The old curve left half the shell at morph 0.5.
    expect(skyShellFade(0.17, 4 * TOP, TOP)).toBeGreaterThan(0);
    expect(skyShellFade(0.17, 4 * TOP, TOP)).toBeLessThan(1);
  });

  it('is monotonic in the morph and in the height', () => {
    let last = -1;
    for (let m = 0; m <= 1; m += 0.05) {
      const f = skyShellFade(m, 3 * TOP, TOP);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
    last = -1;
    for (let h = 0; h <= 6; h += 0.25) {
      const f = skyShellFade(0.5, h * TOP, TOP);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
  });
});
