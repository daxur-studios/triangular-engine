import { MeshBasicMaterial, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three';

import { enableScatterCylindricalBillboard } from './scatter-billboard-material';

function fakeShader(): WebGLProgramParametersWithUniforms {
  return {
    vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
    fragmentShader: 'void main() {}',
    uniforms: {},
  } as unknown as WebGLProgramParametersWithUniforms;
}

describe('enableScatterCylindricalBillboard', () => {
  it('declares the per-instance attributes and camera uniform on the vertex shader', () => {
    const material = new MeshBasicMaterial();
    enableScatterCylindricalBillboard(material);

    const shader = fakeShader();
    material.onBeforeCompile(shader, {} as WebGLRenderer);

    expect(shader.vertexShader).toContain('uniform vec3 scatterBillboardCameraWorldM;');
    expect(shader.vertexShader).toContain('attribute vec3 instanceOriginM;');
    expect(shader.vertexShader).toContain('attribute float instanceScale;');
    expect(shader.vertexShader).toContain('attribute vec3 instanceSurfaceUp;');
  });

  it('registers the camera uniform and updates it via the returned handle', () => {
    const material = new MeshBasicMaterial();
    const handle = enableScatterCylindricalBillboard(material);

    const shader = fakeShader();
    material.onBeforeCompile(shader, {} as WebGLRenderer);
    expect(shader.uniforms['scatterBillboardCameraWorldM'].value).toEqual([0, 0, 0]);

    handle.setCameraWorldM([1, 2, 3]);
    expect(shader.uniforms['scatterBillboardCameraWorldM'].value).toEqual([1, 2, 3]);
  });

  it('composes with a previously assigned onBeforeCompile instead of replacing it', () => {
    const material = new MeshBasicMaterial();
    let previousCalled = false;
    material.onBeforeCompile = () => {
      previousCalled = true;
    };
    enableScatterCylindricalBillboard(material);

    material.onBeforeCompile(fakeShader(), {} as WebGLRenderer);
    expect(previousCalled).toBe(true);
  });
});
