import { BufferGeometry, ExtrudeGeometry, Matrix4, Shape } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { createCloudRandom01, type ICloudPuffVariantParams } from '../../core/cloud-puff-shape';
import type { ICloudPuffStyle } from './cloud-puff-style';

const TURRET_LAYER_COUNT = 4;
const MIN_TURRETS = 2;
const MAX_TURRETS = 4;

/**
 * Builds one flat-shaded slab whose footprint is a jittered polygon (5-7 points nudged off a
 * circle) rather than a perfect rectangle, extruded to `height`. Straight edges still keep the
 * "paper-cutout" look, but the outline reads as lumpy instead of boxy.
 */
function buildIrregularSlabGeometry(
  width: number,
  depth: number,
  height: number,
  random: () => number,
): BufferGeometry {
  const pointCount = 5 + Math.floor(random() * 3);
  const shape = new Shape();
  for (let i = 0; i < pointCount; i++) {
    const angle = (i / pointCount) * Math.PI * 2;
    const radiusJitter = 0.65 + random() * 0.5;
    const x = Math.cos(angle) * (width / 2) * radiusJitter;
    const y = Math.sin(angle) * (depth / 2) * radiusJitter;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();

  const geometry = new ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -height / 2, 0);
  return geometry;
}

function addLayer(
  slabs: BufferGeometry[],
  matrix: Matrix4,
  random: () => number,
  centerX: number,
  centerZ: number,
  centerY: number,
  width: number,
  depth: number,
  height: number,
  jitter: number,
): void {
  const slab = buildIrregularSlabGeometry(width, depth, height, random);
  const offsetX = centerX + (random() * 2 - 1) * jitter;
  const offsetZ = centerZ + (random() * 2 - 1) * jitter;
  const rotationY = random() * Math.PI * 2;

  matrix.makeRotationY(rotationY);
  matrix.setPosition(offsetX, centerY, offsetZ);
  slab.applyMatrix4(matrix);
  slabs.push(slab);
}

/**
 * Builds one puff as a wide, near-flat base tier (the condensation-level "floor" real cumulus
 * sit on) with a handful of independent, tapered "turret" stacks rising out of it at randomized
 * offsets — each turret gets chaotic near its top, mirroring how real cloud tops billow while
 * the base stays flat. Every layer is an irregular polygon slab rather than a box.
 */
function buildCardStackGeometry(params: ICloudPuffVariantParams): BufferGeometry {
  const random = createCloudRandom01(params.seed);
  const slabs: BufferGeometry[] = [];
  const matrix = new Matrix4();

  const baseWidth = 1.5 + random() * 0.3;
  const baseDepth = 1.5 + random() * 0.3;
  const baseHeight = 0.22 + random() * 0.08;
  const baseY = -0.5 + baseHeight / 2;
  addLayer(slabs, matrix, random, 0, 0, baseY, baseWidth, baseDepth, baseHeight, 0.05);

  const turretCount = MIN_TURRETS + Math.floor(random() * (MAX_TURRETS - MIN_TURRETS + 1));
  const baseTop = baseY + baseHeight / 2;

  for (let turret = 0; turret < turretCount; turret++) {
    const angle = random() * Math.PI * 2;
    const radius = random() * baseWidth * 0.3;
    const centerX = Math.cos(angle) * radius;
    const centerZ = Math.sin(angle) * radius;
    let layerY = baseTop;

    for (let layer = 0; layer < TURRET_LAYER_COUNT; layer++) {
      const t = layer / (TURRET_LAYER_COUNT - 1);
      const taper = Math.max(0.3, 1 - t * 0.6);
      const width = (0.5 + random() * 0.3) * taper;
      const depth = (0.5 + random() * 0.3) * taper;
      const height = 0.2 + random() * 0.12;
      const jitter = 0.06 + t * 0.14;

      addLayer(slabs, matrix, random, centerX, centerZ, layerY + height / 2, width, depth, height, jitter);
      layerY += height * 0.85;
    }
  }

  const merged = mergeGeometries(slabs, false) ?? slabs[0];
  for (const slab of slabs) slab.dispose();

  merged.computeBoundingSphere();
  const radius = merged.boundingSphere?.radius || 1;
  const normalizeScale = radius > 0 ? 1 / radius : 1;
  merged.scale(normalizeScale, normalizeScale, normalizeScale);
  merged.computeBoundingSphere();
  return merged;
}

export const CARD_STACK_STYLE: ICloudPuffStyle = {
  id: 'card-stack',
  label: 'Card stack',
  description:
    'Flat base tier with tapered turret stacks rising out of it — lumpy irregular slab footprints, chaotic near the top. Ignores the flat/smooth toggle (always flat).',
  buildGeometryVariants: (variantParams) => variantParams.map(buildCardStackGeometry),
};
