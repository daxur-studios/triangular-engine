import {
  Color,
  DoubleSide,
  FrontSide,
  IUniform,
  MeshStandardMaterial,
  MeshStandardMaterialParameters,
  ShaderMaterial,
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
    uProjForward: uniformHolder?.uProjForward ?? {
      value: new Vector3(0, 0, 1),
    },
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

    shader.vertexShader =
      `
      attribute vec3 aSpherePos;
      attribute vec3 aFlatPos;
      attribute vec3 aSphereNorm;
      attribute vec3 aFlatNorm;
      attribute vec3 aOtherDir1;
      attribute vec3 aOtherDir2;

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
      varying float vSeamCull;
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
      float seamCull = 0.0;

      if (uProjMode > 0.5) {
        vec3 dir = aSphereNorm;
        float dotFwd = dot(dir, uProjForward);
        float dotRight = dot(dir, uProjRight);
        float dotUp = dot(dir, uProjUp);

        float pLon = atan(dotRight, dotFwd);
        float pLat = asin(clamp(dotUp, -1.0, 1.0));

        if (length(aOtherDir1) > 0.001 && length(aOtherDir2) > 0.001) {
          float oFwd1 = dot(aOtherDir1, uProjForward);
          float oRight1 = dot(aOtherDir1, uProjRight);
          float oLon1 = atan(oRight1, oFwd1);

          float oFwd2 = dot(aOtherDir2, uProjForward);
          float oRight2 = dot(aOtherDir2, uProjRight);
          float oLon2 = atan(oRight2, oFwd2);

          if (abs(pLon - oLon1) > 3.14159265 ||
              abs(pLon - oLon2) > 3.14159265 ||
              abs(oLon1 - oLon2) > 3.14159265) {
            seamCull = 1.0;
          }
        }

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
      vSeamCull = seamCull;
      vec3 transformed = mix(dynSpherePos, dynFlatPos, uMorph);
      `,
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <fog_vertex>',
      `
      #include <fog_vertex>
      if (uProjMode > 0.5 && uMorph > 0.05 && seamCull > 0.5) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }
      `,
    );

    // Fragment shader: discard seam-spanning triangles when unrolled
    shader.fragmentShader =
      `
      varying float vProjLon;
      varying float vProjMode;
      varying float vMorph;
      varying float vSeamCull;
    ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `
      #include <dithering_fragment>
      if (vProjMode > 0.5 && vMorph > 0.05 && (vSeamCull > 0.5 || fwidth(vProjLon) > 2.8)) {
        discard;
      }
      `,
    );
  };

  return { material, uniforms };
}

export function createPlanetBorderMorphMaterial(
  uniformHolder: IDynamicProjectionUniforms,
  options: {
    color?: string | Color;
    opacity?: number;
    ribbonWidth?: number;
  } = {},
): ShaderMaterial {
  const color =
    options.color instanceof Color
      ? options.color
      : new Color(options.color ?? '#ffffff');
  const opacity = options.opacity ?? 0.6;
  const ribbonWidth = options.ribbonWidth ?? 0;

  return new ShaderMaterial({
    uniforms: {
      uMorph: uniformHolder.uMorph,
      uProjForward: uniformHolder.uProjForward,
      uProjUp: uniformHolder.uProjUp,
      uProjRight: uniformHolder.uProjRight,
      uProjMode: uniformHolder.uProjMode,
      uMapWidth: uniformHolder.uMapWidth,
      uMapHeight: uniformHolder.uMapHeight,
      uRadius: uniformHolder.uRadius,
      uProjectionType: uniformHolder.uProjectionType,
      uRibbonWidth: { value: ribbonWidth },
      uColor: { value: color },
      uOpacity: { value: opacity },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>

      attribute vec3 aSpherePos;
      attribute vec3 aFlatPos;
      attribute vec3 aSphereNorm;
      attribute vec3 aFlatNorm;
      attribute vec3 aOtherDir;

      uniform float uMorph;
      uniform vec3 uProjForward;
      uniform vec3 uProjUp;
      uniform vec3 uProjRight;
      uniform float uProjMode;
      uniform float uMapWidth;
      uniform float uMapHeight;
      uniform float uRadius;
      uniform float uProjectionType;
      uniform float uRibbonWidth;

      varying float vProjLon;
      varying float vProjMode;
      varying float vMorph;

      void main() {
        vec3 dynSpherePos = aSpherePos;
        vec3 dynFlatPos = aFlatPos;

        if (uProjMode > 0.5) {
          vec3 dir = aSphereNorm;
          float dotFwd = dot(dir, uProjForward);
          float dotRight = dot(dir, uProjRight);
          float dotUp = dot(dir, uProjUp);

          float pLon = atan(dotRight, dotFwd);
          float pLat = asin(clamp(dotUp, -1.0, 1.0));

          float oFwd = dot(aOtherDir, uProjForward);
          float oRight = dot(aOtherDir, uProjRight);
          float oLon = atan(oRight, oFwd);

          if (uMorph > 0.05 && abs(pLon - oLon) > 3.14159) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }

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

          if (uRibbonWidth > 0.0001) {
            float oUp = dot(aOtherDir, uProjUp);
            float oLat = asin(clamp(oUp, -1.0, 1.0));

            float oFlatX = 0.0;
            float oFlatY = 0.0;

            if (uProjectionType < 0.5) {
              oFlatX = (oLon / 3.141592653589793) * (uMapWidth * 0.5);
              oFlatY = (oLat / 1.5707963267948966) * (uMapHeight * 0.5);
            } else {
              float EE_M = 0.8660254037844386;
              float EE_A1 = 1.340264;
              float EE_A2 = -0.081106;
              float EE_A3 = 0.000893;
              float EE_A4 = 0.003796;
              float EE_RAW_X_MAX = 2.7066299836960748;

              float theta = asin(clamp(EE_M * sin(oLat), -1.0, 1.0));
              float theta2 = theta * theta;
              float theta6 = theta2 * theta2 * theta2;
              float rawX = (oLon * cos(theta)) / (EE_M * (EE_A1 + 3.0 * EE_A2 * theta2 + theta6 * (7.0 * EE_A3 + 9.0 * EE_A4 * theta2)));
              float rawY = theta * (EE_A1 + EE_A2 * theta2 + theta6 * (EE_A3 + EE_A4 * theta2));

              float scale = uMapWidth / (2.0 * EE_RAW_X_MAX);
              oFlatX = rawX * scale;
              oFlatY = rawY * scale;
            }

            vec2 d = vec2(oFlatX - flatX, oFlatY - flatY);
            float dLen = length(d);
            if (dLen > 0.00001) {
              float flip = uv.y < 0.5 ? 1.0 : -1.0;
              vec2 segDir = (d / dLen) * flip;
              vec2 sideDir = vec2(-segDir.y, segDir.x);
              float sideSign = (uv.x < 0.5) ? -1.0 : 1.0;
              vec2 flatOffset = sideDir * (uRibbonWidth * 0.5) * sideSign;
              flatX += flatOffset.x;
              flatY += flatOffset.y;
            }
          }

          dynFlatPos = vec3(flatX, flatY, aFlatPos.z);
        } else {
          vProjLon = 0.0;
          vProjMode = 0.0;
        }

        vMorph = uMorph;
        vec3 morphedPos = mix(dynSpherePos, dynFlatPos, uMorph);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(morphedPos, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>

      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vProjLon;
      varying float vProjMode;
      varying float vMorph;

      void main() {
        if (vProjMode > 0.5 && vMorph > 0.05 && fwidth(vProjLon) > 2.8) {
          discard;
        }
        gl_FragColor = vec4(uColor, uOpacity);
        #include <logdepthbuf_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1.0,
    polygonOffsetUnits: -4.0,
    side: DoubleSide,
  });
}

export function createPlanetCellOverlayMaterial(
  uniformHolder: IDynamicProjectionUniforms,
  overlayTextureUniform: IUniform<any>,
  texWidth: number,
  texHeight: number,
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uMorph: uniformHolder.uMorph,
      uProjForward: uniformHolder.uProjForward,
      uProjUp: uniformHolder.uProjUp,
      uProjRight: uniformHolder.uProjRight,
      uProjMode: uniformHolder.uProjMode,
      uMapWidth: uniformHolder.uMapWidth,
      uMapHeight: uniformHolder.uMapHeight,
      uRadius: uniformHolder.uRadius,
      uProjectionType: uniformHolder.uProjectionType,
      uCellOverlayTex: overlayTextureUniform,
      uTexWidth: { value: texWidth },
      uTexHeight: { value: texHeight },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>

      attribute vec3 aSpherePos;
      attribute vec3 aFlatPos;
      attribute vec3 aSphereNorm;
      attribute vec3 aFlatNorm;
      attribute vec3 aOtherDir1;
      attribute vec3 aOtherDir2;
      attribute float aCellId;
      attribute float aDist;

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
      varying float vCellId;
      varying float vDist;

      void main() {
        vCellId = aCellId;
        vDist = aDist;

        vec3 dynSpherePos = aSpherePos;
        vec3 dynFlatPos = aFlatPos;

        // Seam culling runs in both static and dynamic modes: when tracking is off the projection
        // basis uniforms hold the identity frame (forward=+Z, right=+X, up=+Y), so pLon is the true
        // longitude matching the CPU-baked aFlatPos. Testing all three triangle edges is required
        // because a cell fan can straddle the antimeridian without any single vertex knowing it.
        vec3 dir = aSphereNorm;
        float dotFwd = dot(dir, uProjForward);
        float dotRight = dot(dir, uProjRight);
        float dotUp = dot(dir, uProjUp);

        float pLon = atan(dotRight, dotFwd);
        float pLat = asin(clamp(dotUp, -1.0, 1.0));

        float oFwd1 = dot(aOtherDir1, uProjForward);
        float oRight1 = dot(aOtherDir1, uProjRight);
        float oLon1 = atan(oRight1, oFwd1);

        float oFwd2 = dot(aOtherDir2, uProjForward);
        float oRight2 = dot(aOtherDir2, uProjRight);
        float oLon2 = atan(oRight2, oFwd2);

        if (uMorph > 0.05 &&
            (abs(pLon - oLon1) > 3.14159 ||
             abs(pLon - oLon2) > 3.14159 ||
             abs(oLon1 - oLon2) > 3.14159)) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }

        if (uProjMode > 0.5) {
          vProjLon = pLon;
          vProjMode = 1.0;

          float flatX = 0.0;
          float flatY = 0.0;

          if (uProjectionType < 0.5) {
            flatX = (pLon / 3.141592653589793) * (uMapWidth * 0.5);
            flatY = (pLat / 1.5707963267948966) * (uMapHeight * 0.5);
          } else {
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
        vec3 morphedPos = mix(dynSpherePos, dynFlatPos, uMorph);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(morphedPos, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>

      uniform sampler2D uCellOverlayTex;
      uniform float uTexWidth;
      uniform float uTexHeight;

      varying float vProjLon;
      varying float vProjMode;
      varying float vMorph;
      varying float vCellId;
      varying float vDist;

      void main() {
        if (vProjMode > 0.5 && vMorph > 0.05 && fwidth(vProjLon) > 2.8) {
          discard;
        }

        int id = int(vCellId);
        int tw = int(uTexWidth);
        int th = int(uTexHeight);
        ivec2 coord = ivec2(id % tw, id / tw);
        vec4 style = texelFetch(uCellOverlayTex, coord, 0);

        if (style.a <= 0.001) {
          discard;
        }

        float edgeGlow = mix(0.7, 1.0, smoothstep(0.4, 0.98, vDist));
        gl_FragColor = vec4(style.rgb * edgeGlow, style.a);
        #include <logdepthbuf_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -0.5,
    polygonOffsetUnits: -2.0,
    side: DoubleSide,
  });
}
