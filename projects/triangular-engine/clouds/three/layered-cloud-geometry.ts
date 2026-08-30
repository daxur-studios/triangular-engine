import {
  BufferAttribute,
  BufferGeometry,
  ExtrudeGeometry,
  Matrix4,
  Shape,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { createCloudRandom01 } from '../core/cloud-puff-shape';

export interface ILayeredCloudGeometryOptions {
  readonly layerCount?: number;
  readonly baseRadius?: number;
  readonly totalHeight?: number;
  readonly pointsPerLayer?: number;
  readonly seed?: number;
  readonly curvedCurvature?: number; // 0 for flat, >0 for sphere-curved layers
}

/**
 * Builds an irregular polygonal slab for a single layer slice.
 */
function buildLayerSlabGeometry(
  radius: number,
  height: number,
  pointsPerLayer: number,
  random: () => number,
): BufferGeometry {
  const shape = new Shape();
  const step = (Math.PI * 2) / pointsPerLayer;

  for (let i = 0; i < pointsPerLayer; i++) {
    const angle = i * step;
    const radiusJitter = 0.75 + random() * 0.5;
    const x = Math.cos(angle) * radius * radiusJitter;
    const y = Math.sin(angle) * radius * radiusJitter;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();

  const geometry = new ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1,
  });

  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -height / 2, 0);
  return geometry;
}

/**
 * Generates a 3D layered cloud geometry with baked vertex attributes for dynamic GPU morphing.
 *
 * For upper clouds (1-3 layers): creates thin, wide, near-flat or sphere-curved pancake slices.
 * For lower clouds (4-8 layers): creates stacked, stepped, terraced turret slabs.
 */
export function buildLayeredCloudGeometry(
  options: ILayeredCloudGeometryOptions = {},
): BufferGeometry {
  const layerCount = Math.max(1, options.layerCount ?? 4);
  const baseRadius = options.baseRadius ?? 1.0;
  const totalHeight = options.totalHeight ?? (layerCount <= 3 ? 0.12 : 0.65);
  const pointsPerLayer = Math.max(6, options.pointsPerLayer ?? 8);
  const seed = options.seed ?? 42;
  const random = createCloudRandom01(seed);

  const slabs: BufferGeometry[] = [];
  const layerSlabHeight = totalHeight / layerCount;
  const matrix = new Matrix4();

  for (let layer = 0; layer < layerCount; layer++) {
    const t = layerCount === 1 ? 0.5 : layer / (layerCount - 1);
    
    // Tapering profile: upper thin clouds stay wide; lower cumulus taper towards the top
    let layerRadius = baseRadius;
    if (layerCount <= 3) {
      // Thin top clouds: broad, slightly stepped pancake sheets
      layerRadius = baseRadius * (1.0 - t * 0.25);
    } else {
      // Lower cumulus: wide flat condensation floor tapering into puffy top turrets
      layerRadius = baseRadius * Math.max(0.28, 1.0 - Math.pow(t, 0.8) * 0.72);
    }

    const slab = buildLayerSlabGeometry(layerRadius, layerSlabHeight, pointsPerLayer, random);
    const layerY = -totalHeight / 2 + (layer + 0.5) * layerSlabHeight;

    // Slight organic center jitter per layer
    const jitterAmount = (layerCount <= 3 ? 0.04 : 0.08) * t * baseRadius;
    const jitterX = (random() * 2 - 1) * jitterAmount;
    const jitterZ = (random() * 2 - 1) * jitterAmount;
    const rotY = random() * Math.PI * 2;

    matrix.makeRotationY(rotY);
    matrix.setPosition(jitterX, layerY, jitterZ);
    slab.applyMatrix4(matrix);

    // Bake per-vertex layer metadata attributes for GPU morphing
    const posAttr = slab.getAttribute('position');
    const vertCount = posAttr.count;

    const aLayerIndex = new Float32Array(vertCount).fill(layer);
    const aNormalizedHeight = new Float32Array(vertCount).fill(t);
    const aRadialDist = new Float32Array(vertCount);
    const aPolarAngle = new Float32Array(vertCount);
    const aRandomJitter = new Float32Array(vertCount);

    const pos = new Vector3();
    for (let v = 0; v < vertCount; v++) {
      pos.fromBufferAttribute(posAttr, v);
      const r = Math.hypot(pos.x - jitterX, pos.z - jitterZ);
      const angle = Math.atan2(pos.z - jitterZ, pos.x - jitterX);
      aRadialDist[v] = r / (layerRadius || 1);
      aPolarAngle[v] = angle < 0 ? angle + Math.PI * 2 : angle;
      aRandomJitter[v] = random();
    }

    slab.setAttribute('aLayerIndex', new BufferAttribute(aLayerIndex, 1));
    slab.setAttribute('aNormalizedHeight', new BufferAttribute(aNormalizedHeight, 1));
    slab.setAttribute('aRadialDist', new BufferAttribute(aRadialDist, 1));
    slab.setAttribute('aPolarAngle', new BufferAttribute(aPolarAngle, 1));
    slab.setAttribute('aRandomJitter', new BufferAttribute(aRandomJitter, 1));

    slabs.push(slab);
  }

  const merged = mergeGeometries(slabs, false) ?? slabs[0];
  for (const s of slabs) s.dispose();

  merged.computeBoundingSphere();
  merged.computeVertexNormals();
  return merged;
}
