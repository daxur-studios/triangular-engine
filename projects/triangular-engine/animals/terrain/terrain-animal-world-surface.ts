import type {
  AnimalSurfaceKind,
  AnimalVector3,
  AnimalWorldSurface,
  AnimalWorldSurfaceSample,
} from 'triangular-engine/animals';
import {
  CylinderTerrainDomain,
  type ICylinderTerrainPatchAddress,
  type IPlaneTerrainPatchAddress,
  type ISphereTerrainPatchAddress,
  type ITerrainField,
  PlaneTerrainDomain,
  sampleTerrainSurface,
  SphereTerrainDomain,
  sphereDirectionToFaceUv,
  type TerrainVector3,
} from 'triangular-engine/terrain';

export type SupportedAnimalTerrainDomain =
  | PlaneTerrainDomain
  | SphereTerrainDomain
  | CylinderTerrainDomain;

export interface TerrainAnimalWorldSurfaceOptions {
  /** Slopes above this normalized value are reported as non-walkable. */
  readonly maxWalkableSlope01?: number;
}

type SurfaceCoordinates = {
  readonly address:
    | IPlaneTerrainPatchAddress
    | ISphereTerrainPatchAddress
    | ICylinderTerrainPatchAddress;
  readonly u: number;
  readonly v: number;
};

/** Adapts the production terrain domains to one shape-neutral animal surface. */
export class TerrainAnimalWorldSurface implements AnimalWorldSurface {
  readonly kind: AnimalSurfaceKind;
  private readonly maxWalkableSlope01: number;

  constructor(
    private readonly field: ITerrainField,
    private readonly domain: SupportedAnimalTerrainDomain,
    options: TerrainAnimalWorldSurfaceOptions = {},
  ) {
    this.kind = domain.kind;
    this.maxWalkableSlope01 = options.maxWalkableSlope01 ?? 0.7;
    if (!Number.isFinite(this.maxWalkableSlope01) || this.maxWalkableSlope01 < 0 || this.maxWalkableSlope01 > 1) {
      throw new RangeError('Animal maximum walkable slope must be between zero and one.');
    }
  }

  sample(
    worldPosition: AnimalVector3,
    anchorWorldPosition: AnimalVector3 = worldPosition,
  ): AnimalWorldSurfaceSample {
    validateVector(worldPosition, 'Animal surface position');
    validateVector(anchorWorldPosition, 'Animal surface anchor');
    const coordinates = this.coordinatesFor(worldPosition);
    const terrain = this.sampleCoordinates(coordinates, anchorWorldPosition);
    const tangents = this.tangentFrame(coordinates, terrain.normal);
    return {
      position: fromTuple(terrain.worldPositionM),
      anchorRelativePosition: fromTuple(terrain.anchorRelativeM),
      normal: fromTuple(terrain.normal),
      surfaceUp: fromTuple(terrain.surfaceUp),
      tangentU: fromTuple(tangents.u),
      tangentV: fromTuple(tangents.v),
      elevationM: terrain.elevationM,
      slope01: terrain.slope01,
      walkable: terrain.slope01 <= this.maxWalkableSlope01,
    };
  }

  projectToSurface(worldPosition: AnimalVector3): AnimalVector3 {
    return this.sample(worldPosition).position;
  }

  moveAlongSurface(
    worldPosition: AnimalVector3,
    tangentVelocity: AnimalVector3,
    deltaSeconds: number,
  ): AnimalVector3 {
    validateVector(tangentVelocity, 'Animal tangent velocity');
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError('Animal surface delta time must be finite and non-negative.');
    }
    const current = this.sample(worldPosition);
    const normalSpeed = dot(tangentVelocity, current.normal);
    const tangent = {
      x: tangentVelocity.x - current.normal.x * normalSpeed,
      y: tangentVelocity.y - current.normal.y * normalSpeed,
      z: tangentVelocity.z - current.normal.z * normalSpeed,
    };
    const candidate = {
      x: current.position.x + tangent.x * deltaSeconds,
      y: current.position.y + tangent.y * deltaSeconds,
      z: current.position.z + tangent.z * deltaSeconds,
    };
    if (this.domain instanceof CylinderTerrainDomain) {
      const halfLength = this.domain.lengthM / 2;
      candidate.x = Math.min(halfLength, Math.max(-halfLength, candidate.x));
    }
    return this.projectToSurface(candidate);
  }

  surfaceDistance(from: AnimalVector3, to: AnimalVector3): number {
    validateVector(from, 'Animal surface distance start');
    validateVector(to, 'Animal surface distance end');
    if (this.domain instanceof PlaneTerrainDomain) {
      return Math.hypot(to.x - from.x, to.z - from.z);
    }
    if (this.domain instanceof SphereTerrainDomain) {
      const fromLength = Math.hypot(from.x, from.y, from.z);
      const toLength = Math.hypot(to.x, to.y, to.z);
      if (!(fromLength > 0) || !(toLength > 0)) {
        throw new RangeError('Animal sphere distance positions must be non-zero.');
      }
      const cosine = Math.min(1, Math.max(-1,
        (from.x * to.x + from.y * to.y + from.z * to.z) / (fromLength * toLength)));
      return Math.acos(cosine) * this.domain.radiusM;
    }
    const axial = to.x - from.x;
    const fromAngle = Math.atan2(from.z, from.y);
    const toAngle = Math.atan2(to.z, to.y);
    const angle = Math.abs(Math.atan2(Math.sin(toAngle - fromAngle), Math.cos(toAngle - fromAngle)));
    return Math.hypot(axial, angle * this.domain.radiusM);
  }

  private coordinatesFor(position: AnimalVector3): SurfaceCoordinates {
    if (this.domain instanceof PlaneTerrainDomain) {
      const u = position.x;
      const v = -position.z;
      const size = this.domain.levelZeroPatchSizeM;
      return { address: { level: 0, x: Math.floor(u / size), z: Math.floor(v / size) }, u, v };
    }
    if (this.domain instanceof SphereTerrainDomain) {
      const face = sphereDirectionToFaceUv([position.x, position.y, position.z]);
      return { address: { face: face.face, level: 0, x: 0, y: 0 }, u: face.u, v: face.v };
    }
    const halfLength = this.domain.lengthM / 2;
    if (position.x < -halfLength || position.x > halfLength) {
      throw new RangeError('Animal position is outside the finite cylinder length.');
    }
    const angle = positiveModulo(Math.atan2(position.z, position.y), Math.PI * 2);
    const counts = this.domain.getPatchCounts(0);
    const angularIndex = Math.min(counts.angular - 1, Math.floor(angle / (Math.PI * 2) * counts.angular));
    const axialIndex = Math.min(counts.axial - 1, Math.floor((position.x + halfLength) / this.domain.lengthM * counts.axial));
    return { address: { level: 0, angularIndex, axialIndex }, u: position.x, v: angle };
  }

  private sampleCoordinates(coordinates: SurfaceCoordinates, anchor: AnimalVector3) {
    return sampleTerrainSurface(
      this.field,
      this.domain as never,
      coordinates.address as never,
      coordinates.u,
      coordinates.v,
      { anchorWorldM: toTuple(anchor) },
    );
  }

  private tangentFrame(coordinates: SurfaceCoordinates, normal: TerrainVector3): { u: TerrainVector3; v: TerrainVector3 } {
    const bounds = (this.domain as SupportedAnimalTerrainDomain).getPatchBounds(coordinates.address as never);
    const epsilon = Math.min(bounds.maxU - bounds.minU, bounds.maxV - bounds.minV) / 1024;
    const left = this.surfacePosition(coordinates, coordinates.u - epsilon, coordinates.v);
    const right = this.surfacePosition(coordinates, coordinates.u + epsilon, coordinates.v);
    const rawU = normalize(subtract(right, left));
    const normalComponent = dotTuple(rawU, normal);
    const tangentU = normalize([
      rawU[0] - normal[0] * normalComponent,
      rawU[1] - normal[1] * normalComponent,
      rawU[2] - normal[2] * normalComponent,
    ]);
    return { u: tangentU, v: normalize(cross(normal, tangentU)) };
  }

  private surfacePosition(coordinates: SurfaceCoordinates, u: number, v: number): TerrainVector3 {
    const domain = this.domain as SupportedAnimalTerrainDomain;
    const address = coordinates.address as never;
    const fieldPosition = domain.getFieldPosition(address, u, v);
    return domain.getSurfacePosition(address, u, v, this.field.sample(fieldPosition).elevationM);
  }
}

export function createTerrainAnimalWorldSurface(
  field: ITerrainField,
  domain: SupportedAnimalTerrainDomain,
  options: TerrainAnimalWorldSurfaceOptions = {},
): AnimalWorldSurface {
  return new TerrainAnimalWorldSurface(field, domain, options);
}

function toTuple(value: AnimalVector3): TerrainVector3 { return [value.x, value.y, value.z]; }
function fromTuple(value: TerrainVector3): AnimalVector3 { return { x: value[0], y: value[1], z: value[2] }; }
function subtract(a: TerrainVector3, b: TerrainVector3): TerrainVector3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a: TerrainVector3, b: TerrainVector3): TerrainVector3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: AnimalVector3, b: AnimalVector3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function dotTuple(a: TerrainVector3, b: TerrainVector3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function normalize(value: TerrainVector3): TerrainVector3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!(length > 0) || !Number.isFinite(length)) throw new RangeError('Animal surface tangent is degenerate.');
  return [value[0] / length, value[1] / length, value[2] / length];
}
function positiveModulo(value: number, modulus: number): number { return ((value % modulus) + modulus) % modulus; }
function validateVector(value: AnimalVector3, label: string): void {
  if (![value.x, value.y, value.z].every(Number.isFinite)) throw new RangeError(`${label} must be finite.`);
}
