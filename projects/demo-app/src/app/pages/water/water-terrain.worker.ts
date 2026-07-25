/// <reference lib="webworker" />

import {
  CylinderTerrainDomain,
  generateTerrainPatchMesh,
  PlaneTerrainDomain,
  SphereTerrainDomain,
  type ITerrainField,
  type ITerrainFieldSample,
  type TerrainVector3,
} from 'triangular-engine/terrain';

type DomainKind = 'plane' | 'sphere' | 'cylinder';

interface Request {
  readonly id: number;
  readonly kind: DomainKind;
  readonly scale: number;
  readonly address: unknown;
  readonly resolution: number;
  readonly skirtDepthM: number;
}

addEventListener('message', ({ data }: MessageEvent<Request>) => {
  try {
    const field = createField(data.kind);
    const domain = createDomain(data.kind, data.scale);
    const patch = generateTerrainPatchMesh(field, domain, {
      address: data.address,
      resolution: data.resolution,
      skirtDepthM: data.skirtDepthM,
    });
    const transfer = [
      patch.surface.positions.buffer,
      patch.surface.normals.buffer,
      patch.surface.uvs.buffer,
      patch.surface.indices.buffer,
    ];
    if (patch.skirt) {
      transfer.push(
        patch.skirt.positions.buffer,
        patch.skirt.normals.buffer,
        patch.skirt.uvs.buffer,
        patch.skirt.indices.buffer,
      );
    }
    postMessage({ id: data.id, patch }, transfer);
  } catch (error) {
    postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

function createDomain(kind: DomainKind, scale: number) {
  switch (kind) {
    case 'sphere':
      return new SphereTerrainDomain(180 * scale);
    case 'cylinder':
      return new CylinderTerrainDomain({
        radiusM: 180 * scale,
        lengthM: 600 * scale,
        levelZeroAngularPatchCount: 8 * scale,
        levelZeroAxialPatchCount: 4 * scale,
      });
    default:
      return new PlaneTerrainDomain(800);
  }
}

function createField(kind: DomainKind): ITerrainField {
  switch (kind) {
    case 'sphere':
      return new WorkerOceanPlanetField();
    case 'cylinder':
      return new WorkerCylinderHabitatField();
    default:
      return new WorkerCoastalField();
  }
}

abstract class WorkerField implements ITerrainField {
  abstract readonly minElevationM: number;
  abstract readonly maxElevationM: number;
  abstract sample(position: TerrainVector3): ITerrainFieldSample;

  sampleBatch(
    positions: Float64Array,
    out = new Float64Array(positions.length / 3),
  ): Float64Array {
    for (let i = 0; i < out.length; i++) {
      out[i] = this.sample([
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      ]).elevationM;
    }
    return out;
  }
}

class WorkerCoastalField extends WorkerField {
  readonly minElevationM = -58;
  readonly maxElevationM = 55;

  sample([x, _y, z]: TerrainVector3): ITerrainFieldSample {
    const coastX =
      115 + Math.sin(z * 0.008) * 55 + Math.sin(z * 0.021 + 1.4) * 18;
    const offshoreM = coastX - x;
    const shelf = -2.5 - smoothstep(35, 235, offshoreM) * 9;
    const basin = -smoothstep(220, 570, offshoreM) * 38;
    const sandbars =
      Math.exp(-Math.pow((offshoreM - 75) / 32, 2)) *
      (3.2 + Math.sin(z * 0.035) * 1.3);
    const seabedVariation =
      Math.sin(x * 0.017 + z * 0.012) * 1.4 +
      Math.sin(x * 0.006 - z * 0.019) * 0.9;
    const inlandRise = smoothstep(-25, 260, x - coastX) * 25;
    const inlandHills =
      (Math.max(0, x - coastX) / 260) *
      (8 + Math.sin(z * 0.013) * 6 + Math.sin(x * 0.018) * 4);
    const beach = smoothstep(-18, 42, x - coastX) * 5;
    const islandDistance = Math.hypot(x + 230, z - 145);
    const island = smoothstep(145, 38, islandDistance) * 18;
    const lagoon = smoothstep(75, 25, Math.hypot(x + 205, z - 135)) * -7;
    return {
      elevationM:
        shelf +
        basin +
        sandbars +
        seabedVariation +
        inlandRise +
        inlandHills +
        beach +
        island +
        lagoon,
    };
  }
}

class WorkerOceanPlanetField extends WorkerField {
  readonly minElevationM = -46;
  readonly maxElevationM = 32;

  sample([x, y, z]: TerrainVector3): ITerrainFieldSample {
    const length = Math.hypot(x, y, z) || 1;
    const direction: TerrainVector3 = [x / length, y / length, z / length];
    const continent =
      sphericalBump(direction, [0.9, 0.08, 0.42], 0.94, 0.38) * 55 +
      sphericalBump(direction, [0.62, -0.55, 0.56], 0.68, 0.25) * 31 +
      sphericalBump(direction, [0.54, 0.62, 0.58], 0.58, 0.2) * 24;
    const islandArc =
      sphericalBump(direction, [0.18, -0.18, 0.97], 0.24, 0.07) * 29 +
      sphericalBump(direction, [-0.04, -0.34, 0.94], 0.2, 0.06) * 25 +
      sphericalBump(direction, [-0.28, -0.42, 0.86], 0.18, 0.055) * 22;
    const abyss =
      sphericalBump(direction, [-0.62, 0.06, 0.78], 0.72, 0.22) * -13;
    const trench =
      Math.exp(
        -Math.pow(
          (dot(direction, normalize([-0.45, -0.35, 0.82])) - 0.91) / 0.035,
          2,
        ),
      ) * -10;
    const relief =
      Math.sin(direction[0] * 17 + direction[2] * 9) * 2.2 +
      Math.sin(direction[1] * 23 - direction[0] * 7) * 1.4 +
      Math.sin((direction[0] + direction[1] + direction[2]) * 31) * 0.7;
    return {
      elevationM: Math.min(
        32,
        Math.max(-46, -31 + continent + islandArc + abyss + trench + relief),
      ),
    };
  }
}

class WorkerCylinderHabitatField extends WorkerField {
  readonly minElevationM = -42;
  readonly maxElevationM = 28;

  sample([x, y, z]: TerrainVector3): ITerrainFieldSample {
    const angle = Math.atan2(z, y);
    const coast =
      Math.sin(angle * 3 + x * 0.006) * 11 +
      Math.sin(angle * 7 - x * 0.012) * 4;
    const broadShelf = -9 + coast;
    const basin =
      -26 *
      smoothstep(
        0.25,
        0.85,
        Math.sin(angle - x * 0.0015) * 0.5 + 0.5,
      );
    const islands =
      Math.max(0, Math.sin(angle * 5 + x * 0.018) - 0.55) * 38;
    const relief =
      Math.sin(x * 0.025 + angle * 9) * 2 +
      Math.sin(x * 0.009 - angle * 13) * 1.2;
    return {
      elevationM: Math.min(
        this.maxElevationM,
        Math.max(this.minElevationM, broadShelf + basin + islands + relief),
      ),
    };
  }
}

function sphericalBump(
  direction: TerrainVector3,
  center: TerrainVector3,
  outerAngle: number,
  innerAngle: number,
): number {
  const angle = Math.acos(
    Math.min(1, Math.max(-1, dot(direction, normalize(center)))),
  );
  return smoothstep(outerAngle, innerAngle, angle);
}

function normalize(value: TerrainVector3): TerrainVector3 {
  const length = Math.hypot(...value) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function dot(a: TerrainVector3, b: TerrainVector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
