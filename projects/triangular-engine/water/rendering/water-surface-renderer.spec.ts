import { PerspectiveCamera, Scene, ShaderMaterial, Vector3 } from 'three';
import {
  CylinderWaterDomain,
  PlaneWaterDomain,
  SphereWaterDomain,
} from '../core/water-domain';
import { WATER_RENDER_PRESETS } from './water-render-preset';
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
      expect(renderer.meshes.length).toBe(
        WATER_RENDER_PRESETS.performance.grid.ringCount + 1,
      );
      const material = renderer.meshes[0].material as ShaderMaterial;
      expect(material.vertexShader).toContain('waterComposeWorldPosition');
      expect(material.fragmentShader).toContain('waterComposeWorldNormal');
      renderer.dispose();
    }
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
      preset: WATER_RENDER_PRESETS.pixel,
    });
    const camera = new PerspectiveCamera();
    renderer.update(camera, 1.234);

    const material = renderer.meshes[0].material as ShaderMaterial;
    expect(material.uniforms['uTime'].value).toBe(1.125);
    renderer.dispose();
  });
});
