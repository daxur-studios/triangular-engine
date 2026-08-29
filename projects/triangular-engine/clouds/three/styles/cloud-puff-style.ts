import type { BufferGeometry } from 'three';

import type { ICloudPuffVariantParams } from '../../core/cloud-puff-shape';
import type { CloudPuffShading } from '../cloud-puff-geometry';

export interface ICloudPuffStyleContext {
  readonly detail: number;
  readonly shading: CloudPuffShading;
}

/**
 * A pluggable puff "look": turns a pool of deterministic shape-variant params into geometry.
 * Every style shares the same material/instancing/lighting — only the mesh construction differs,
 * so new looks can be dropped in and compared side by side without touching the rest of the stack.
 */
export interface ICloudPuffStyle {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  buildGeometryVariants(
    variantParams: readonly ICloudPuffVariantParams[],
    context: ICloudPuffStyleContext,
  ): BufferGeometry[];
}
