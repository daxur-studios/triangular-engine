import {
  MeshStandardMaterial,
  MeshToonMaterial,
  Vector3,
  WebGLProgramParametersWithUniforms,
  WebGLRenderer,
} from 'three';
import {
  computeSunDirectionFromTime,
  createDefaultPlanetDayNightUniforms,
  createPlanetMorphMaterial,
  enablePlanetDayNightLighting,
  enablePlanetMorphProjection,
  IDynamicProjectionUniforms,
} from './planet-morph-material';

describe('planet-morph-material', () => {
  function fakeShader(): WebGLProgramParametersWithUniforms {
    return {
      vertexShader: `
        #include <common>
        #include <beginnormal_vertex>
        #include <begin_vertex>
        #include <fog_vertex>
        void main() {}
      `,
      fragmentShader: `
        #include <common>
        #include <dithering_fragment>
        void main() {
          gl_FragColor = vec4(1.0);
        }
      `,
      uniforms: {},
      defines: {},
    } as unknown as WebGLProgramParametersWithUniforms;
  }

  describe('computeSunDirectionFromTime', () => {
    it('computes solar noon at the prime meridian as pointing towards +Z', () => {
      const dir = computeSunDirectionFromTime(12, 23.44, 0.25);
      expect(dir.x).toBeCloseTo(0, 4);
      expect(dir.y).toBeCloseTo(0, 4);
      expect(dir.z).toBeCloseTo(1, 4);
    });

    it('computes dawn (06:00) as pointing towards +X (East)', () => {
      const dir = computeSunDirectionFromTime(6, 0, 0.25);
      expect(dir.x).toBeCloseTo(1, 4);
      expect(dir.y).toBeCloseTo(0, 4);
      expect(dir.z).toBeCloseTo(0, 4);
    });

    it('computes dusk (18:00) as pointing towards -X (West)', () => {
      const dir = computeSunDirectionFromTime(18, 0, 0.25);
      expect(dir.x).toBeCloseTo(-1, 4);
      expect(dir.y).toBeCloseTo(0, 4);
      expect(dir.z).toBeCloseTo(0, 4);
    });

    it('computes midnight (00:00) as pointing towards -Z (Antimeridian)', () => {
      const dir = computeSunDirectionFromTime(0, 0, 0.25);
      expect(dir.x).toBeCloseTo(0, 4);
      expect(dir.y).toBeCloseTo(0, 4);
      expect(dir.z).toBeCloseTo(-1, 4);
    });

    it('tilts north towards +Y during summer solstice', () => {
      const dir = computeSunDirectionFromTime(12, 23.44, 0.5);
      const expectedY = Math.sin((23.44 * Math.PI) / 180);
      expect(dir.y).toBeCloseTo(expectedY, 4);
      expect(dir.z).toBeGreaterThan(0);
    });
  });

  describe('enablePlanetMorphProjection', () => {
    it('patches material via onBeforeCompile and customProgramCacheKey', () => {
      const mat = new MeshStandardMaterial();
      const uniforms: IDynamicProjectionUniforms = {
        uMorph: { value: 0 },
        uProjForward: { value: new Vector3(0, 0, 1) },
        uProjUp: { value: new Vector3(0, 1, 0) },
        uProjRight: { value: new Vector3(1, 0, 0) },
        uProjMode: { value: 0 },
        uMapWidth: { value: 12.56 },
        uMapHeight: { value: 6.28 },
        uRadius: { value: 2.0 },
        uProjectionType: { value: 1 },
      };

      enablePlanetMorphProjection(mat, uniforms);
      expect(mat.customProgramCacheKey()).toContain('planetMorphProjection');

      const shader = fakeShader();
      mat.onBeforeCompile(shader, {} as WebGLRenderer);

      expect(shader.vertexShader).toContain('dynFlatNorm');
      expect(shader.vertexShader).toContain('vSphereNorm');
      expect(shader.fragmentShader).toContain('vProjLon');
    });
  });

  describe('enablePlanetDayNightLighting', () => {
    it('composes on top of an existing patch without overwriting previous onBeforeCompile', () => {
      const mat = new MeshToonMaterial();
      const projUniforms: IDynamicProjectionUniforms = {
        uMorph: { value: 0 },
        uProjForward: { value: new Vector3(0, 0, 1) },
        uProjUp: { value: new Vector3(0, 1, 0) },
        uProjRight: { value: new Vector3(1, 0, 0) },
        uProjMode: { value: 0 },
        uMapWidth: { value: 12.56 },
        uMapHeight: { value: 6.28 },
        uRadius: { value: 2.0 },
        uProjectionType: { value: 1 },
      };
      const dayNightUniforms = createDefaultPlanetDayNightUniforms();

      enablePlanetMorphProjection(mat, projUniforms);
      enablePlanetDayNightLighting(mat, dayNightUniforms);

      const cacheKey = mat.customProgramCacheKey();
      expect(cacheKey).toContain('planetMorphProjection');
      expect(cacheKey).toContain('planetDayNight');

      const shader = fakeShader();
      mat.onBeforeCompile(shader, {} as WebGLRenderer);

      expect(shader.vertexShader).toContain('dynFlatNorm');
      expect(shader.fragmentShader).toContain('uDayNightEnabled');
      expect(shader.fragmentShader).toContain('uSunDirection');
      expect(shader.uniforms['uDayNightEnabled']).toBeDefined();
    });
  });

  describe('createPlanetMorphMaterial', () => {
    it('creates standard material with both patches and default day/night disabled', () => {
      const { material, uniforms, dayNightUniforms } =
        createPlanetMorphMaterial();
      expect(material).toBeInstanceOf(MeshStandardMaterial);
      expect(uniforms.uMorph.value).toBe(0);
      expect(dayNightUniforms.uDayNightEnabled.value).toBe(0);

      const shader = fakeShader();
      material.onBeforeCompile(shader, {} as WebGLRenderer);
      expect(shader.uniforms['uMorph']).toBeDefined();
      expect(shader.uniforms['uDayNightEnabled']).toBeDefined();
    });
  });
});
