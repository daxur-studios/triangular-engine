import {
  Color,
  IcosahedronGeometry,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';

import {
  createCirrusAtmosphereMaterial,
  type ICirrusAtmosphereMaterialOptions,
} from './cirrus-atmosphere-material';

export interface ICirrusAtmosphereOptions extends ICirrusAtmosphereMaterialOptions {
  readonly radius?: number;
  readonly detail?: number;
}

export interface ICirrusAtmosphereShell {
  readonly mesh: Mesh<IcosahedronGeometry, ShaderMaterial>;
  readonly material: ShaderMaterial;
  update(timeS: number): void;
  setSunDirection(direction: Vector3): void;
  setCoverage(coverage: number): void;
  setWispiness(wispiness: number): void;
  setFlowSpeed(speed: number): void;
  setFaceted(faceted: boolean): void;
  setRadius(radius: number): void;
  dispose(): void;
}

/**
 * Builds a continuous, flowing procedural upper atmosphere shell mesh ("butter spread" cirrus veil).
 * Uses GPU fluid flow (3D Worley cells + curl noise) to generate organic, thin, shifting atmospheric decks.
 */
export function buildCirrusAtmosphereShell(
  options: ICirrusAtmosphereOptions = {},
): ICirrusAtmosphereShell {
  const radius = options.radius ?? 58.5;
  const detail = options.detail ?? 3; // Subdivision detail

  const geometry = new IcosahedronGeometry(radius, detail);
  const material = createCirrusAtmosphereMaterial({
    ...options,
    radius,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'cirrus-atmosphere-shell';
  mesh.frustumCulled = false;

  return {
    mesh,
    material,
    update(timeS: number) {
      material.uniforms['uTime'].value = timeS;
    },
    setSunDirection(direction: Vector3) {
      material.uniforms['uSunDirection'].value.copy(direction);
    },
    setCoverage(coverage: number) {
      material.uniforms['uCoverage'].value = coverage;
    },
    setWispiness(wispiness: number) {
      material.uniforms['uWispiness'].value = wispiness;
    },
    setFlowSpeed(speed: number) {
      material.uniforms['uFlowSpeed'].value = speed;
    },
    setFaceted(faceted: boolean) {
      material.uniforms['uFaceted'].value = faceted ? 1.0 : 0.0;
    },
    setRadius(newRadius: number) {
      material.uniforms['uRadius'].value = newRadius;
      mesh.scale.setScalar(newRadius / radius);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.removeFromParent();
    },
  };
}
