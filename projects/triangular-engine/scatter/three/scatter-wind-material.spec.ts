import { MeshStandardMaterial, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three';

import { enableScatterWindSway } from './scatter-wind-material';

function fakeShader(): WebGLProgramParametersWithUniforms {
  return {
    vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
    fragmentShader: 'void main() {}',
    uniforms: {},
  } as unknown as WebGLProgramParametersWithUniforms;
}

describe('enableScatterWindSway', () => {
  it('bakes strength/frequency into the vertex shader and guards on USE_INSTANCING', () => {
    const material = new MeshStandardMaterial();
    enableScatterWindSway(material, { strength: 0.2, frequency: 1.5 });

    const shader = fakeShader();
    material.onBeforeCompile(shader, {} as WebGLRenderer);

    expect(shader.vertexShader).toContain('uniform float scatterWindTimeS;');
    expect(shader.vertexShader).toContain('#ifdef USE_INSTANCING');
    expect(shader.vertexShader).toContain('0.200000');
    expect(shader.vertexShader).toContain('1.500000');
  });

  it('registers the time uniform and updates it via the returned handle', () => {
    const material = new MeshStandardMaterial();
    const handle = enableScatterWindSway(material, { strength: 0.1, frequency: 1 });

    const shader = fakeShader();
    material.onBeforeCompile(shader, {} as WebGLRenderer);
    expect(shader.uniforms['scatterWindTimeS'].value).toBe(0);

    handle.setTimeS(12.5);
    expect(shader.uniforms['scatterWindTimeS'].value).toBe(12.5);
  });

  it('composes with a previously assigned onBeforeCompile instead of replacing it', () => {
    const material = new MeshStandardMaterial();
    let previousCalled = false;
    material.onBeforeCompile = () => {
      previousCalled = true;
    };
    enableScatterWindSway(material, { strength: 0.1, frequency: 1 });

    material.onBeforeCompile(fakeShader(), {} as WebGLRenderer);
    expect(previousCalled).toBe(true);
  });
});
