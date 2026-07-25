import { Quaternion, Vector3 } from 'three';

import type { ScatterInstanceId } from '../core/scatter-instance-id';
import { filterRemovedScatterInstances, type IScatterRemovalOverlay } from '../core/scatter-removal-overlay';
import type {
  ScatterColliderDefinition,
  ScatterSpeciesDefinition,
} from '../core/scatter-species-definition';
import type { ITerrainScatterInstance } from '../terrain/scatter-terrain-instances';
import { computeScatterInstanceMatrix, type ScatterScaleRange } from './scatter-instance-transform';

export interface IScatterColliderDescriptor {
  readonly instanceId: ScatterInstanceId;
  readonly speciesId: string;
  /** Anchor-relative (f32-safe) — the body this feeds carries the f64 cell anchor. */
  readonly anchorRelativePositionM: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number]; // xyzw
  readonly shape: ScatterColliderDefinition['shape'];
  /** Shape params with this instance's uniform scale already applied. */
  readonly params: readonly number[];
  readonly impactThresholdNs?: number;
}

export interface IScatterCellColliderDescriptors {
  readonly cellKey: string;
  readonly anchorWorldM: readonly [number, number, number];
  readonly descriptors: readonly IScatterColliderDescriptor[];
}

export interface IBuildScatterColliderDescriptorsOptions {
  readonly cellKey: string;
  readonly anchorWorldM: readonly [number, number, number];
  readonly instances: readonly ITerrainScatterInstance[];
  readonly species: ScatterSpeciesDefinition;
  readonly scale: ScatterScaleRange;
  readonly overlay?: IScatterRemovalOverlay;
}

const scratchPosition = new Vector3();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();

/**
 * Derives one physics cell's collider descriptors from the same placement
 * math the renderer uses (computeScatterInstanceMatrix), so a collider is
 * never in a different spot than the mesh it belongs to. Species with no
 * `collider` definition yield an empty list — pebble-scale clutter never
 * gets physics, per docs/runbook/005_scatter_sublibrary.md.
 */
export function buildScatterColliderDescriptors(
  options: IBuildScatterColliderDescriptorsOptions,
): IScatterCellColliderDescriptors {
  const collider = options.species.collider;
  if (!collider) {
    return { cellKey: options.cellKey, anchorWorldM: options.anchorWorldM, descriptors: [] };
  }

  const instances = options.overlay
    ? filterRemovedScatterInstances(options.instances, options.overlay)
    : options.instances;

  const descriptors: IScatterColliderDescriptor[] = [];
  for (const instance of instances) {
    const matrix = computeScatterInstanceMatrix(
      instance,
      options.species.placement,
      options.scale,
      options.anchorWorldM,
    );
    matrix.decompose(scratchPosition, scratchQuaternion, scratchScale);

    descriptors.push({
      instanceId: instance.instanceId,
      speciesId: options.species.id,
      anchorRelativePositionM: [scratchPosition.x, scratchPosition.y, scratchPosition.z],
      rotation: [scratchQuaternion.x, scratchQuaternion.y, scratchQuaternion.z, scratchQuaternion.w],
      shape: collider.shape,
      params: collider.params.map((param) => param * scratchScale.x),
      impactThresholdNs: collider.impactThresholdNs,
    });
  }

  return { cellKey: options.cellKey, anchorWorldM: options.anchorWorldM, descriptors };
}
