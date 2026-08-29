import { CARD_STACK_STYLE } from './card-stack-style';
import { LOW_POLY_BLOB_STYLE } from './low-poly-blob-style';
import type { ICloudPuffStyle } from './cloud-puff-style';

/** All available puff styles, in the order they should be offered in a picker. */
export const CLOUD_PUFF_STYLES: readonly ICloudPuffStyle[] = [
  LOW_POLY_BLOB_STYLE,
  CARD_STACK_STYLE,
];

export const DEFAULT_CLOUD_PUFF_STYLE_ID: string = LOW_POLY_BLOB_STYLE.id;

export function getCloudPuffStyleById(id: string): ICloudPuffStyle {
  return CLOUD_PUFF_STYLES.find((style) => style.id === id) ?? LOW_POLY_BLOB_STYLE;
}
