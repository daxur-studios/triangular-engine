import { MeshStandardMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { EngineCSM } from './engine-csm';

describe('EngineCSM', () => {
  let scene: Scene;
  let camera: PerspectiveCamera;
  let csm: EngineCSM;

  beforeEach(() => {
    scene = new Scene();
    camera = new PerspectiveCamera(60, 1, 0.1, 1000);
    csm = new EngineCSM({
      camera,
      parent: scene,
      cascades: 3,
      maxFar: 400,
      lightDirection: new Vector3(1, -1, 1).normalize(),
    });
  });

  afterEach(() => {
    csm.remove();
    csm.dispose();
  });

  it('composes with existing material onBeforeCompile hooks without overwriting them', () => {
    const material = new MeshStandardMaterial();
    let originalHookRan = false;

    // Simulate an existing vertex/wind animation hook
    material.onBeforeCompile = (shader: any) => {
      originalHookRan = true;
      shader.vertexShader = '// custom header\n' + (shader.vertexShader || '');
    };

    csm.setupMaterial(material);

    expect(material.defines?.['USE_CSM']).toBe(1);
    expect(material.defines?.['CSM_CASCADES']).toBe(3);

    // Invoke compiled shader hook
    const fakeShader: any = {
      vertexShader: 'void main() {}',
      fragmentShader: 'void main() {}',
      uniforms: {},
    };

    material.onBeforeCompile(fakeShader, {} as any);

    // Both the original hook and the CSM uniforms must be set
    expect(originalHookRan).toBe(true);
    expect(fakeShader.vertexShader).toContain('// custom header');
    expect(fakeShader.uniforms.CSM_cascades).toBeDefined();
    expect(fakeShader.uniforms.cameraNear).toBeDefined();
    expect(fakeShader.uniforms.shadowFar).toBeDefined();
  });

  it('maintains ref-counting when multiple meshes share the same material and unregisters safely', () => {
    const material = new MeshStandardMaterial();
    let originalHookRan = false;
    const originalHook = () => {
      originalHookRan = true;
    };
    material.onBeforeCompile = originalHook;

    // Setup for 2 referencing meshes
    csm.setupMaterial(material);
    csm.setupMaterial(material);

    expect(material.defines?.['USE_CSM']).toBe(1);

    // Unregister first reference: should remain registered
    csm.unregisterMaterial(material);
    expect(material.defines?.['USE_CSM']).toBe(1);

    // Unregister second reference: should cleanly restore original hook
    csm.unregisterMaterial(material);
    expect(material.defines?.['USE_CSM']).toBeUndefined();
    expect(material.onBeforeCompile).toBe(originalHook);
  });

  it('restores all material hooks when disposed', () => {
    const material = new MeshStandardMaterial();
    const originalHook = () => {};
    material.onBeforeCompile = originalHook;

    csm.setupMaterial(material);
    expect(material.defines?.['USE_CSM']).toBe(1);

    csm.dispose();

    expect(material.defines?.['USE_CSM']).toBeUndefined();
    expect(material.onBeforeCompile).toBe(originalHook);
  });
});
