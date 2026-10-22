import { predictView, type CheckFrame, type CheckFrames } from './atmosphere-lab-image-checks';
import type { AtmosphereLabState } from './atmosphere-lab-tests';

export interface SyntheticDefects {
  /** Luma of every predicted sky cell (default a lit 0.6; 0 is a black sky). */
  readonly sky?: number;
  readonly ground?: number;
  /** Rows just under each predicted horizon that are black, as a band of unlit sky would be. */
  readonly bandRows?: number;
  /** Cells left sentinel in the coverage frame (each worth one cell of area). */
  readonly uncoveredCells?: number;
  readonly airTopM?: number;
}

const frameOf = (width: number, height: number, luma: (cell: number) => number): CheckFrame => {
  const cells = width * height;
  const lumaMean = new Float32Array(cells);
  const rgba = new Uint8ClampedArray(cells * 4);
  for (let c = 0; c < cells; c++) {
    lumaMean[c] = luma(c);
    rgba.fill(Math.round(lumaMean[c] * 255), c * 4, c * 4 + 3);
    rgba[c * 4 + 3] = 255;
  }
  return { width, height, sourceWidth: width * 6, sourceHeight: height * 6, lumaMean, lumaMin: lumaMean.slice(), sentinel: new Float32Array(cells), rgba };
};

/**
 * The frames a correct renderer would give for `state`: the CPU prediction painted with a lit sky and a mid-grey ground, no
 * sentinel left in the coverage frame. Defects are added on top, so a spec shows each check catching the one thing wrong.
 */
export function syntheticFrames(
  state: AtmosphereLabState, defects: SyntheticDefects = {}, width = 64, height = 48,
): CheckFrames {
  const airTopM = defects.airTopM ?? 285_000;
  const prediction = predictView(state, airTopM, width, height);
  const lumaOf = (cell: number) => prediction.surface[cell] === 'sky' ? (defects.sky ?? 0.6) : (defects.ground ?? 0.3);
  const normal = frameOf(width, height, lumaOf);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height - 1; y++) {
      if (prediction.surface[y * width + x] !== 'sky' || prediction.surface[(y + 1) * width + x] !== 'ground') continue;
      for (let r = 1; r <= (defects.bandRows ?? 0) && y + r < height; r++) {
        normal.lumaMean[(y + r) * width + x] = 0;
        normal.lumaMin[(y + r) * width + x] = 0;
      }
    }
  }
  const coverage = frameOf(width, height, () => 0);
  for (let c = 0; c < (defects.uncoveredCells ?? 0); c++) coverage.sentinel[c] = 1;
  return { normal, coverage, airTopM };
}
