import { buildCloudPuffGeometryVariants } from '../cloud-puff-geometry';
import type { ICloudPuffStyle } from './cloud-puff-style';

/** The original spike look: a flat-shaded, noise-displaced icosphere. Rounded, faceted silhouette. */
export const LOW_POLY_BLOB_STYLE: ICloudPuffStyle = {
  id: 'low-poly-blob',
  label: 'Low-poly blob',
  description: 'Flat-shaded displaced icosphere — rounded, faceted silhouette.',
  buildGeometryVariants: (variantParams, context) =>
    buildCloudPuffGeometryVariants(variantParams, context.detail, context.shading),
};
