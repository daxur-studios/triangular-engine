import {
  DoubleSide,
  MeshBasicMaterial,
  Texture,
  type ColorRepresentation,
} from 'three';

export interface ITrailRibbonMaterialOptions {
  readonly color?: ColorRepresentation;
  readonly map?: Texture;
  readonly opacity?: number;
}

const DEFAULT_COLOR: ColorRepresentation = 0x1a1a1a;
const DEFAULT_OPACITY = 0.85;
/** Large enough to beat z-fighting against the ground mesh a ribbon sits just above without visibly floating. */
const POLYGON_OFFSET_FACTOR = -4;
const POLYGON_OFFSET_UNITS = -4;

/**
 * `MeshBasicMaterial` preconfigured for `createTrailRibbonGeometry` output:
 * `polygonOffset` so a ribbon lying near-flush with the ground doesn't
 * z-fight, and a shader patch that multiplies the geometry's per-vertex
 * `alpha` attribute into fragment alpha, so trail ends can fade without a
 * second draw call.
 */
export function createTrailRibbonMaterial(
  options: ITrailRibbonMaterialOptions = {},
): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    color: options.color ?? DEFAULT_COLOR,
    map: options.map,
    opacity: options.opacity ?? DEFAULT_OPACITY,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: POLYGON_OFFSET_FACTOR,
    polygonOffsetUnits: POLYGON_OFFSET_UNITS,
    side: DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float alpha;\nvarying float vAlpha;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvAlpha = alpha;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
      .replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\ngl_FragColor.a *= vAlpha;',
      );
  };
  return material;
}
