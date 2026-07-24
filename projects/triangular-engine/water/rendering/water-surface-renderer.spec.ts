import {
  NearestFilter,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Vector3,
} from 'three';
import {
  CylinderWaterDomain,
  PlaneWaterDomain,
  SphereWaterDomain,
} from '../core/water-domain';
import {
  WATER_RENDER_PRESETS,
  resolveWaterRenderPreset,
} from './water-render-preset';
import { WaterSurfaceRenderer } from './water-surface-renderer';

describe('WaterSurfaceRenderer', () => {
  it('builds one shared LOD renderer for every water domain', () => {
    const domains = [
      new PlaneWaterDomain(),
      new SphereWaterDomain(500),
      new CylinderWaterDomain(500, { axis: new Vector3(1, 0, 0) }),
    ];

    for (const domain of domains) {
      const renderer = new WaterSurfaceRenderer({
        domain,
        preset: WATER_RENDER_PRESETS.performance,
      });
      expect(renderer.meshes.length).toBeGreaterThanOrEqual(
        WATER_RENDER_PRESETS.performance.grid.ringCount + 1,
      );
      const material = renderer.meshes[0].material as ShaderMaterial;
      expect(material.vertexShader).toContain('waterComposeWorldPosition');
      expect(material.fragmentShader).toContain(
        'waterComposeWorldNormal(localNormal, vLocalXZ)',
      );
      expect(material.fragmentShader).toContain(
        'waterDomainClip(vWorldPosition, vLocalXZ)',
      );
      renderer.dispose();
    }
  });

  it('builds a complete finite cylinder while its LOD follows the camera', () => {
    const domain = new CylinderWaterDomain(500, {
      axis: new Vector3(1, 0, 0),
      lengthM: 1_000,
    });
    const renderer = new WaterSurfaceRenderer({
      domain,
      preset: WATER_RENDER_PRESETS.performance,
    });
    const camera = new PerspectiveCamera();

    // Performance normally has four rings; this cylinder needs seven so a
    // camera-centred grid still reaches the opposite side of the full wrap.
    expect(renderer.meshes.length).toBe(8);
    camera.position.set(0, 0, 100);
    renderer.update(camera, 0);
    const firstMatrix = renderer.meshes[0].instanceMatrix.array.slice();
    const material = renderer.meshes[0].material as ShaderMaterial;
    expect(material.uniforms['uLodCameraXZ'].value.toArray()).toEqual([0, 0]);

    camera.position.set(4_000, -3_000, -2_000);
    renderer.update(camera, 1);
    expect(renderer.meshes[0].instanceMatrix.array).not.toEqual(firstMatrix);
    expect(material.uniforms['uLodCameraXZ'].value.x).toBe(500);
    expect(material.uniforms['uLodCameraXZ'].value.y).not.toBe(0);

    expect(material.uniforms['uCylinderHalfLength'].value).toBe(500);
    expect(material.uniforms['uLodPeriodZ'].value).toBeCloseTo(
      2 * Math.PI * 500,
    );
    renderer.dispose();
  });

  it('updates instances, attaches to a scene, and rebuilds for a new tier', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    camera.position.set(25, 10, -40);
    const renderer = new WaterSurfaceRenderer({
      domain: new PlaneWaterDomain(),
      preset: WATER_RENDER_PRESETS.performance,
    });

    renderer.addTo(scene);
    renderer.update(camera, 1.25);
    expect(renderer.meshes[0].parent).toBe(scene);
    expect(renderer.meshes[0].count).toBeGreaterThan(0);

    renderer.setPreset(WATER_RENDER_PRESETS.balanced);
    expect(renderer.meshes.length).toBe(
      WATER_RENDER_PRESETS.balanced.grid.ringCount + 1,
    );
    const material = renderer.meshes[0].material as ShaderMaterial;
    expect(material.defines['WATER_GERSTNER']).toBe(1);
    expect(renderer.meshes[0].parent).toBe(scene);
    renderer.dispose();
  });

  it('quantizes renderer time only when the stylize preset asks for it', () => {
    const renderer = new WaterSurfaceRenderer({
      domain: new PlaneWaterDomain(),
      preset: resolveWaterRenderPreset(WATER_RENDER_PRESETS.performance, {
        stylize: { colorSteps: 6, timeQuantizeHz: 8, normalMapSize: 32 },
      }),
    });
    const camera = new PerspectiveCamera();
    renderer.update(camera, 1.234);

    const material = renderer.meshes[0].material as ShaderMaterial;
    expect(material.uniforms['uTime'].value).toBe(1.125);
    expect(material.defines['WATER_STYLIZE']).toBe(1);
    expect(material.defines['WATER_DETAIL_NORMALS']).toBe(1);
    expect(material.uniforms['uDetailNormalMap'].value.magFilter).toBe(
      NearestFilter,
    );
    renderer.dispose();
  });

  it('enables cascades for balanced and far glint only for cinematic', () => {
    const renderer = new WaterSurfaceRenderer({
      domain: new PlaneWaterDomain(),
      preset: WATER_RENDER_PRESETS.balanced,
    });
    let material = renderer.meshes[0].material as ShaderMaterial;
    expect(material.defines['WATER_DETAIL_CASCADES']).toBe(1);
    expect(material.defines['WATER_GLINT']).toBeUndefined();

    renderer.setPreset(WATER_RENDER_PRESETS.cinematic);
    material = renderer.meshes[0].material as ShaderMaterial;
    expect(material.defines['WATER_GLINT']).toBe(1);
    expect(material.uniforms['uGlintStrength'].value).toBe(0.8);
    renderer.dispose();
  });
});
