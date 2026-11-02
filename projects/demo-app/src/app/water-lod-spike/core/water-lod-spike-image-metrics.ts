/**
 * Image measures for the W0b aliasing suite, on luminance images read back from the canvas. Pure functions over
 * arrays, so the spec can check them on synthetic images. Luminance is in 0..255 (sRGB bytes, Rec. 709 weights).
 *
 * Every measure takes a row range: the suite passes the water rows (from just below the horizon to the bottom), so the
 * flat background never dilutes a value.
 *
 * Averages (the supersampled reference, block and band means) are taken in linear light and re-encoded, the way a
 * display or a multisampled resolve combines subpixel samples. Averaging the encoded bytes would make any bright and
 * dark mix look darker than it is, which is exactly what far water is.
 */
export interface ILuminanceImage {
  readonly width: number;
  readonly height: number;
  readonly values: Float32Array;
}

export interface IRowRange {
  readonly start: number;
  readonly end: number;
}

/** sRGB transfer: encoded 0..255 to linear 0..1. */
export function srgbToLinear(encoded: number): number {
  const v = encoded / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** sRGB transfer: linear 0..1 to encoded 0..255. */
export function linearToSrgb(linear: number): number {
  const v = Math.min(1, Math.max(0, linear));
  return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
}

/** Mean of encoded values taken in linear light, returned encoded. */
function encodedMean(sumLinear: number, count: number): number {
  return linearToSrgb(sumLinear / Math.max(1, count));
}

/** Luminance of an RGBA byte image. */
export function toLuminance(rgba: ArrayLike<number>, width: number, height: number): ILuminanceImage {
  const values = new Float32Array(width * height);
  for (let i = 0; i < values.length; i++) {
    values[i] = 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
  }
  return { width, height, values };
}

/** Per-pixel mean of several images of the same size, in linear light (the supersampled reference). */
export function averageImages(images: readonly ILuminanceImage[]): ILuminanceImage {
  const { width, height } = images[0];
  const sums = new Float32Array(width * height);
  for (const image of images) for (let i = 0; i < sums.length; i++) sums[i] += srgbToLinear(image.values[i]);
  const values = new Float32Array(sums.length);
  for (let i = 0; i < values.length; i++) values[i] = encodedMean(sums[i], images.length);
  return { width, height, values };
}

/**
 * Shimmer: mean absolute luminance change between two frames of the same view a sub-pixel apart. Aliased detail jumps
 * by whole levels when the sampling grid shifts; filtered detail moves by a fraction.
 */
export function meanAbsoluteDifference(a: ILuminanceImage, b: ILuminanceImage, rows: IRowRange): number {
  let sum = 0;
  let count = 0;
  for (let y = rows.start; y < rows.end; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = y * a.width + x;
      sum += Math.abs(a.values[i] - b.values[i]);
      count++;
    }
  }
  return count ? sum / count : 0;
}

/**
 * Moiré: RMS difference of `block` x `block` pixel means (linear light) between a frame and the reference. Block means discard the
 * fine detail a single frame cannot show anyway, so what is left is false low-frequency structure (rings, grids, bands).
 */
export function blockMeanRmsDifference(a: ILuminanceImage, reference: ILuminanceImage, rows: IRowRange, block: number): number {
  let sumSquares = 0;
  let blocks = 0;
  for (let y0 = rows.start; y0 + block <= rows.end; y0 += block) {
    for (let x0 = 0; x0 + block <= a.width; x0 += block) {
      let sumA = 0;
      let sumReference = 0;
      for (let y = y0; y < y0 + block; y++) {
        for (let x = x0; x < x0 + block; x++) {
          const i = y * a.width + x;
          sumA += srgbToLinear(a.values[i]);
          sumReference += srgbToLinear(reference.values[i]);
        }
      }
      const difference = encodedMean(sumA, block * block) - encodedMean(sumReference, block * block);
      sumSquares += difference * difference;
      blocks++;
    }
  }
  return blocks ? Math.sqrt(sumSquares / blocks) : 0;
}

/** Mean luminance (linear light, encoded) in `bands` equal row bands, first band at `rows.start` (the far water next to the horizon). */
export function rowBandMeans(image: ILuminanceImage, rows: IRowRange, bands: number): number[] {
  const means: number[] = [];
  const span = (rows.end - rows.start) / bands;
  for (let band = 0; band < bands; band++) {
    const start = Math.round(rows.start + band * span);
    const end = Math.round(rows.start + (band + 1) * span);
    let sum = 0;
    for (let y = start; y < end; y++) for (let x = 0; x < image.width; x++) sum += srgbToLinear(image.values[y * image.width + x]);
    means.push(encodedMean(sum, (end - start) * image.width));
  }
  return means;
}

/** Colour step: the largest band-mean difference between a frame and the reference. */
export function maxBandMeanDifference(a: ILuminanceImage, reference: ILuminanceImage, rows: IRowRange, bands: number): number {
  const frame = rowBandMeans(a, rows, bands);
  const truth = rowBandMeans(reference, rows, bands);
  return Math.max(...frame.map((mean, band) => Math.abs(mean - truth[band])));
}

/**
 * Shimmer as the change of the error against the reference between two sub-pixel-shifted views:
 * mean |(a - refA) - (b - refB)|. Detail that really moves with the shift (resolved waves) is in the reference too and
 * cancels; what is left is the aliasing flicker of the frame itself.
 */
export function meanAbsoluteErrorChange(
  a: ILuminanceImage,
  referenceA: ILuminanceImage,
  b: ILuminanceImage,
  referenceB: ILuminanceImage,
  rows: IRowRange,
): number {
  let sum = 0;
  let count = 0;
  for (let y = rows.start; y < rows.end; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = y * a.width + x;
      sum += Math.abs(a.values[i] - referenceA.values[i] - (b.values[i] - referenceB.values[i]));
      count++;
    }
  }
  return count ? sum / count : 0;
}

/**
 * Colour step: the largest change of the band-mean error (frame minus reference, linear-light means) between
 * neighbouring row bands. A smooth bias gives a small step per band; a seam where the near and far forms meet gives a
 * large one.
 */
export function maxBandErrorStep(a: ILuminanceImage, reference: ILuminanceImage, rows: IRowRange, bands: number): number {
  const frame = rowBandMeans(a, rows, bands);
  const truth = rowBandMeans(reference, rows, bands);
  let step = 0;
  for (let band = 1; band < bands; band++) {
    step = Math.max(step, Math.abs(frame[band] - truth[band] - (frame[band - 1] - truth[band - 1])));
  }
  return step;
}

/**
 * Moiré: RMS of the `block` x `block` mean error (frame minus reference, linear light) after removing each block row's
 * mean error. A smooth bias along the distance cancels; false structure across the view and fine bands do not.
 */
export function blockResidualRms(a: ILuminanceImage, reference: ILuminanceImage, rows: IRowRange, block: number): number {
  let sumSquares = 0;
  let blocks = 0;
  for (let y0 = rows.start; y0 + block <= rows.end; y0 += block) {
    const errors: number[] = [];
    for (let x0 = 0; x0 + block <= a.width; x0 += block) {
      let sumA = 0;
      let sumReference = 0;
      for (let y = y0; y < y0 + block; y++) {
        for (let x = x0; x < x0 + block; x++) {
          const i = y * a.width + x;
          sumA += srgbToLinear(a.values[i]);
          sumReference += srgbToLinear(reference.values[i]);
        }
      }
      errors.push(encodedMean(sumA, block * block) - encodedMean(sumReference, block * block));
    }
    const mean = errors.reduce((total, value) => total + value, 0) / Math.max(1, errors.length);
    for (const error of errors) sumSquares += (error - mean) * (error - mean);
    blocks += errors.length;
  }
  return blocks ? Math.sqrt(sumSquares / blocks) : 0;
}
