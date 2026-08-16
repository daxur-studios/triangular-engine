import { AnimalVector3 } from './animal-types';

export type AnimalSurfaceKind = 'plane' | 'sphere' | 'cylinder';

/** Shape-neutral terrain information consumed by animal policies. */
export interface AnimalWorldSurfaceSample {
  readonly position: AnimalVector3;
  readonly anchorRelativePosition: AnimalVector3;
  readonly normal: AnimalVector3;
  /** Away from inhabited ground: +Y, sphere-outward, or cylinder-inward. */
  readonly surfaceUp: AnimalVector3;
  readonly tangentU: AnimalVector3;
  readonly tangentV: AnimalVector3;
  readonly elevationM: number;
  readonly slope01: number;
  readonly walkable: boolean;
}

/**
 * Game-facing surface boundary. Movement policies never branch on world shape;
 * the supplied adapter owns projection, topology, and local tangent frames.
 */
export interface AnimalWorldSurface {
  readonly kind: AnimalSurfaceKind;
  sample(
    worldPosition: AnimalVector3,
    anchorWorldPosition?: AnimalVector3,
  ): AnimalWorldSurfaceSample;
  projectToSurface(worldPosition: AnimalVector3): AnimalVector3;
  moveAlongSurface(
    worldPosition: AnimalVector3,
    tangentVelocity: AnimalVector3,
    deltaSeconds: number,
  ): AnimalVector3;
  /** Shortest topology-aware distance along the undisplaced surface. */
  surfaceDistance(fromWorldPosition: AnimalVector3, toWorldPosition: AnimalVector3): number;
}
