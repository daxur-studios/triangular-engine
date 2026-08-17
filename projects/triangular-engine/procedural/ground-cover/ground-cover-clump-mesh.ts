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

function pushGroundCoverTriangle(
  positions: number[],
  normals: number[],
  height01s: number[],
  indices: number[],
  p1: Vector3,
  p2: Vector3,
  p3: Vector3,
  h1: number,
  h2: number,
  h3: number,
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
  indices.push(base, base + 1, base + 2);
}

/**
 * Builds one clump's worth of curved, tapered blade cards fanned around a
 * local origin — a low-triangle "tuft" meant to be instanced by scatter, not
 * a single blade. No branching skeleton, no wind-weight attribute: local Y
 * already runs 0 (base) to blade height (tip), which is exactly what
 * `enableScatterWindSway`'s default object-space-height heuristic wants, so
 * unlike flora this doesn't need `useVertexWindWeight`. `height01` is baked
 * only for vertex-color base/tip gradients.
 */
export function buildGroundCoverClumpMesh(
  archetype: IGroundCoverArchetype,
  seed: number,
): IGroundCoverMeshResult {
  const random01 = createProceduralRandom01(seed);
  const positions: number[] = [];
  const normals: number[] = [];
  const height01s: number[] = [];
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
      pushGroundCoverTriangle(positions, normals, height01s, indices, L0, R0, R1, h0, h0, h1);
      pushGroundCoverTriangle(positions, normals, height01s, indices, L0, R1, L1, h0, h1, h1);
      // Back face (reversed winding, double-sided without a material flag).
      pushGroundCoverTriangle(positions, normals, height01s, indices, L0, R1, R0, h0, h1, h0);
      pushGroundCoverTriangle(positions, normals, height01s, indices, L0, L1, R1, h0, h1, h1);
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
  geometry.setIndex(indices);

  return { geometry, triangleCount, vertexCount: positions.length / 3 };
}
