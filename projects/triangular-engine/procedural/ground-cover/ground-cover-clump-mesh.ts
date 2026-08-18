import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

import { createProceduralRandom01, sampleProceduralRange } from '../core/procedural-hash';
import type { IGroundCoverArchetype } from './ground-cover-archetype';

export interface IGroundCoverMeshResult {
  readonly geometry: BufferGeometry;
  readonly triangleCount: number;
  readonly vertexCount: number;
}

/**
 * Guards against a misconfigured archetype (e.g. a huge bladeCount) silently
 * producing an unrenderable mesh — mirrors flora-mesh's budget guard.
 */
const GROUND_COVER_MAX_TRIANGLES_PER_CLUMP = 4_000;

/** Stations (0, 0.5, 1) along a blade's height used to bend and taper it. */
const BLADE_STATION_FRACTIONS = [0, 0.5, 1] as const;
/** Half-width at each station as a fraction of the blade's base width — tapers to a point. */
const BLADE_STATION_WIDTH_FACTORS = [1, 0.55, 0.03] as const;

const scratchBase = new Vector3();
const scratchLean = new Vector3();
const scratchPerp = new Vector3();
const scratchCenter = new Vector3();
const scratchLeft = new Vector3();
const scratchRight = new Vector3();
const scratchEdgeA = new Vector3();
const scratchEdgeB = new Vector3();
const scratchNormal = new Vector3();
const scratchTip = new Vector3();
const scratchHeadCenter = new Vector3();
const scratchUp = new Vector3(0, 1, 0);

function pushGroundCoverTriangle(
  positions: number[],
  normals: number[],
  height01s: number[],
  headMix01s: number[],
  indices: number[],
  p1: Vector3,
  p2: Vector3,
  p3: Vector3,
  h1: number,
  h2: number,
  h3: number,
  headMix: number,
): void {
  scratchEdgeA.subVectors(p2, p1);
  scratchEdgeB.subVectors(p3, p1);
  scratchNormal.crossVectors(scratchEdgeA, scratchEdgeB);
  if (scratchNormal.lengthSq() > 0) scratchNormal.normalize();
  else scratchNormal.set(0, 1, 0);

  const base = positions.length / 3;
  positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
  for (let i = 0; i < 3; i++) normals.push(scratchNormal.x, scratchNormal.y, scratchNormal.z);
  height01s.push(h1, h2, h3);
  headMix01s.push(headMix, headMix, headMix);
  indices.push(base, base + 1, base + 2);
}

/**
 * A single double-sided quad, colored via `headMix01=1` so the caller-side
 * colorizer can pick a fixed head color instead of the base/tip gradient.
 * `axisH`/`axisV` must be unit vectors; the quad spans ±halfSizeM along each.
 */
function pushGroundCoverHeadQuad(
  positions: number[],
  normals: number[],
  height01s: number[],
  headMix01s: number[],
  indices: number[],
  center: Vector3,
  axisH: Vector3,
  axisV: Vector3,
  halfSizeM: number,
): void {
  const bottomLeft = new Vector3().copy(center).addScaledVector(axisH, -halfSizeM).addScaledVector(axisV, -halfSizeM);
  const bottomRight = new Vector3().copy(center).addScaledVector(axisH, halfSizeM).addScaledVector(axisV, -halfSizeM);
  const topRight = new Vector3().copy(center).addScaledVector(axisH, halfSizeM).addScaledVector(axisV, halfSizeM);
  const topLeft = new Vector3().copy(center).addScaledVector(axisH, -halfSizeM).addScaledVector(axisV, halfSizeM);

  // Front face.
  pushGroundCoverTriangle(positions, normals, height01s, headMix01s, indices, bottomLeft, bottomRight, topRight, 1, 1, 1, 1);
  pushGroundCoverTriangle(positions, normals, height01s, headMix01s, indices, bottomLeft, topRight, topLeft, 1, 1, 1, 1);
  // Back face (reversed winding, double-sided without a material flag).
  pushGroundCoverTriangle(positions, normals, height01s, headMix01s, indices, bottomLeft, topRight, bottomRight, 1, 1, 1, 1);
  pushGroundCoverTriangle(positions, normals, height01s, headMix01s, indices, bottomLeft, topLeft, topRight, 1, 1, 1, 1);
}

/**
 * Builds one clump's worth of curved, tapered blade cards fanned around a
 * local origin — a low-triangle "tuft" meant to be instanced by scatter, not
 * a single blade. No branching skeleton, no wind-weight attribute: local Y
 * already runs 0 (base) to blade height (tip), which is exactly what
 * `enableScatterWindSway`'s default object-space-height heuristic wants, so
 * unlike flora this doesn't need `useVertexWindWeight`. `height01` is baked
 * only for vertex-color base/tip gradients; `headMix01` (1 on `archetype.head`
 * bloom quads, 0 elsewhere) lets the caller pick a fixed head color instead
 * of the gradient for those vertices.
 */
export function buildGroundCoverClumpMesh(
  archetype: IGroundCoverArchetype,
  seed: number,
): IGroundCoverMeshResult {
  const random01 = createProceduralRandom01(seed);
  const positions: number[] = [];
  const normals: number[] = [];
  const height01s: number[] = [];
  const headMix01s: number[] = [];
  const indices: number[] = [];

  const bladeCount = Math.round(sampleProceduralRange(archetype.clump.bladeCount, random01()));

  for (let i = 0; i < bladeCount; i++) {
    const clumpAzimuthRad = random01() * Math.PI * 2;
    const clumpRadiusM = sampleProceduralRange(archetype.clump.radiusM, random01());
    scratchBase.set(
      Math.cos(clumpAzimuthRad) * clumpRadiusM,
      0,
      Math.sin(clumpAzimuthRad) * clumpRadiusM,
    );

    const heightM = sampleProceduralRange(archetype.blade.heightM, random01());
    const widthM = sampleProceduralRange(archetype.blade.widthM, random01());
    const curveRad = sampleProceduralRange(archetype.blade.curveRad, random01());
    const leanAzimuthRad = random01() * Math.PI * 2;
    scratchLean.set(Math.cos(leanAzimuthRad), 0, Math.sin(leanAzimuthRad));
    scratchPerp.set(-Math.sin(leanAzimuthRad), 0, Math.cos(leanAzimuthRad));

    const leanReachM = heightM * Math.sin(curveRad);
    const risePerFraction = heightM * Math.cos(curveRad);

    const left: Vector3[] = [];
    const right: Vector3[] = [];
    const height01: number[] = [];
    for (let s = 0; s < BLADE_STATION_FRACTIONS.length; s++) {
      const t = BLADE_STATION_FRACTIONS[s];
      const lean = leanReachM * t * t;
      const rise = risePerFraction * t;
      scratchCenter
        .copy(scratchBase)
        .addScaledVector(scratchLean, lean)
        .add(new Vector3(0, rise, 0));
      const halfWidthM = widthM * 0.5 * BLADE_STATION_WIDTH_FACTORS[s];
      left.push(new Vector3().copy(scratchCenter).addScaledVector(scratchPerp, halfWidthM));
      right.push(new Vector3().copy(scratchCenter).addScaledVector(scratchPerp, -halfWidthM));
      height01.push(t);
    }

    for (let s = 0; s < BLADE_STATION_FRACTIONS.length - 1; s++) {
      const L0 = left[s];
      const L1 = left[s + 1];
      const R0 = right[s];
      const R1 = right[s + 1];
      const h0 = height01[s];
      const h1 = height01[s + 1];

      // Front face.
      pushGroundCoverTriangle(positions, normals, height01s, headMix01s, indices, L0, R0, R1, h0, h0, h1, 0);
      pushGroundCoverTriangle(positions, normals, height01s, headMix01s, indices, L0, R1, L1, h0, h1, h1, 0);
      // Back face (reversed winding, double-sided without a material flag).
      pushGroundCoverTriangle(positions, normals, height01s, headMix01s, indices, L0, R1, R0, h0, h1, h0, 0);
      pushGroundCoverTriangle(positions, normals, height01s, headMix01s, indices, L0, L1, R1, h0, h1, h1, 0);
    }

    if (archetype.head) {
      const headRadiusM = sampleProceduralRange(archetype.head.radiusM, random01());
      // t=1 station center (before the left/right half-width offset) — the blade's tip centerline.
      scratchTip
        .copy(scratchBase)
        .addScaledVector(scratchLean, leanReachM)
        .add(new Vector3(0, risePerFraction, 0));
      // Lifted by its own radius so the bloom sits on top of the stem tip rather than straddling it.
      scratchHeadCenter.copy(scratchTip).addScaledVector(scratchUp, headRadiusM);
      // Two quads crossed around the vertical axis — the standard cheap foliage-puff impostor, readable from any horizontal angle.
      pushGroundCoverHeadQuad(
        positions,
        normals,
        height01s,
        headMix01s,
        indices,
        scratchHeadCenter,
        scratchPerp,
        scratchUp,
        headRadiusM,
      );
      pushGroundCoverHeadQuad(
        positions,
        normals,
        height01s,
        headMix01s,
        indices,
        scratchHeadCenter,
        scratchLean,
        scratchUp,
        headRadiusM,
      );
    }
  }

  const triangleCount = indices.length / 3;
  if (triangleCount > GROUND_COVER_MAX_TRIANGLES_PER_CLUMP) {
    throw new RangeError(
      `Ground cover clump mesh exceeds triangle budget: ${triangleCount} > ${GROUND_COVER_MAX_TRIANGLES_PER_CLUMP}. ` +
        'Reduce clump.bladeCount.',
    );
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('height01', new Float32BufferAttribute(height01s, 1));
  geometry.setAttribute('headMix01', new Float32BufferAttribute(headMix01s, 1));
  geometry.setIndex(indices);

  return { geometry, triangleCount, vertexCount: positions.length / 3 };
}
