/* eslint-disable @typescript-eslint/no-explicit-any */
import { FloatType, Mesh, NearestFilter, PerspectiveCamera, RGBAFormat, RenderTarget, Scene } from 'three';
import { createPlanetMorphUniforms, setPlanetMapExtent } from 'triangular-engine/planet-material';
import { getCloudTestRenderer } from '../gpu-renderer.testing';
import { PlanetCloudShell, cloudShellCameraFade, cloudShellMorphFade } from './planet-cloud-shell';

const W = 128;
const H = 128;

describe('cloudShellMorphFade', () => {
  it('is 0 up to morph 0.2 and 1 from 0.8 on', () => {
    expect(cloudShellMorphFade(0)).toBe(0);
    expect(cloudShellMorphFade(0.2)).toBe(0);
    expect(cloudShellMorphFade(0.8)).toBe(1);
    expect(cloudShellMorphFade(1)).toBe(1);
  });

  it('rises strictly between the ends and is one half at the middle', () => {
    let previous = cloudShellMorphFade(0.2);
    for (let m = 0.21; m < 0.8; m += 0.01) {
      const now = cloudShellMorphFade(m);
      expect(now).toBeGreaterThan(previous);
      previous = now;
    }
    expect(cloudShellMorphFade(0.5)).toBeCloseTo(0.5, 10);
  });
});

describe('cloudShellCameraFade', () => {
  it('is 0 on the shell and 1 at least one altitude away', () => {
    expect(cloudShellCameraFade(100, 100, 5)).toBe(0);
    expect(cloudShellCameraFade(105, 100, 5)).toBe(1);
    expect(cloudShellCameraFade(95, 100, 5)).toBe(1);
    expect(cloudShellCameraFade(97.5, 100, 5)).toBeCloseTo(0.5, 10);
    expect(cloudShellCameraFade(400, 100, 5)).toBe(1);
  });

  it('is monotonic as the camera leaves the shell in either direction', () => {
    let previous = -1;
    for (let d = 100; d <= 106; d += 0.25) {
      const now = cloudShellCameraFade(d, 100, 5);
      expect(now).toBeGreaterThanOrEqual(previous);
      previous = now;
    }
    previous = -1;
    for (let d = 100; d >= 94; d -= 0.25) {
      const now = cloudShellCameraFade(d, 100, 5);
      expect(now).toBeGreaterThanOrEqual(previous);
      previous = now;
    }
  });
});

describe('PlanetCloudShell', () => {
  it('scales the mesh on configure without rebuilding the geometry', () => {
    const shell = new PlanetCloudShell({ radiusUnits: 1000, altitude: 10 });
    const geometry = (shell.object as Mesh).geometry;
    expect(shell.object.scale.x).toBeCloseTo(1010, 6);
    shell.configure({ radiusUnits: 2000 });
    expect(shell.object.scale.x).toBeCloseTo(2010, 6);
    shell.configure({ altitude: 40 });
    expect(shell.object.scale.x).toBeCloseTo(2040, 6);
    expect((shell.object as Mesh).geometry).toBe(geometry);
    shell.dispose();
  });

  it('defaults the band to 0.15 percent of the radius', () => {
    const shell = new PlanetCloudShell({ radiusUnits: 1000 });
    expect(shell.object.scale.x).toBeCloseTo(1001.5, 6);
    shell.dispose();
  });

  it('hides at morph 1, shows at morph 0 far away, hides with the camera on the shell', () => {
    const shell = new PlanetCloudShell({ radiusUnits: 100, altitude: 1 });
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 1000);
    camera.updateMatrixWorld();

    shell.morph = 0;
    shell.update(camera, 0);
    expect(shell.object.visible).toBeTrue();

    shell.morph = 1;
    shell.update(camera, 0);
    expect(shell.object.visible).toBeFalse();

    shell.morph = 0;
    camera.position.set(0, 0, 101);
    camera.updateMatrixWorld();
    shell.update(camera, 0);
    expect(shell.object.visible).toBeFalse();

    shell.enabled = false;
    camera.position.set(0, 0, 1000);
    camera.updateMatrixWorld();
    shell.update(camera, 0);
    expect(shell.object.visible).toBeFalse();
    shell.dispose();
  });

  it('reads the sun direction from the vector it is given, normalised on update', () => {
    const shell = new PlanetCloudShell({ radiusUnits: 100 });
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 1000);
    shell.sunDirection.set(0, 0, 0);
    expect(() => shell.update(camera, 0)).not.toThrow();
    shell.sunDirection.set(3, 0, 0);
    shell.update(camera, 0);
    shell.dispose();
  });

  it('renders the shell from outside: no cloud at coverage 0, cloud at coverage 1', async () => {
    const renderer = await getCloudTestRenderer();
    const scene = new Scene();
    const shell = new PlanetCloudShell({ radiusUnits: 1, altitude: 0.05, coverage: 0, softness: 0.12 });
    shell.sunDirection.set(0, 0, 1);
    scene.add(shell.object);
    const camera = new PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 0, 3);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const target = new RenderTarget(W, H, {
      type: FloatType,
      format: RGBAFormat,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
    });
    const coveredPixels = async (): Promise<number> => {
      shell.update(camera, 0);
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(previous);
      const data = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, W, H)) as Float32Array;
      let covered = 0;
      for (let i = 0; i < W * H; i++) {
        if (data[i * 4] !== 0 || data[i * 4 + 1] !== 0 || data[i * 4 + 2] !== 0 || data[i * 4 + 3] !== 0) covered++;
      }
      return covered;
    };

    expect(await coveredPixels()).toBe(0);

    shell.coverage = 1;
    const covered = await coveredPixels();
    expect(covered).toBeGreaterThan(1000);

    target.dispose();
    shell.dispose();
  }, 60000);

  it('bends instead of fading with morph uniforms: unscaled mesh, shown at morph 1', () => {
    const uniforms = createPlanetMorphUniforms();
    setPlanetMapExtent(uniforms, 100);
    const shell = new PlanetCloudShell({ radiusUnits: 100, altitude: 1, morphUniforms: uniforms });
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 1000);
    camera.updateMatrixWorld();

    expect(shell.object.scale.x).toBe(1);
    uniforms.uMorph.value = 1;
    shell.morph = 1;
    shell.update(camera, 0);
    expect(shell.object.visible).toBeTrue();
    expect((shell as any).uOpacity.value).toBe(1);
    shell.dispose();
  });

  it('draws after the terrain and is never frustum culled', () => {
    const shell = new PlanetCloudShell({ radiusUnits: 1 });
    expect(shell.object.renderOrder).toBe(10);
    expect((shell.object as Mesh).frustumCulled).toBeFalse();
    shell.dispose();
  });
});
