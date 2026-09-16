import { DoubleSide, FrontSide, IUniform, MeshStandardMaterial, MeshStandardMaterialParameters } from 'three';

export interface IMorphUniformHolder {
  uMorph: IUniform<number>;
}

export function createPlanetMorphMaterial(
  parameters: MeshStandardMaterialParameters = {},
  uniformHolder?: IMorphUniformHolder,
): { material: MeshStandardMaterial; morphUniform: IUniform<number> } {
  const morphUniform: IUniform<number> = uniformHolder?.uMorph ?? { value: 0 };

  const material = new MeshStandardMaterial({
    roughness: 0.9,
    metalness: 0.05,
    flatShading: false,
    side: FrontSide,
    ...parameters,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms['uMorph'] = morphUniform;

    shader.vertexShader = `
      attribute vec3 aSpherePos;
      attribute vec3 aFlatPos;
      attribute vec3 aSphereNorm;
      attribute vec3 aFlatNorm;
      uniform float uMorph;
    ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `
      vec3 morphedNormal = normalize(mix(aSphereNorm, aFlatNorm, uMorph));
      vec3 objectNormal = morphedNormal;
      #ifdef USE_TANGENT
        vec3 objectTangent = vec3( tangent.xyz );
      #endif
      `,
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      vec3 transformed = mix(aSpherePos, aFlatPos, uMorph);
      `,
    );
  };

  return { material, morphUniform };
}
