import { MeshStandardMaterial, WebGLProgramParametersWithUniforms } from 'three';
import {
  TERRAIN_MACRO_VARIATION_GLSL,
  createDefaultTerrainMacroVariationUniforms,
  enableTerrainMacroVariation,
} from './terrain-macro-variation-material';

function fakeShader(): WebGLProgramParametersWithUniforms {
  return {
    uniforms: {},
    vertexShader:
      '#include <common>\nvoid main() {\n#include <begin_vertex>\n#include <project_vertex>\n}',
    fragmentShader:
      '#include <common>\nvoid main() {\n#include <color_fragment>\n}',
  } as unknown as WebGLProgramParametersWithUniforms;
}

function compile(
  material: MeshStandardMaterial,
): WebGLProgramParametersWithUniforms {
  const shader = fakeShader();
  material.onBeforeCompile(shader, {} as never);
  return shader;
}

describe('terrain macro variation material', () => {
  it('chains a pre-existing onBeforeCompile without overwriting it', () => {
    const material = new MeshStandardMaterial();
    let previousCalled = false;
    material.onBeforeCompile = (shader) => {
      previousCalled = true;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        '#include <common>\n// PREVIOUS_PATCH',
      );
    };

    enableTerrainMacroVariation(
      material,
      createDefaultTerrainMacroVariationUniforms(),
    );
    const shader = compile(material);

    expect(previousCalled).toBe(true);
    expect(shader.fragmentShader).toContain('// PREVIOUS_PATCH');
    expect(shader.fragmentShader).toContain('terrainMacroApply');
    expect(shader.vertexShader).toContain('vTerrainMacroPositionM');
  });

  it('appends a distinct cache key that preserves the previous one', () => {
    const material = new MeshStandardMaterial();
    material.customProgramCacheKey = () => 'previous-key';

    enableTerrainMacroVariation(
      material,
      createDefaultTerrainMacroVariationUniforms(),
    );
    const after = material.customProgramCacheKey();

    expect(after).not.toBe('previous-key');
    expect(after).toContain('previous-key');
    expect(after).toContain('terrainMacroVariation');
  });

  it('samples the morph-stable position through the batch/instance matrices', () => {
    const material = new MeshStandardMaterial();
    enableTerrainMacroVariation(
      material,
      createDefaultTerrainMacroVariationUniforms(),
    );
    const shader = compile(material);

    expect(shader.vertexShader).toContain('vec4 terrainMacroLocal = vec4(position, 1.0);');
    expect(shader.vertexShader).toContain('batchingMatrix * terrainMacroLocal');
    expect(shader.vertexShader).toContain('instanceMatrix * terrainMacroLocal');
    expect(shader.uniforms['uTerrainMacroEnabled']).toBeDefined();
    expect(shader.uniforms['uTerrainMacroStrength']).toBeDefined();
    expect(shader.uniforms['uTerrainMacroScaleM']).toBeDefined();
  });

  it('samples the post-morph transformed value in viewM mode', () => {
    const material = new MeshStandardMaterial();
    enableTerrainMacroVariation(
      material,
      createDefaultTerrainMacroVariationUniforms(),
      { positionSpace: 'viewM' },
    );

    expect(compile(material).vertexShader).toContain(
      'vec4 terrainMacroLocal = vec4(transformed, 1.0);',
    );
  });

  it('reads the land mask from the attribute by default and from a uniform when null', () => {
    const attributeMaterial = new MeshStandardMaterial();
    enableTerrainMacroVariation(
      attributeMaterial,
      createDefaultTerrainMacroVariationUniforms(),
    );
    const attributeShader = compile(attributeMaterial);
    expect(attributeShader.vertexShader).toContain(
      'attribute float terrainMacroLandFactor;',
    );
    expect(attributeShader.fragmentShader).not.toContain(
      'uniform float uTerrainMacroLandFactor;',
    );

    const uniformMaterial = new MeshStandardMaterial();
    const landMaskUniform = { value: 1 };
    enableTerrainMacroVariation(
      uniformMaterial,
      createDefaultTerrainMacroVariationUniforms(),
      { landMaskAttribute: null, landMaskUniform },
    );
    const uniformShader = compile(uniformMaterial);
    expect(uniformShader.vertexShader).not.toContain(
      'attribute float terrainMacroLandFactor;',
    );
    expect(uniformShader.fragmentShader).toContain(
      'uniform float uTerrainMacroLandFactor;',
    );
    expect(uniformShader.uniforms['uTerrainMacroLandFactor']).toBe(
      landMaskUniform,
    );
  });

  it('composes with a patch that already consumed begin_vertex (morph order)', () => {
    const material = new MeshStandardMaterial();
    // A morph-like patch that replaces begin_vertex and leaves no literal behind.
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        'vec3 transformed = mix(aSpherePos, aFlatPos, uMorph);',
      );
    };

    enableTerrainMacroVariation(
      material,
      createDefaultTerrainMacroVariationUniforms(),
    );
    const shader = compile(material);

    expect(shader.vertexShader).toContain(
      'vec3 transformed = mix(aSpherePos, aFlatPos, uMorph);',
    );
    expect(shader.vertexShader).toContain('vTerrainMacroPositionM = (modelMatrix');
    expect(shader.fragmentShader).toContain('terrainMacroApply');
  });

  it('keeps the GLSL byte-consistent with the CPU macro sampler', () => {
    expect(TERRAIN_MACRO_VARIATION_GLSL).toContain('17.3, -9.1, 4.7');
    expect(TERRAIN_MACRO_VARIATION_GLSL).toContain(
      'return terrainMacroValueNoise3(broad);',
    );
    expect(TERRAIN_MACRO_VARIATION_GLSL).toContain('vec3(0.12, 0.09, 0.055)');
    expect(TERRAIN_MACRO_VARIATION_GLSL).toContain(
      'clamp(strength, 0.0, 1.0) * clamp(landFactor, 0.0, 1.0)',
    );
  });
});
