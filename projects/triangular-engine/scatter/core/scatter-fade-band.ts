/**
 * Distance bands from an object's size, for instances that hand over to a far
 * form (a surface-material layer or an impostor) instead of thinning out.
 * The band depends only on size and screen resolution, so every object class
 * gets its own band from one rule.
 */

/** When an object is worth drawing as an instance, in screen pixels of its size. */
export interface IScatterPixelFadeRule {
  /** One pixel spans this fraction of the viewing distance (0.001 is about 1080p at a 60° vertical field of view). */
  readonly pixelPerDistance: number;
  /** The instance is fully shown while it covers at least this many pixels... */
  readonly startPixels: number;
  /** ...and fully handed over to the far form at this many. */
  readonly endPixels: number;
}

/** 1080p at a 60° vertical field of view: instances fade from 12 px down to 4 px. */
export const DEFAULT_SCATTER_PIXEL_FADE_RULE: IScatterPixelFadeRule = {
  pixelPerDistance: 0.001,
  startPixels: 12,
  endPixels: 4,
};

/** Camera distances (metres) over which an instance fades out. */
export interface IScatterFadeBand {
  readonly startM: number;
  readonly endM: number;
}

/**
 * The fade band of an object `sizeM` metres across: it starts where the
 * object covers `startPixels` and ends where it covers `endPixels`.
 */
export function computeScatterPixelFadeBand(
  sizeM: number,
  rule: IScatterPixelFadeRule = DEFAULT_SCATTER_PIXEL_FADE_RULE,
): IScatterFadeBand {
  if (!(sizeM > 0) || !(rule.pixelPerDistance > 0) || !(rule.startPixels > rule.endPixels) || !(rule.endPixels > 0)) {
    throw new RangeError('Scatter pixel fade band needs sizeM > 0 and startPixels > endPixels > 0.');
  }
  return {
    startM: sizeM / (rule.startPixels * rule.pixelPerDistance),
    endM: sizeM / (rule.endPixels * rule.pixelPerDistance),
  };
}

/**
 * Radius of an instance window that still holds everything the camera can see
 * of a class: the end of its fade band plus twice the drift allowed before the
 * window is re-requested (the camera may sit at the edge of the old window
 * while the new one is in flight), rounded up to `roundToM`.
 */
export function computeScatterWindowRadiusM(fadeEndM: number, recentreM: number, roundToM = 100): number {
  return Math.ceil((fadeEndM + 2 * recentreM) / roundToM) * roundToM;
}
