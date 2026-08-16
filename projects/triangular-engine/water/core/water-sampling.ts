import { Vector2, Vector3 } from 'three';
import type { WaterSurfaceDomain } from './water-domain';
import type { WaterSurface } from './water-surface';

export interface WaterBody {
  readonly id: string;
  readonly domain: WaterSurfaceDomain;
  readonly surface: WaterSurface;
  /** Higher-priority bodies win when multiple bodies contain the sample. */
  readonly priority?: number;
  readonly contains?: (worldPosition: Vector3) => boolean;
}

export interface WaterSample {
  readonly body: WaterBody;
  readonly position: Vector3;
  readonly normal: Vector3;
  readonly flow: Vector3;
  /** Positive above the displaced surface, negative below it. */
  readonly signedDistance: number;
  /** Zero above water; positive distance below the displaced surface. */
  readonly depth: number;
}

export function sampleWaterBody(
  body: WaterBody,
  worldPosition: Vector3,
  elapsedSeconds: number,
): WaterSample {
  const frame = body.domain.getLocalFrame(worldPosition);
  const delta = scratchDelta.subVectors(worldPosition, frame.origin);
  const localX = delta.dot(frame.tangentU);
  const localZ = delta.dot(frame.tangentV);
  const surfaceXZ =
    body.domain.getSurfaceXZ?.(frame, localX, localZ, scratchSurfaceXZ) ??
    scratchSurfaceXZ.set(localX, localZ);
  const height = body.surface.getHeight(
    surfaceXZ.x,
    surfaceXZ.y,
    elapsedSeconds,
  );
  const localNormal = body.surface.getNormal(
    surfaceXZ.x,
    surfaceXZ.y,
    elapsedSeconds,
    scratchLocalNormal,
  );
  const position = body.domain.composeWorldPosition(
    frame,
    localX,
    localZ,
    height,
    new Vector3(),
  );
  const normal = new Vector3()
    .addScaledVector(frame.tangentU, localNormal.x)
    .addScaledVector(frame.normal, localNormal.y)
    .addScaledVector(frame.tangentV, localNormal.z)
    .normalize();
  const localFlow = body.surface.getFlow(
    surfaceXZ.x,
    surfaceXZ.y,
    elapsedSeconds,
    scratchLocalFlow,
  );
  const flow = new Vector3()
    .addScaledVector(frame.tangentU, localFlow.x)
    .addScaledVector(frame.normal, localFlow.y)
    .addScaledVector(frame.tangentV, localFlow.z);
  const signedDistance = scratchDelta
    .subVectors(worldPosition, position)
    .dot(normal);
  return {
    body,
    position,
    normal,
    flow,
    signedDistance,
    depth: Math.max(0, -signedDistance),
  };
}

const scratchDelta = new Vector3();
const scratchSurfaceXZ = new Vector2();
const scratchLocalNormal = new Vector3();
const scratchLocalFlow = new Vector3();
