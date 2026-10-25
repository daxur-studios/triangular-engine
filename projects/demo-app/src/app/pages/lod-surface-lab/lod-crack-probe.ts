/**
 * Plan 059 crack probe, counting half. The page draws, into an offscreen target: first a backstop that lies inside the
 * surface (a smaller sphere, or the square below the lowest height, drawn without depth so it is always under), then
 * the surface itself. Every backstop pixel left on screen is a hole in the surface. Pixels next to the background are
 * masked: there the backstop can show past the outline without a hole.
 *
 * Values in the red channel: 0 background, {@link BACKSTOP_VALUE} backstop, 255 surface.
 */

export const BACKSTOP_VALUE = 128;

export interface CrackCount {
  /** Backstop pixels with no background pixel among their eight neighbours. */
  readonly cracks: number;
  /** Backstop pixels next to the background (not counted). */
  readonly masked: number;
  readonly surface: number;
  readonly background: number;
}

type Kind = 0 | 1 | 2;

function kindOf(red: number): Kind {
  if (red < BACKSTOP_VALUE / 2) return 0;
  return red < (BACKSTOP_VALUE + 255) / 2 ? 1 : 2;
}

/** Counts from RGBA8 pixels (any row order; neighbours are symmetric). */
export function countCracks(rgba: ArrayLike<number>, width: number, height: number): CrackCount {
  const kinds = new Uint8Array(width * height);
  let surface = 0;
  let background = 0;
  for (let p = 0; p < width * height; p++) {
    const kind = kindOf(rgba[p * 4]);
    kinds[p] = kind;
    if (kind === 2) surface++;
    else if (kind === 0) background++;
  }
  let cracks = 0;
  let masked = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (kinds[y * width + x] !== 1) continue;
      let nearBackground = false;
      for (let dy = -1; dy <= 1 && !nearBackground; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < width && kinds[ny * width + nx] === 0) {
            nearBackground = true;
            break;
          }
        }
      }
      if (nearBackground) masked++;
      else cracks++;
    }
  }
  return { cracks, masked, surface, background };
}
