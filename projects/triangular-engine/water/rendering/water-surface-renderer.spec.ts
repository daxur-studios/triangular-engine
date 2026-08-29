import {
  InstancedMesh,
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

  it('adds complete non-displaced far coverage only for a sphere', () => {
    const scene = new Scene();
    const sphereRenderer = new WaterSurfaceRenderer({
      domain: new SphereWaterDomain(600_000),
      preset: WATER_RENDER_PRESETS.balanced,
    });
    const planeRenderer = new WaterSurfaceRenderer({
      domain: new PlaneWaterDomain(),
      preset: WATER_RENDER_PRESETS.balanced,
    });

    sphereRenderer.addTo(scene);
    expect(sphereRenderer.farSurfaceMesh?.name).toBe(
      'water-planetary-far-surface',
    );
    expect(sphereRenderer.farSurfaceMesh?.parent).toBe(scene);
    expect(planeRenderer.farSurfaceMesh).toBeNull();

    sphereRenderer.dispose();
    planeRenderer.dispose();
  });

  it('automatically replaces geometric waves with the far sphere in orbit', () => {
    const radius = 600_000;
    const renderer = new WaterSurfaceRenderer({
      domain: new SphereWaterDomain(radius),
      preset: WATER_RENDER_PRESETS.balanced,
    });
    const camera = new PerspectiveCamera();
    const localMaterial = renderer.meshes[0].material as ShaderMaterial;

    camera.position.set(0, radius + 10, 0);
    renderer.update(camera, 1);
    expect(localMaterial.uniforms['uNearFieldOpacity'].value).toBe(1);
    expect(
      renderer.farSurfaceMesh?.material.uniforms['uNearFieldOpacity'].value,
    ).toBe(1);

    camera.position.set(0, radius * 2, 0);
    renderer.update(camera, 2);
    expect(localMaterial.uniforms['uNearFieldOpacity'].value).toBe(0);
    expect(
      renderer.farSurfaceMesh?.material.uniforms['uNearFieldOpacity'].value,
    ).toBe(0);
    renderer.dispose();
  });

  it('retains camera detail while selecting a second grid toward the visible horizon', () => {
    const radius = 600_000;
    const scene = new Scene();
    const renderer = new WaterSurfaceRenderer({
      domain: new SphereWaterDomain(radius),
      preset: WATER_RENDER_PRESETS.balanced,
    });
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 2_000_000);
    camera.position.set(0, radius + 10_000, 0);
    camera.lookAt(new Vector3(200_000, radius, 0));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    renderer.addTo(scene);
    renderer.update(camera, 1);

    expect(renderer.meshes.every((mesh) => mesh.count > 0)).toBeTrue();
    const viewMeshes = scene.children.filter(
      (child): child is InstancedMesh =>
        child instanceof InstancedMesh &&
        child.name.startsWith('water-view-lod-'),
    );
    expect(viewMeshes.length).toBe(renderer.meshes.length);
    expect(viewMeshes.every((mesh) => mesh.count > 0)).toBeTrue();
    expect(
      renderer.farSurfaceMesh?.material.uniforms['uViewFieldOpacity'].value,
    ).toBeGreaterThan(0);
    renderer.dispose();
  });

  it('partitions camera and view fields instead of drawing their overlap twice', () => {
    const renderer = new WaterSurfaceRenderer({
      domain: new PlaneWaterDomain(),
      preset: WATER_RENDER_PRESETS.balanced,
    });
    const material = renderer.meshes[0].material as ShaderMaterial;

    expect(material.fragmentShader).toContain('uSecondaryFieldActive');
    expect(material.fragmentShader).toContain('competingFieldDistance');
    expect(material.uniforms['uFieldRole'].value).toBe(0);
    // The renderer adds enough cheap coarse rings that the ordinary plane
    // view cannot expose the former 1 km square boundary.
    expect(renderer.meshes.length).toBeGreaterThan(
      WATER_RENDER_PRESETS.balanced.grid.ringCount + 1,
    );
    renderer.dispose();
  });

  it('keeps the spherical fallback behind detail and out of scene depth', () => {
    const renderer = new WaterSurfaceRenderer({
      domain: new SphereWaterDomain(600_000),
      preset: WATER_RENDER_PRESETS.balanced,
    });

    expect(renderer.farSurfaceMesh?.material.depthWrite).toBeFalse();
    expect(renderer.farSurfaceMesh!.renderOrder).toBeLessThan(
      renderer.meshes[0].renderOrder,
    );
    renderer.dispose();
  });

  it('tracks a mutable spherical centre for floating-origin scenes', () => {
    const radius = 500;
    const domain = new SphereWaterDomain(radius);
    const renderer = new WaterSurfaceRenderer({
      domain,
      preset: WATER_RENDER_PRESETS.performance,
    });
    const camera = new PerspectiveCamera();
    domain.center.set(100, 20, -50);
    camera.position.set(100, radius + 30, -50);
    renderer.update(camera, 0);

    expect(renderer.farSurfaceMesh?.position.toArray()).toEqual([100, 20, -50]);
    const material = renderer.meshes[0].material as ShaderMaterial;
    expect(material.uniforms['uSphereCenter'].value.toArray()).toEqual([
      100, 20, -50,
    ]);
    renderer.dispose();
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
