import { computeClearanceWindow } from './nav-clearance';
import { NavFlag } from './nav-flags';

function brute(flags: Uint8Array, w: number, h: number, cap: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = Infinity;
      for (let by = 0; by < h; by++) {
        for (let bx = 0; bx < w; bx++) {
          if (flags[by * w + bx] & NavFlag.BLOCKED) best = Math.min(best, (bx - x) ** 2 + (by - y) ** 2);
        }
      }
      out[y * w + x] = best === Infinity ? cap : Math.min(cap, Math.floor(Math.sqrt(best)));
    }
  }
  return out;
}

describe('computeClearanceWindow', () => {
  let seed = 99;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  it('matches a brute-force Euclidean transform on random grids', () => {
    for (const density of [0.02, 0.1, 0.5]) {
      const w = 37;
      const h = 29;
      const flags = new Uint8Array(w * h);
      for (let i = 0; i < flags.length; i++) flags[i] = rnd() < density ? NavFlag.BLOCKED : 0;
      for (const cap of [3, 16]) {
        const out = new Uint8Array(w * h);
        computeClearanceWindow(flags, w, h, { x: 0, y: 0, width: w, height: h }, cap, out);
        expect(Array.from(out)).toEqual(Array.from(brute(flags, w, h, cap)));
      }
    }
  });

  it('gives a window the same values as the full transform and writes nothing outside it', () => {
    const w = 60;
    const h = 50;
    const flags = new Uint8Array(w * h);
    for (let i = 0; i < flags.length; i++) flags[i] = rnd() < 0.03 ? NavFlag.BLOCKED : 0;
    const full = new Uint8Array(w * h);
    computeClearanceWindow(flags, w, h, { x: 0, y: 0, width: w, height: h }, 16, full);
    const part = new Uint8Array(w * h).fill(77);
    computeClearanceWindow(flags, w, h, { x: 20, y: 15, width: 12, height: 9 }, 16, part);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const inside = x >= 20 && x < 32 && y >= 15 && y < 24;
        expect(part[y * w + x]).toBe(inside ? full[y * w + x] : 77);
      }
    }
  });

  it('saturates at the cap when nothing is blocked', () => {
    const out = new Uint8Array(100);
    computeClearanceWindow(new Uint8Array(100), 10, 10, { x: 0, y: 0, width: 10, height: 10 }, 5, out);
    expect(Array.from(new Set(out))).toEqual([5]);
  });
});
