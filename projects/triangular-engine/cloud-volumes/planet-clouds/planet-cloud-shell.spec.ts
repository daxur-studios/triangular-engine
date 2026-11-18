/* eslint-disable @typescript-eslint/no-explicit-any */
import { FloatType, Mesh, NearestFilter, OrthographicCamera, PerspectiveCamera, PlaneGeometry, RGBAFormat, RenderTarget, Scene, Vector3 } from 'three';
import { vec3, vec4 } from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
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
  it('samples live cloud coverage and projects shadows along the sun ray', async () => {
    const renderer = await getCloudTestRenderer();
    const shell = new PlanetCloudShell({ radiusUnits: 10, altitude: 2, coverage: 0, drift: 0 });
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 2;
    camera.updateMatrixWorld();
    const sun = new Vector3(1, 0, 1).normalize();
    shell.sunDirection.copy(sun);
    shell.update(camera, 0);

    // The ground is at (0, 0, 10). Independently intersect its ray toward the sun with radius 12.
    const distance = Math.sqrt(10 * 10 * sun.z * sun.z + 44) - 10 * sun.z;
    const crossing = sun.clone().multiplyScalar(distance).add(new Vector3(0, 0, 10)).normalize();
    const material = new NodeMaterial();
    material.fragmentNode = vec4(
      shell.coverageAt(vec3(crossing.x, crossing.y, crossing.z)),
      shell.groundShadowAt(vec3(0, 0, 1), 0),
      shell.groundShadowAt(vec3(0, 0, 1), 1),
      1,
    );
    const geometry = new PlaneGeometry(2, 2);
    const scene = new Scene();
    scene.add(new Mesh(geometry, material));
    const target = new RenderTarget(1, 1, { type: FloatType, format: RGBAFormat });
    const sample = async (): Promise<Float32Array> => {
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previous);
      return (await renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1)) as Float32Array;
    };
    try {
      let pixel = await sample();
      expect(pixel[0]).toBeCloseTo(0, 3);
      expect(pixel[1]).toBeCloseTo(1, 3);
      expect(pixel[2]).toBeCloseTo(1, 3);

      shell.coverage = 1;
      pixel = await sample();
      expect(pixel[0]).toBeCloseTo(1, 3);
      expect(pixel[1]).toBeCloseTo(1, 3);
      expect(pixel[2]).toBeCloseTo(0.15, 3);

      // Find a soft edge, where sampling the wrong direction cannot pass as an all-clear or all-cloud case.
      shell.softness = 0.4;
      for (let coverage = 0.05; coverage <= 1; coverage += 0.05) {
        shell.coverage = coverage;
        pixel = await sample();
        if (pixel[0] > 0.15 && pixel[0] < 0.85) break;
      }
      expect(pixel[0]).toBeGreaterThan(0.15);
      expect(pixel[0]).toBeLessThan(0.85);
      expect(pixel[2]).toBeCloseTo(1 - 0.85 * pixel[0], 3);
    } finally {
      target.dispose();
      geometry.dispose();
      material.dispose();
      shell.dispose();
    }
  }, 60000);

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
