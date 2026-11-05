import { drawFrameBurnIn, frameBurnInLayout, MAX_BURN_IN_FRAME, readFrameBurnIn } from './test-frame-burn-in';

const WIDTH = 640;
const HEIGHT = 360;

function burned(frame: number, shot = 'shoreline'): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const paint = canvas.getContext('2d')!;
  paint.fillStyle = '#336699';
  paint.fillRect(0, 0, WIDTH, HEIGHT);
  drawFrameBurnIn(paint, frame, { shot, width: WIDTH, height: HEIGHT });
  return paint;
}

/** Reads brightness from the canvas the way a decoded frame would be read: one pixel at a time, from the frame's own pixels. */
function lumaOf(paint: CanvasRenderingContext2D): (x: number, y: number) => number {
  const data = paint.getImageData(0, 0, WIDTH, HEIGHT).data;
  return (x, y) => {
    const at = (Math.floor(y) * WIDTH + Math.floor(x)) * 4;
    return 0.299 * data[at] + 0.587 * data[at + 1] + 0.114 * data[at + 2];
  };
}

describe('frame burn-in', () => {
  it('keeps the strip inside the frame, in the bottom-right corner', () => {
    const layout = frameBurnInLayout(WIDTH, HEIGHT);
    expect(layout.cell).toBeGreaterThan(0);
    expect(layout.x).toBeGreaterThan(WIDTH / 2);
    expect(layout.x + layout.width).toBeLessThanOrEqual(WIDTH);
    expect(layout.y + layout.height).toBeLessThanOrEqual(HEIGHT);
  });

  it('reads back the frame number that was burned in, at the edges and in the middle of the range', () => {
    for (const frame of [0, 1, 96, 1234, MAX_BURN_IN_FRAME]) {
      const paint = burned(frame);
      expect(readFrameBurnIn(lumaOf(paint), WIDTH, HEIGHT)).toBe(frame);
    }
  });

  it('reads nothing from a frame with no burn-in, so a blank or foreign frame is not mistaken for a numbered one', () => {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const blank = canvas.getContext('2d')!;
    blank.fillStyle = '#000000';
    blank.fillRect(0, 0, WIDTH, HEIGHT);
    expect(readFrameBurnIn(lumaOf(blank), WIDTH, HEIGHT)).toBeUndefined();
  });

  it('refuses frame numbers the strip cannot carry', () => {
    const paint = burned(0);
    expect(() => drawFrameBurnIn(paint, -1, { width: WIDTH, height: HEIGHT })).toThrowError(RangeError);
    expect(() => drawFrameBurnIn(paint, MAX_BURN_IN_FRAME + 1, { width: WIDTH, height: HEIGHT })).toThrowError(RangeError);
    expect(() => drawFrameBurnIn(paint, 1.5, { width: WIDTH, height: HEIGHT })).toThrowError(RangeError);
  });
});
