import {
  averageImages,
  linearToSrgb,
  srgbToLinear,
  blockMeanRmsDifference,
  blockResidualRms,
  maxBandErrorStep,
  meanAbsoluteErrorChange,
  maxBandMeanDifference,
  meanAbsoluteDifference,
  rowBandMeans,
  toLuminance,
  type ILuminanceImage,
} from './water-lod-spike-image-metrics';

function image(width: number, height: number, value: (x: number, y: number) => number): ILuminanceImage {
  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) values[y * width + x] = value(x, y);
  return { width, height, values };
}

const ALL = { start: 0, end: 16 };

describe('water LOD spike image measures', () => {
  it('converts RGBA bytes to Rec. 709 luminance', () => {
    const lum = toLuminance([255, 255, 255, 255, 255, 0, 0, 255], 2, 1);
    expect(lum.values[0]).toBeCloseTo(255, 3);
    expect(lum.values[1]).toBeCloseTo(0.2126 * 255, 3);
  });

  it('round-trips the sRGB transfer', () => {
    for (const v of [0, 1, 10, 100, 200, 255]) expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 3);
  });

  it('averages images in linear light, so black and white make 187.5, not 127.5', () => {
    const mean = averageImages([image(2, 1, () => 0), image(2, 1, () => 255)]);
    expect(mean.values[0]).toBeCloseTo(187.5, 0);
    const same = averageImages([image(2, 1, () => 77), image(2, 1, () => 77)]);
    expect(same.values[0]).toBeCloseTo(77, 3);
  });

  it('measures shimmer as the mean absolute change, only in the given rows', () => {
    const a = image(4, 16, (x, y) => (y < 8 ? 0 : 100));
    const b = image(4, 16, (x, y) => (y < 8 ? 50 : 100));
    expect(meanAbsoluteDifference(a, b, { start: 0, end: 8 })).toBe(50);
    expect(meanAbsoluteDifference(a, b, { start: 8, end: 16 })).toBe(0);
  });

  it('a pixel checkerboard has no moiré against its mean, a block pattern does', () => {
    const reference = image(16, 16, () => 187.5);
    const checker = image(16, 16, (x, y) => ((x + y) % 2 ? 255 : 0));
    const stripes = image(16, 16, (x) => (Math.floor(x / 8) % 2 ? 255 : 0));
    expect(blockMeanRmsDifference(checker, reference, ALL, 8)).toBeLessThan(1);
    expect(blockMeanRmsDifference(stripes, reference, ALL, 8)).toBeGreaterThan(60);
  });

  it('band means run from the first row of the range and average in linear light', () => {
    const halves = image(4, 16, (x, y) => (y < 8 ? 100 : 200));
    const [far, near] = rowBandMeans(halves, ALL, 2);
    expect(far).toBeCloseTo(100, 3);
    expect(near).toBeCloseTo(200, 3);
    const mixed = image(4, 16, (x, y) => (y % 2 ? 255 : 0));
    expect(rowBandMeans(mixed, ALL, 1)[0]).toBeCloseTo(187.5, 0);
  });

  it('colour step is the largest band difference', () => {
    const reference = image(4, 16, () => 100);
    const farDarker = image(4, 16, (x, y) => (y < 4 ? 90 : 100));
    expect(maxBandMeanDifference(farDarker, reference, ALL, 4)).toBeCloseTo(10, 4);
    expect(maxBandMeanDifference(reference, reference, ALL, 4)).toBe(0);
  });

  it('error change cancels detail that moves with the shift and keeps flicker', () => {
    const referenceA = image(4, 16, (x) => (x % 2 ? 200 : 100));
    const referenceB = image(4, 16, (x) => (x % 2 ? 100 : 200));
    expect(meanAbsoluteErrorChange(referenceA, referenceA, referenceB, referenceB, ALL)).toBe(0);
    const flicker = image(4, 16, (x, y) => (x % 2 ? 200 : 100) + (y % 2 ? 20 : 0));
    expect(meanAbsoluteErrorChange(flicker, referenceA, referenceA, referenceA, ALL)).toBeCloseTo(10, 3);
  });

  it('band error step ignores a smooth bias and finds a seam', () => {
    const reference = image(4, 32, () => 100);
    const bias = image(4, 32, (x, y) => 100 + y / 8);
    const seam = image(4, 32, (x, y) => (y < 16 ? 100 : 110));
    expect(maxBandErrorStep(bias, reference, { start: 0, end: 32 }, 8)).toBeLessThan(0.6);
    expect(maxBandErrorStep(seam, reference, { start: 0, end: 32 }, 8)).toBeGreaterThan(9);
  });

  it('block residual ignores a row bias and finds structure along the row', () => {
    const reference = image(16, 16, () => 100);
    const rowBias = image(16, 16, (x, y) => 100 + y);
    const structure = image(16, 16, (x) => (x < 8 ? 90 : 110));
    expect(blockResidualRms(rowBias, reference, ALL, 8)).toBeLessThan(0.1);
    expect(blockResidualRms(structure, reference, ALL, 8)).toBeGreaterThan(9);
  });
});
