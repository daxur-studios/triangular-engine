import {
  DoubleSide,
  FrontSide,
  IUniform,
  MeshStandardMaterial,
  MeshStandardMaterialParameters,
  Vector3,
} from 'three';

export interface IDynamicProjectionUniforms {
  uMorph: IUniform<number>;
  uProjForward: IUniform<Vector3>;
  uProjUp: IUniform<Vector3>;
  uProjRight: IUniform<Vector3>;
  uProjMode: IUniform<number>; // 0 = static, 1 = dynamic basis
  uMapWidth: IUniform<number>;
  uMapHeight: IUniform<number>;
  uRadius: IUniform<number>;
  uProjectionType: IUniform<number>; // 0 = equirectangular, 1 = equalEarth
}

export function createPlanetMorphMaterial(
  parameters: MeshStandardMaterialParameters = {},
  uniformHolder?: Partial<IDynamicProjectionUniforms>,
): { material: MeshStandardMaterial; uniforms: IDynamicProjectionUniforms } {
  const uniforms: IDynamicProjectionUniforms = {
    uMorph: uniformHolder?.uMorph ?? { value: 0 },
    uProjForward: uniformHolder?.uProjForward ?? { value: new Vector3(0, 0, 1) },
    uProjUp: uniformHolder?.uProjUp ?? { value: new Vector3(0, 1, 0) },
    uProjRight: uniformHolder?.uProjRight ?? { value: new Vector3(1, 0, 0) },
    uProjMode: uniformHolder?.uProjMode ?? { value: 0 },
    uMapWidth: uniformHolder?.uMapWidth ?? { value: 12.56637 },
    uMapHeight: uniformHolder?.uMapHeight ?? { value: 6.28318 },
    uRadius: uniformHolder?.uRadius ?? { value: 2.0 },
    uProjectionType: uniformHolder?.uProjectionType ?? { value: 1 },
  };

  const material = new MeshStandardMaterial({
    roughness: 0.9,
    metalness: 0.05,
    flatShading: false,
    side: FrontSide,
    ...parameters,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms['uMorph'] = uniforms.uMorph;
    shader.uniforms['uProjForward'] = uniforms.uProjForward;
    shader.uniforms['uProjUp'] = uniforms.uProjUp;
    shader.uniforms['uProjRight'] = uniforms.uProjRight;
    shader.uniforms['uProjMode'] = uniforms.uProjMode;
    shader.uniforms['uMapWidth'] = uniforms.uMapWidth;
    shader.uniforms['uMapHeight'] = uniforms.uMapHeight;
    shader.uniforms['uRadius'] = uniforms.uRadius;
    shader.uniforms['uProjectionType'] = uniforms.uProjectionType;

    shader.vertexShader = `
      attribute vec3 aSpherePos;
      attribute vec3 aFlatPos;
      attribute vec3 aSphereNorm;
      attribute vec3 aFlatNorm;

      uniform float uMorph;
      uniform vec3 uProjForward;
      uniform vec3 uProjUp;
      uniform vec3 uProjRight;
      uniform float uProjMode;
      uniform float uMapWidth;
      uniform float uMapHeight;
      uniform float uRadius;
      uniform float uProjectionType;

      varying float vProjLon;
      varying float vProjMode;
      varying float vMorph;
    ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `
      vec3 dynSphereNorm = aSphereNorm;
      vec3 dynFlatNorm = aFlatNorm;

      if (uProjMode > 0.5) {
        dynFlatNorm = vec3(0.0, 0.0, 1.0);
      }

      vec3 morphedNormal = normalize(mix(dynSphereNorm, dynFlatNorm, uMorph));
      vec3 objectNormal = morphedNormal;
      #ifdef USE_TANGENT
        vec3 objectTangent = vec3( tangent.xyz );
      #endif
      `,
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      vec3 dynSpherePos = aSpherePos;
      vec3 dynFlatPos = aFlatPos;

      if (uProjMode > 0.5) {
        vec3 dir = aSphereNorm;
        float dotFwd = dot(dir, uProjForward);
        float dotRight = dot(dir, uProjRight);
        float dotUp = dot(dir, uProjUp);

        float pLon = atan(dotRight, dotFwd);
        float pLat = asin(clamp(dotUp, -1.0, 1.0));

        vProjLon = pLon;
        vProjMode = 1.0;

        float flatX = 0.0;
        float flatY = 0.0;

        if (uProjectionType < 0.5) {
          // Equirectangular
          flatX = (pLon / 3.141592653589793) * (uMapWidth * 0.5);
          flatY = (pLat / 1.5707963267948966) * (uMapHeight * 0.5);
        } else {
          // Equal Earth
          float EE_M = 0.8660254037844386;
          float EE_A1 = 1.340264;
          float EE_A2 = -0.081106;
          float EE_A3 = 0.000893;
          float EE_A4 = 0.003796;
          float EE_RAW_X_MAX = 2.7066299836960748;

          float theta = asin(clamp(EE_M * sin(pLat), -1.0, 1.0));
          float theta2 = theta * theta;
          float theta6 = theta2 * theta2 * theta2;
          float rawX = (pLon * cos(theta)) / (EE_M * (EE_A1 + 3.0 * EE_A2 * theta2 + theta6 * (7.0 * EE_A3 + 9.0 * EE_A4 * theta2)));
          float rawY = theta * (EE_A1 + EE_A2 * theta2 + theta6 * (EE_A3 + EE_A4 * theta2));

          float scale = uMapWidth / (2.0 * EE_RAW_X_MAX);
          flatX = rawX * scale;
          flatY = rawY * scale;
        }

        dynFlatPos = vec3(flatX, flatY, aFlatPos.z);
      } else {
        vProjLon = 0.0;
        vProjMode = 0.0;
      }

      vMorph = uMorph;
      vec3 transformed = mix(dynSpherePos, dynFlatPos, uMorph);
      `,
    );

    // Fragment shader: discard seam-spanning triangles when unrolled
    shader.fragmentShader = `
      varying float vProjLon;
      varying float vProjMode;
      varying float vMorph;
    ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `
      #include <dithering_fragment>
      if (vProjMode > 0.5 && vMorph > 0.05 && fwidth(vProjLon) > 2.8) {
        discard;
      }
      `,
    );
  };

  return { material, uniforms };
}

