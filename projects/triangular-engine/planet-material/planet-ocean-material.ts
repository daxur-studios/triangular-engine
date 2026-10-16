import type { Color } from 'three';
import { PlanetSurfaceMaterial, type IPlanetSurfaceMaterialOptions } from './planet-surface-material';
import { solidColorLayer } from './planet-surface-layers';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface IPlanetOceanMaterialOptions extends Omit<IPlanetSurfaceMaterialOptions, 'base' | 'roughness' | 'metalness'> {
  /** Default '#146299' (water); the GLSL demo uses '#e04010' for lava worlds. */
  readonly color?: string | Color;
  /** Default 0.68. */
  readonly opacity?: number;
  /** Default 0.18. */
  readonly roughness?: number;
  /** Default 0.08. */
  readonly metalness?: number;
}

export interface IPlanetOceanMaterial {
  readonly material: PlanetSurfaceMaterial;
  /** Live colour uniform node. */
  readonly color: any;
}

/**
 * The ocean shell: stage 1 (the same morph as the terrain) over a constant translucent colour. The GLSL demo's
 * `MeshStandardMaterial` + `enablePlanetMorphProjection`, as a `PlanetSurfaceMaterial` with a solid base layer.
 *
 * The ocean geometry's `position` is not the same as its sphere position in general, so by default this reads
 * `aSpherePos` / `aSphereNorm` (`sphereFromGeometry: false`). Share `morph` with the terrain material.
 */
export function planetOceanMaterial(options: IPlanetOceanMaterialOptions = {}): IPlanetOceanMaterial {
  const solid = solidColorLayer({
    color: options.color ?? '#146299',
    roughness: options.roughness ?? 0.18,
    metalness: options.metalness ?? 0.08,
  });
  const material = new PlanetSurfaceMaterial({
    sphereFromGeometry: false,
    ...options,
    base: solid.layer,
  });
  material.transparent = true;
  material.opacity = options.opacity ?? 0.68;
  material.depthWrite = false;
  return { material, color: solid.color };
}
