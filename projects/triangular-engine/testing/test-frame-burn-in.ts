/** Largest frame number the burned-in strip can carry (16 bits). */
export const MAX_BURN_IN_FRAME = 2 ** 16 - 1;

/** Bits in the frame number. The strip also has one sync cell, which is always white. */
const BURN_IN_BITS = 16;
const CELL_PX = 10;
const MARGIN_PX = 8;

/** Where the strip is drawn: `cell` is the side of one black or white block, `x`/`y` its top-left corner. */
export interface FrameBurnInLayout {
  readonly cell: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The strip layout for a frame of `width` x `height` pixels: a sync cell and then 16 bits of the frame number, most
 * significant first, in the bottom-right corner. Hosts and readers use the same layout, so this is the one source of truth.
 */
export function frameBurnInLayout(width: number, height: number): FrameBurnInLayout {
  const cells = BURN_IN_BITS + 1;
  return { cell: CELL_PX, x: width - MARGIN_PX - cells * CELL_PX, y: height - MARGIN_PX - CELL_PX, width: cells * CELL_PX, height: CELL_PX };
}

/**
 * Burns a frame number into a recorded frame: a readable `shot · f0096` label in the bottom-left corner and a machine-readable
 * black/white strip in the bottom-right corner (see {@link frameBurnInLayout}). Draw it last, after the host's own overlays.
 * `frame` must be an integer from 0 to {@link MAX_BURN_IN_FRAME}.
 */
export function drawFrameBurnIn(paint: CanvasRenderingContext2D, frame: number, options: { readonly shot?: string; readonly width: number; readonly height: number }): void {
  if (!Number.isInteger(frame) || frame < 0 || frame > MAX_BURN_IN_FRAME) throw new RangeError(`Frame ${frame} cannot be burned in: use 0 to ${MAX_BURN_IN_FRAME}`);
  const layout = frameBurnInLayout(options.width, options.height);
  const boxLeft = layout.x - 4;
  const boxTop = layout.y - 4;
  paint.fillStyle = 'rgba(0, 0, 0, 0.9)';
  paint.fillRect(boxLeft, boxTop, layout.width + 8, layout.height + 8);
  paint.fillStyle = '#ffffff';
  paint.fillRect(layout.x, layout.y, layout.cell, layout.cell);
  for (let bit = 0; bit < BURN_IN_BITS; bit++) {
    if (!((frame >> (BURN_IN_BITS - 1 - bit)) & 1)) continue;
    paint.fillRect(layout.x + (bit + 1) * layout.cell, layout.y, layout.cell, layout.cell);
  }
  const text = `${options.shot ? `${options.shot} · ` : ''}f${String(frame).padStart(4, '0')}`;
  paint.font = 'bold 16px sans-serif';
  const textWidth = paint.measureText(text).width;
  paint.fillStyle = 'rgba(0, 0, 0, 0.55)';
  paint.fillRect(MARGIN_PX - 2, options.height - 34, textWidth + 12, 26);
  paint.fillStyle = '#ffffff';
  paint.fillText(text, MARGIN_PX + 4, options.height - 14);
}

/**
 * Reads the frame number from a decoded frame. `luma(x, y)` returns the 0-255 brightness of a pixel. Returns `undefined`
 * when the sync cell is not white, which means this frame carries no burn-in (a blank or foreign frame).
 */
export function readFrameBurnIn(luma: (x: number, y: number) => number, width: number, height: number): number | undefined {
  const layout = frameBurnInLayout(width, height);
  const sample = (cell: number) => luma(layout.x + cell * layout.cell + layout.cell / 2, layout.y + layout.cell / 2);
  if (sample(0) < 128) return undefined;
  let frame = 0;
  for (let bit = 0; bit < BURN_IN_BITS; bit++) frame = frame * 2 + (sample(bit + 1) >= 128 ? 1 : 0);
  return frame;
}
