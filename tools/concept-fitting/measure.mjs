// Measures face landmarks on the concept crops listed in a manifest: eye circles, pupil centres,
// head side edges and mouth corners. Pixels are classified by colour, shapes are fitted to the
// classified regions, and the result is written as a measured spec in crop pixels and head-width
// units, with one overlay board for the developer to approve or correct.
//
//   node tools/concept-fitting/measure.mjs --source-dir <folder> [--manifest <file>] [--out <dir>]
//
// The source folder may also come from the CONCEPT_SOURCE_DIR environment variable. Developer
// corrections go in an overrides file next to the manifest (<name>.overrides.json). An override
// replaces the measured landmark of one crop and is never re-estimated.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { findSourceByHash, sha256, validateManifest } from './crop-board.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** RGB distance from the border colour within which a pixel can belong to the background. */
export const BACKGROUND_TOLERANCE = 9;

/**
 * RMS distance in pixels of rim points from a fitted eye circle above which the fit is flagged.
 * Clean eyes on the first sheet fit at 0.9 to 1.4 px, because the rim is a soft shaded band.
 */
export const RIM_RESIDUAL_LIMIT = 2;

export const CLASS = { background: 0, skin: 1, eyeWhite: 2, dark: 3, hair: 4, lip: 5, other: 6 };

const round = (value) => Math.round(value * 100) / 100;

// ---------------------------------------------------------------------------------------------
// Pixels and masks

/** Per-pixel colour channels and hue, saturation and value of an RGB buffer. */
export function decode(data, width, height, channels = 3) {
  const n = width * height;
  const r = new Uint8Array(n), g = new Uint8Array(n), b = new Uint8Array(n);
  const hue = new Float32Array(n), sat = new Float32Array(n), val = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const R = data[i * channels], G = data[i * channels + 1], B = data[i * channels + 2];
    r[i] = R; g[i] = G; b[i] = B;
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn;
    val[i] = mx;
    sat[i] = mx ? d / mx : 0;
    let h = 0;
    if (d) h = mx === R ? 60 * (((G - B) / d) % 6) : mx === G ? 60 * ((B - R) / d + 2) : 60 * ((R - G) / d + 4);
    hue[i] = (h + 360) % 360;
  }
  return { width, height, r, g, b, hue, sat, val };
}

function median(values) {
  const sorted = Float64Array.from(values).sort();
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
}

function neighbours4(i, w, h) {
  const x = i % w, y = (i - x) / w;
  return [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
}

/** Labels 4-connected components of a mask; returns labels (0 = none) and per-label pixel lists. */
export function components(mask, width, height) {
  const labels = new Int32Array(width * height);
  const pixels = [null];
  const stack = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const label = pixels.length;
    const list = [];
    labels[start] = label;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop();
      list.push(i);
      for (const j of neighbours4(i, width, height)) if (j >= 0 && mask[j] && !labels[j]) { labels[j] = label; stack.push(j); }
    }
    list.sort((a, b) => a - b);
    pixels.push(list);
  }
  return { labels, pixels };
}

/** Returns a copy of the mask with every region not connected to the image border filled in. */
export function fillHoles(mask, width, height) {
  const outside = new Uint8Array(mask.length);
  const stack = [];
  const seed = (i) => { if (!mask[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1); }
  while (stack.length) {
    const i = stack.pop();
    for (const j of neighbours4(i, width, height)) if (j >= 0) seed(j);
  }
  const filled = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) filled[i] = outside[i] ? 0 : 1;
  return filled;
}

function morph(mask, width, height, keepIfAll) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let all = true, any = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          const v = xx >= 0 && yy >= 0 && xx < width && yy < height ? mask[yy * width + xx] : 0;
          if (v) any = true; else all = false;
        }
      }
      out[y * width + x] = (keepIfAll ? all : any) ? 1 : 0;
    }
  }
  return out;
}

/** Morphological opening with a 3x3 square repeated `radius` times; removes thin lines. */
export function open(mask, width, height, radius = 2) {
  let m = mask;
  for (let k = 0; k < radius; k++) m = morph(m, width, height, true);
  for (let k = 0; k < radius; k++) m = morph(m, width, height, false);
  return m;
}

function edt1d(f, n) {
  const d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    while (true) {
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      if (s > z[k] || k === 0) break;
      k--;
    }
    if (s <= z[k]) { v[0] = q; z[0] = -Infinity; z[1] = Infinity; k = 0; continue; }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
  return d;
}

/** Euclidean distance from each mask pixel to the nearest pixel outside the mask (0 outside). */
export function distanceInside(mask, width, height) {
  const big = (width + height) ** 2;
  const grid = new Float64Array(mask.length);
  for (let i = 0; i < mask.length; i++) grid[i] = mask[i] ? big : 0;
  const col = new Float64Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) col[y] = grid[y * width + x];
    const d = edt1d(col, height);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y];
  }
  const row = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) row[x] = grid[y * width + x];
    const d = edt1d(row, width);
    for (let x = 0; x < width; x++) grid[y * width + x] = Math.sqrt(d[x]);
  }
  return grid;
}

// ---------------------------------------------------------------------------------------------
// Classification

/**
 * Classifies every pixel. The background is grown from the crop border over pixels close to the
 * border's median colour, so eye whites, which are nearly the background colour, stay foreground
 * where the shading around their rim separates them. Only the largest foreground region is kept,
 * because neighbouring heads on the sheet can reach into the crop.
 */
export function segment(img) {
  const { width: w, height: h } = img;
  const n = w * h;
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  const bg = [median(border.map((i) => img.r[i])), median(border.map((i) => img.g[i])), median(border.map((i) => img.b[i]))];
  const near = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const dr = img.r[i] - bg[0], dg = img.g[i] - bg[1], db = img.b[i] - bg[2];
    near[i] = dr * dr + dg * dg + db * db < BACKGROUND_TOLERANCE * BACKGROUND_TOLERANCE ? 1 : 0;
  }
  const background = new Uint8Array(n);
  const stack = border.filter((i) => near[i]);
  for (const i of stack) background[i] = 1;
  while (stack.length) {
    const i = stack.pop();
    for (const j of neighbours4(i, w, h)) if (j >= 0 && near[j] && !background[j]) { background[j] = 1; stack.push(j); }
  }
  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) fg[i] = background[i] ? 0 : 1;
  const { labels, pixels } = components(fg, w, h);
  let best = 1;
  for (let l = 2; l < pixels.length; l++) if (pixels[l].length > pixels[best].length) best = l;
  const cls = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (labels[i] !== best) { cls[i] = CLASS.background; continue; }
    const H = img.hue[i], S = img.sat[i], V = img.val[i];
    if (V < 80 || (V < 135 && S < 0.3)) cls[i] = CLASS.dark;
    else if (S < 0.23 && V > 150) cls[i] = CLASS.eyeWhite;
    else if (S > 0.56 || (V < 175 && S > 0.3)) cls[i] = CLASS.hair;
    else if (H < 17 && S > 0.45 && V > 170) cls[i] = CLASS.lip;
    else if (H >= 8 && H <= 40 && S >= 0.22 && V >= 150) cls[i] = CLASS.skin;
    else cls[i] = CLASS.other;
  }
  return { cls, background: bg, headPixels: pixels[best]?.length ?? 0 };
}

// ---------------------------------------------------------------------------------------------
// Shape fitting

function solve3(m, v) {
  const det = (a) => a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6]);
  const d = det(m);
  if (Math.abs(d) < 1e-12) return null;
  const out = [];
  for (let c = 0; c < 3; c++) {
    const mc = [...m];
    for (let r = 0; r < 3; r++) mc[r * 3 + c] = v[r];
    out.push(det(mc) / d);
  }
  return out;
}

/** Geometric least-squares circle through points, started from an algebraic fit. */
export function fitCircle(points, start) {
  let cx, cy, r;
  if (start) ({ cx, cy, r } = start);
  else {
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sz = 0, sxz = 0, syz = 0;
    for (const [x, y] of points) {
      const z = x * x + y * y;
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sz += z; sxz += x * z; syz += y * z;
    }
    const sol = solve3([sxx, sxy, sx, sxy, syy, sy, sx, sy, points.length], [-sxz, -syz, -sz]);
    if (!sol) return null;
    cx = -sol[0] / 2; cy = -sol[1] / 2; r = Math.sqrt(Math.max(0, cx * cx + cy * cy - sol[2]));
  }
  for (let iter = 0; iter < 8; iter++) {
    const jtj = new Float64Array(9), jtr = new Float64Array(3);
    for (const [x, y] of points) {
      const d = Math.hypot(x - cx, y - cy) || 1e-9;
      const j = [-(x - cx) / d, -(y - cy) / d, -1];
      const res = d - r;
      for (let a = 0; a < 3; a++) {
        jtr[a] += j[a] * res;
        for (let b = 0; b < 3; b++) jtj[a * 3 + b] += j[a] * j[b];
      }
    }
    const step = solve3([...jtj], [-jtr[0], -jtr[1], -jtr[2]]);
    if (!step) break;
    cx += step[0]; cy += step[1]; r += step[2];
    if (Math.abs(step[0]) + Math.abs(step[1]) + Math.abs(step[2]) < 1e-6) break;
  }
  return { cx, cy, r };
}

/**
 * Fits one circle per seed to boundary points. Each point is assigned to the circle whose rim it
 * is nearest, points far inside a circle (lids, hair, a neighbouring eye in front) are dropped as
 * outliers, and the fit repeats. Returns each circle with its RMS residual and angular coverage.
 */
export function fitCircles(points, seeds) {
  let circles = seeds.map((s) => ({ ...s }));
  let assigned = [];
  for (let iter = 0; iter < 12; iter++) {
    assigned = circles.map(() => []);
    for (const p of points) {
      let best = -1, bestRes = Infinity;
      circles.forEach((c, k) => {
        const res = Math.abs(Math.hypot(p[0] - c.cx, p[1] - c.cy) - c.r);
        if (res < bestRes) { bestRes = res; best = k; }
      });
      assigned[best].push(p);
    }
    circles = circles.map((c, k) => {
      const pts = assigned[k];
      if (pts.length < 8) return c;
      const res = pts.map(([x, y]) => Math.hypot(x - c.cx, y - c.cy) - c.r);
      const sigma = 1.4826 * median(res.map(Math.abs));
      const limit = Math.max(1.5, 2.5 * sigma);
      const inliers = pts.filter((_, i) => Math.abs(res[i]) <= limit);
      if (inliers.length < 8) return c;
      return fitCircle(inliers, c) ?? c;
    });
  }
  return circles.map((c, k) => {
    const pts = assigned[k];
    const inliers = pts.filter(([x, y]) => Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r) <= 2);
    const bins = new Set(inliers.map(([x, y]) => Math.floor(((Math.atan2(y - c.cy, x - c.cx) + Math.PI) / (2 * Math.PI)) * 36) % 36));
    const rms = inliers.length ? Math.sqrt(inliers.reduce((s, [x, y]) => s + (Math.hypot(x - c.cx, y - c.cy) - c.r) ** 2, 0) / inliers.length) : Infinity;
    return { ...c, rms, coverage: bins.size / 36, inliers: inliers.length };
  });
}

/**
 * Fits the two side edges of a cylinder as parallel lines x = a + b*y (one shared slope b) to
 * rows of left and right silhouette points, dropping points more than 2 px off and refitting.
 * The shared slope keeps a rounded base or a chamfer on one side from tilting that side's line.
 */
export function fitParallelEdges(rows) {
  const fit = (left, right) => {
    const all = [...left.map((p) => [p[0], p[1], 0]), ...right.map((p) => [p[0], p[1], 1])];
    const mean = (pts, k) => pts.reduce((s, p) => s + p[k], 0) / pts.length;
    const myL = mean(left, 1), mxL = mean(left, 0), myR = mean(right, 1), mxR = mean(right, 0);
    let syy = 0, sxy = 0;
    for (const [x, y, side] of all) {
      const my = side ? myR : myL, mx = side ? mxR : mxL;
      syy += (y - my) ** 2; sxy += (x - mx) * (y - my);
    }
    const b = syy ? sxy / syy : 0;
    return { b, aL: mxL - b * myL, aR: mxR - b * myR };
  };
  let left = rows.map((r) => [r.left, r.y]), right = rows.map((r) => [r.right, r.y]);
  let line = fit(left, right);
  for (let pass = 0; pass < 3; pass++) {
    const keptL = left.filter(([x, y]) => Math.abs(x - (line.aL + line.b * y)) <= 2);
    const keptR = right.filter(([x, y]) => Math.abs(x - (line.aR + line.b * y)) <= 2);
    if (keptL.length < 5 || keptR.length < 5) break;
    left = keptL; right = keptR;
    line = fit(left, right);
  }
  return { ...line, leftRows: left.map((p) => p[1]), rightRows: right.map((p) => p[1]) };
}

// ---------------------------------------------------------------------------------------------
// Landmarks

function centroid(list, w) {
  let sx = 0, sy = 0;
  for (const i of list) { sx += (i % w) + 0.5; sy += Math.floor(i / w) + 0.5; }
  return { x: sx / list.length, y: sy / list.length };
}

function findPupils(cls, w, h, headPixels) {
  const dark = cls.map((c) => (c === CLASS.dark ? 1 : 0));
  const { pixels } = components(dark, w, h);
  const pupils = [];
  for (let l = 1; l < pixels.length; l++) {
    const list = pixels[l];
    if (list.length < 8 || list.length > headPixels * 0.03) continue;
    // The pixels right next to a pupil are dark anti-aliasing and shading, so the test looks at a
    // ring three steps out, which lies on the eye white for a pupil and on skin for lashes or brows.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const i of list) {
      const x = i % w, y = (i - x) / w;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const ring = ringAround(list, w, h, 3);
    const white = ring.filter((j) => cls[j] === CLASS.eyeWhite).length / Math.max(1, ring.length);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (white < 0.4 || Math.max(bw, bh) / Math.min(bw, bh) > 5) continue;
    const filled = new Uint8Array(w * h);
    for (const i of list) filled[i] = 1;
    const solid = fillHoles(filled, w, h);
    const all = [];
    for (let i = 0; i < solid.length; i++) if (solid[i]) all.push(i);
    const c = centroid(all, w);
    pupils.push({ cx: c.x, cy: c.y, area: all.length, pixels: all, whiteContact: white });
  }
  return pupils;
}

/** Mask of pixels within `steps` 4-connected steps of a seed mask (the seed included). */
function ringDistanceMask(seed, w, h, steps) {
  const out = Uint8Array.from(seed);
  let layer = [];
  for (let i = 0; i < seed.length; i++) if (seed[i]) layer.push(i);
  for (let k = 0; k < steps; k++) {
    const next = [];
    for (const i of layer) for (const j of neighbours4(i, w, h)) if (j >= 0 && !out[j]) { out[j] = 1; next.push(j); }
    layer = next;
  }
  return out;
}

/** Pixels exactly `steps` 4-connected steps away from a pixel list. */
function ringAround(list, w, h, steps) {
  const seen = new Set(list);
  let layer = list;
  for (let k = 0; k < steps; k++) {
    const next = [];
    for (const i of layer) for (const j of neighbours4(i, w, h)) if (j >= 0 && !seen.has(j)) { seen.add(j); next.push(j); }
    layer = next;
  }
  return layer;
}

function measureEyes(cls, w, h, pupils) {
  const white = open(cls.map((c) => (c === CLASS.eyeWhite ? 1 : 0)), w, h, 2);
  for (const p of pupils) for (const i of p.pixels) white[i] = 1;
  const { labels, pixels } = components(white, w, h);
  const eyes = [];
  for (let l = 1; l < pixels.length; l++) {
    const own = pupils.filter((p) => labels[Math.floor(p.cy) * w + Math.floor(p.cx)] === l || p.pixels.some((i) => labels[i] === l));
    if (!own.length) continue;
    const mask = new Uint8Array(w * h);
    for (const i of pixels[l]) mask[i] = 1;
    const solid = fillHoles(mask, w, h);
    const dist = distanceInside(solid, w, h);
    const points = [];
    for (let i = 0; i < solid.length; i++) {
      if (!solid[i]) continue;
      const x = i % w, y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) continue;
      if (neighbours4(i, w, h).some((j) => !solid[j])) points.push([x + 0.5, y + 0.5]);
    }
    let best = 0;
    for (let i = 1; i < dist.length; i++) if (dist[i] > dist[best]) best = i;
    const seeds = [{ cx: (best % w) + 0.5, cy: Math.floor(best / w) + 0.5, r: dist[best] }];
    if (own.length > 1) {
      let second = -1;
      for (let i = 0; i < dist.length; i++) {
        const x = (i % w) + 0.5, y = Math.floor(i / w) + 0.5;
        if (Math.hypot(x - seeds[0].cx, y - seeds[0].cy) <= seeds[0].r) continue;
        if (second < 0 || dist[i] > dist[second]) second = i;
      }
      if (second >= 0) seeds.push({ cx: (second % w) + 0.5, cy: Math.floor(second / w) + 0.5, r: dist[second] });
    }
    for (const circle of fitCircles(points, seeds)) {
      const pupil = own
        .map((p) => ({ p, d: Math.hypot(p.cx - circle.cx, p.cy - circle.cy) }))
        .sort((a, b) => a.d - b.d)[0];
      eyes.push({ circle, pupil: pupil && pupil.d <= circle.r * 1.05 ? pupil.p : null, area: pixels[l].length });
    }
  }
  return selectEyes(cls, w, h, eyes);
}

/** Share of the pixels inside a circle that are eye white or pupil. */
function whiteInside(cls, w, h, c) {
  let inside = 0, white = 0;
  const x0 = Math.max(0, Math.floor(c.cx - c.r)), x1 = Math.min(w - 1, Math.ceil(c.cx + c.r));
  const y0 = Math.max(0, Math.floor(c.cy - c.r)), y1 = Math.min(h - 1, Math.ceil(c.cy + c.r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (Math.hypot(x + 0.5 - c.cx, y + 0.5 - c.cy) > c.r) continue;
      inside++;
      const k = cls[y * w + x];
      if (k === CLASS.eyeWhite || k === CLASS.dark) white++;
    }
  }
  return inside ? white / inside : 0;
}

/**
 * Keeps at most two eye circles. A circle must be mostly eye white inside (this drops a circle
 * fitted to the skin around a hidden eye), a circle that sits on a better one is a duplicate fit of
 * the same eye, and circles under 45% of the largest radius are grey gear or hair, not an eye.
 * Returns the kept eyes from left to right and how many circles were dropped.
 */
function selectEyes(cls, w, h, eyes) {
  const scored = eyes
    .map((e) => ({ ...e, white: whiteInside(cls, w, h, e.circle) }))
    .filter((e) => e.white >= 0.5 && e.circle.inliers >= 8)
    .sort((a, b) => (b.circle.coverage * b.white - a.circle.coverage * a.white) || (a.circle.cx - b.circle.cx));
  const distinct = [];
  for (const e of scored) {
    const duplicate = distinct.some((k) => Math.hypot(k.circle.cx - e.circle.cx, k.circle.cy - e.circle.cy) < 0.7 * (k.circle.r + e.circle.r));
    if (!duplicate) distinct.push(e);
  }
  const rMax = Math.max(0, ...distinct.map((e) => e.circle.r));
  const kept = distinct
    .filter((e) => e.circle.r >= 0.45 * rMax)
    .sort((a, b) => (Number(Boolean(b.pupil)) - Number(Boolean(a.pupil))) || (b.circle.r - a.circle.r) || (a.circle.cx - b.circle.cx))
    .slice(0, 2)
    .sort((a, b) => a.circle.cx - b.circle.cx);
  return { eyes: kept, dropped: eyes.length - kept.length };
}

function measureHeadEdges(cls, w, h, eyes) {
  const material = (c) => c === CLASS.skin || c === CLASS.hair || c === CLASS.lip || c === CLASS.dark;
  const skinLike = (c) => c === CLASS.skin || c === CLASS.lip;
  const eyeRows = eyes.length
    ? [Math.min(...eyes.map((e) => e.circle.cy - 1.3 * e.circle.r)), Math.max(...eyes.map((e) => e.circle.cy + 1.3 * e.circle.r))]
    : [Infinity, -Infinity];
  const rows = [];
  for (let y = 0; y < h; y++) {
    if (y >= eyeRows[0] && y <= eyeRows[1]) continue;
    let bestStart = -1, bestLen = 0, start = -1;
    for (let x = 0; x <= w; x++) {
      const inRun = x < w && material(cls[y * w + x]);
      if (inRun && start < 0) start = x;
      if (!inRun && start >= 0) { if (x - start > bestLen) { bestLen = x - start; bestStart = start; } start = -1; }
    }
    if (bestLen < 10) continue;
    let skin = 0;
    for (let x = bestStart; x < bestStart + bestLen; x++) if (skinLike(cls[y * w + x])) skin++;
    if (skin / bestLen < 0.8) continue;
    rows.push({ y: y + 0.5, left: bestStart, right: bestStart + bestLen, width: bestLen });
  }
  if (rows.length < 5) return null;
  const widths = rows.map((r) => r.width).sort((a, b) => a - b);
  const p80 = widths[Math.floor(widths.length * 0.8)];
  // Keep the longest run of consecutive plateau rows, so rows above and below the eyes are not mixed.
  const plateauAll = rows.filter((r) => r.width >= 0.95 * p80);
  let runs = [], current = [];
  for (const r of plateauAll) {
    if (current.length && r.y - current[current.length - 1].y > 3) { runs.push(current); current = []; }
    current.push(r);
  }
  if (current.length) runs.push(current);
  const plateau = runs.sort((a, b) => b.length - a.length)[0] ?? [];
  if (plateau.length < 5) return null;
  const fit = fitParallelEdges(plateau);
  const line = (a, ys) => {
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    return { x0: round(a + fit.b * y0), y0: round(y0), x1: round(a + fit.b * y1), y1: round(y1) };
  };
  const ym = plateau.reduce((s, r) => s + r.y, 0) / plateau.length;
  const widthPx = (fit.aR - fit.aL) * Math.cos(Math.atan(fit.b));
  return {
    left: line(fit.aL, fit.leftRows), right: line(fit.aR, fit.rightRows), widthPx: round(widthPx),
    centreX: round((fit.aL + fit.aR) / 2 + fit.b * ym), tilt: round4(Math.atan(fit.b) * 180 / Math.PI), rows: plateau.length,
  };
}

function measureMouth(cls, w, h, eyes, head) {
  if (!head) return null;
  const hw = head.widthPx;
  const mouthy = cls.map((c) => (c === CLASS.lip || c === CLASS.hair || c === CLASS.dark ? 1 : 0));
  for (const e of eyes) {
    const reach = e.circle.r + 0.08 * hw;
    const x0 = Math.max(0, Math.floor(e.circle.cx - reach)), x1 = Math.min(w - 1, Math.ceil(e.circle.cx + reach));
    const y0 = Math.max(0, Math.floor(e.circle.cy - reach)), y1 = Math.min(h - 1, Math.ceil(e.circle.cy + reach));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (Math.hypot(x + 0.5 - e.circle.cx, y + 0.5 - e.circle.cy) <= reach) mouthy[y * w + x] = 0;
  }
  // A shape that comes within 5% of a head width of the outline is the shaded base, the hairline or
  // a silhouette feature, never a mouth seen on the face. Profile mouths on the outline are left to
  // a developer override.
  const nearEdge = ringDistanceMask(cls.map((c) => (c === CLASS.background ? 1 : 0)), w, h, Math.max(4, Math.round(0.05 * hw)));
  const { pixels } = components(mouthy, w, h);
  const insideHead = (x, y) => {
    const t = (y - head.left.y0) / ((head.left.y1 - head.left.y0) || 1);
    const xl = head.left.x0 + t * (head.left.x1 - head.left.x0), xr = head.right.x0 + t * (head.right.x1 - head.right.x0);
    return x > xl + 0.03 * hw && x < xr - 0.03 * hw;
  };
  const describe = (list) => {
    let lip = 0, dark = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, sx = 0, sy = 0;
    for (const i of list) {
      const x = i % w, y = (i - x) / w;
      if (cls[i] === CLASS.lip) lip++;
      if (cls[i] === CLASS.dark) dark++;
      sx += x; sy += y;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { list, lip, dark, x0, x1, y0, y1, cx: sx / list.length + 0.5, cy: sy / list.length + 0.5, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  };
  const candidates = [];
  const minWidth = 0.08 * hw;
  for (let l = 1; l < pixels.length; l++) {
    const list = pixels[l];
    if (list.length < 10 || list.some((i) => nearEdge[i])) continue;
    const d = describe(list);
    if (!insideHead(d.cx, d.cy)) continue;
    const small = list.length <= 0.03 * hw * hw && d.height <= 0.2 * hw;
    if (small) {
      // A mouth is a wide shape; a nose or a cheek blush is about as tall as it is wide. A mouth is
      // drawn as lip or a dark line; a wide shape in hair colour with no dark core is a brow. Mouth
      // lines on the first sheet are 10 to 35% dark pixels inside a brown rim; brows have none.
      const coloured = d.lip >= 10 || (d.dark >= 10 && d.dark >= 0.08 * list.length);
      if (coloured && d.width >= minWidth && d.width >= 1.6 * d.height) candidates.push({ ...d, kind: d.lip >= 10 ? 'lip' : 'line' });
      continue;
    }
    // A large dark shape such as a moustache can hide the mouth; the visible lip is then used alone.
    const lipOnly = list.filter((i) => cls[i] === CLASS.lip);
    if (lipOnly.length < 10) continue;
    const lip = describe(lipOnly);
    if (lip.width >= minWidth && insideHead(lip.cx, lip.cy)) candidates.push({ ...lip, kind: 'lip-only' });
  }
  if (!candidates.length) return null;
  // Brows are wide shapes too, but they sit next to the eyes; the mouth is the wide shape farthest
  // from the line through the eye centres. No assumption is made about which side is down, because
  // some views on the sheet are drawn upside down.
  const fromEyes = (c) => {
    if (!eyes.length) return 0;
    if (eyes.length === 1) return Math.hypot(c.cx - eyes[0].circle.cx, c.cy - eyes[0].circle.cy);
    const [a, b] = eyes.map((e) => e.circle);
    const len = Math.hypot(b.cx - a.cx, b.cy - a.cy) || 1;
    return Math.abs((b.cx - a.cx) * (c.cy - a.cy) - (b.cy - a.cy) * (c.cx - a.cx)) / len;
  };
  for (const c of candidates) c.fromEyes = fromEyes(c);
  candidates.sort((a, b) => (b.fromEyes - a.fromEyes) || (b.width - a.width) || (a.x0 - b.x0));
  const m = candidates[0];
  const corner = (x) => {
    const ys = m.list.filter((i) => i % w === x).map((i) => Math.floor(i / w) + 0.5);
    return { x: round(x + 0.5), y: round(ys.reduce((s, v) => s + v, 0) / ys.length) };
  };
  return { left: corner(m.x0), right: corner(m.x1), kind: m.kind, pixels: m.list.length };
}

/** Measures one crop image. Coordinates are in crop pixels, ratios in head widths. */
export function measureCrop(img) {
  const { cls, headPixels } = segment(img);
  const { width: w, height: h } = img;
  const pupils = findPupils(cls, w, h, headPixels);
  const { eyes, dropped } = measureEyes(cls, w, h, pupils);
  const head = measureHeadEdges(cls, w, h, eyes);
  const mouth = measureMouth(cls, w, h, eyes, head);
  const flags = [];
  if (eyes.length !== 2) flags.push(`found ${eyes.length} eye${eyes.length === 1 ? '' : 's'}`);
  for (const [k, e] of eyes.entries()) {
    if (!e.pupil) flags.push(`eye ${k}: no pupil inside the circle`);
    if (e.circle.coverage < 0.25) flags.push(`eye ${k}: rim visible on ${Math.round(e.circle.coverage * 100)}% of the circle`);
    if (e.circle.rms > RIM_RESIDUAL_LIMIT) flags.push(`eye ${k}: rim residual ${round(e.circle.rms)} px`);
  }
  if (!head) flags.push('head edges not found');
  else {
    const span = Math.min(head.left.y1 - head.left.y0, head.right.y1 - head.right.y0);
    if (span < 0.15 * head.widthPx) flags.push(`head edges fitted over only ${Math.round(span)} px`);
    if (Math.abs(head.tilt) > 12) flags.push(`head edges tilted ${Math.round(head.tilt)}°`);
  }
  if (!mouth) flags.push('mouth not found');
  else if (mouth.kind === 'lip-only') flags.push('mouth partly hidden; corners from the lip only');
  const landmarks = {
    eyes: eyes.map((e) => ({
      cx: round(e.circle.cx), cy: round(e.circle.cy), r: round(e.circle.r),
      rmsPx: round(e.circle.rms), rimCoverage: round(e.circle.coverage),
      pupil: e.pupil ? { cx: round(e.pupil.cx), cy: round(e.pupil.cy), areaPx: e.pupil.area } : null,
    })),
    head,
    mouth,
  };
  return { landmarks, flags, droppedCircles: dropped, cls };
}

/** Ratios of the landmarks in units of the crop's own head width. */
export function ratios(landmarks) {
  const { eyes, head, mouth } = landmarks;
  if (!head || !head.widthPx) return null;
  const hw = head.widthPx;
  const out = {
    eyes: eyes.map((e) => ({
      radius: round4(e.r / hw),
      offsetX: round4((e.cx - head.centreX) / hw),
      pupilOffset: e.pupil ? { x: round4((e.pupil.cx - e.cx) / e.r), y: round4((e.pupil.cy - e.cy) / e.r) } : null,
    })),
  };
  if (eyes.length === 2) {
    out.eyeSpacing = round4((eyes[1].cx - eyes[0].cx) / hw);
    out.eyeHeightDifference = round4((eyes[1].cy - eyes[0].cy) / hw);
  }
  if (mouth) {
    out.mouthWidth = round4(Math.hypot(mouth.right.x - mouth.left.x, mouth.right.y - mouth.left.y) / hw);
    if (eyes.length) {
      const eyeY = eyes.reduce((s, e) => s + e.cy, 0) / eyes.length;
      out.mouthBelowEyes = round4(((mouth.left.y + mouth.right.y) / 2 - eyeY) / hw);
    }
  }
  return out;
}

function round4(value) { return Math.round(value * 10000) / 10000; }

/** Applies developer overrides: each named landmark of a crop is replaced and marked. */
export function applyOverrides(entry, overrides) {
  const o = overrides?.[entry.id];
  if (!o) return entry;
  const landmarks = { ...entry.landmarks };
  const replaced = [];
  for (const key of ['eyes', 'head', 'mouth']) if (key in o) { landmarks[key] = o[key]; replaced.push(key); }
  return { ...entry, landmarks, overridden: replaced, note: o.note };
}

// ---------------------------------------------------------------------------------------------
// Board

function overlaySvg(entry, w, h) {
  const { eyes, head, mouth } = entry.landmarks;
  const parts = [];
  for (const e of eyes ?? []) {
    parts.push(`<circle cx="${e.cx}" cy="${e.cy}" r="${e.r}" fill="none" stroke="#00b7ff" stroke-width="2"/>`);
    parts.push(`<circle cx="${e.cx}" cy="${e.cy}" r="2" fill="#00b7ff"/>`);
    if (e.pupil) {
      const { cx, cy } = e.pupil;
      parts.push(`<path d="M${cx - 6} ${cy}H${cx + 6}M${cx} ${cy - 6}V${cy + 6}" stroke="#ff2bd6" stroke-width="2"/>`);
    }
  }
  if (head) {
    for (const side of [head.left, head.right]) {
      parts.push(`<line x1="${side.x0}" y1="${side.y0}" x2="${side.x1}" y2="${side.y1}" stroke="#18c418" stroke-width="3"/>`);
    }
  }
  if (mouth) {
    parts.push(`<line x1="${mouth.left.x}" y1="${mouth.left.y}" x2="${mouth.right.x}" y2="${mouth.right.y}" stroke="#ff3b1f" stroke-width="1" stroke-dasharray="3 2"/>`);
    for (const p of [mouth.left, mouth.right]) parts.push(`<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#ff3b1f"/>`);
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${parts.join('')}</svg>`);
}

const escapeXml = (text) => text.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);

async function board(cells, views, subjects, outFile) {
  const cellW = 340, imgH = 440, textH = 64, cellH = imgH + textH;
  const header = 30;
  const parts = [];
  for (const cell of cells) {
    const col = views.indexOf(cell.view), row = subjects.indexOf(cell.subject);
    const scale = Math.min(cellW / cell.width, imgH / cell.height);
    const drawn = await sharp(cell.png).composite([{ input: overlaySvg(cell.entry, cell.width, cell.height) }]).png().toBuffer();
    const img = await sharp(drawn).resize(Math.round(cell.width * scale), Math.round(cell.height * scale)).png().toBuffer();
    parts.push({ input: img, left: col * cellW, top: header + row * cellH });
    const lines = [cell.entry.id, ...(cell.entry.flags.length ? cell.entry.flags : ['no flags'])].slice(0, 4);
    if (cell.entry.overridden?.length) lines[0] += ` (override: ${cell.entry.overridden.join(', ')})`;
    const text = lines.map((t, k) => `<text x="6" y="${16 + k * 15}" font-family="Arial" font-size="${k ? 11 : 13}" fill="${k && cell.entry.flags.length ? '#b00020' : '#222'}">${escapeXml(t)}</text>`).join('');
    parts.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cellW}" height="${textH}">${text}</svg>`), left: col * cellW, top: header + row * cellH + imgH });
  }
  const legend = '<text x="8" y="20" font-family="Arial" font-size="14" fill="#222">blue: eye circle and centre · pink cross: pupil centre · green: head side edges · red: mouth corners</text>';
  parts.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${views.length * cellW}" height="${header}">${legend}</svg>`), left: 0, top: 0 });
  await sharp({ create: { width: views.length * cellW, height: header + subjects.length * cellH, channels: 3, background: '#ffffff' } })
    .composite(parts).png().toFile(outFile);
}

// ---------------------------------------------------------------------------------------------
// Run

export async function run({ sourceDir, manifestPath, outDir, overridesPath }) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  validateManifest(manifest);
  const overridesFile = overridesPath ?? manifestPath.replace(/\.json$/, '.overrides.json');
  const overrides = fs.existsSync(overridesFile) ? JSON.parse(fs.readFileSync(overridesFile, 'utf8')) : {};
  const bytes = findSourceByHash(sourceDir, manifest.sheet.sha256);
  fs.mkdirSync(path.join(outDir, 'classes'), { recursive: true });
  const crops = manifest.crops.filter((crop) => crop.include);
  const entries = [];
  const cells = [];
  for (const crop of crops) {
    const { x, y, w, h } = crop.rect;
    const { data, info } = await sharp(bytes).extract({ left: x, top: y, width: w, height: h }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const img = decode(data, info.width, info.height, info.channels);
    const { landmarks, flags, droppedCircles, cls } = measureCrop(img);
    let entry = { id: crop.id, subject: crop.subject, view: crop.view, rect: crop.rect, landmarks, flags, droppedCircles };
    entry = applyOverrides(entry, overrides);
    entry.ratios = ratios(entry.landmarks);
    entries.push(entry);
    const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer();
    cells.push({ entry, png, width: w, height: h, subject: crop.subject, view: crop.view });
    await sharp(classImage(cls), { raw: { width: w, height: h, channels: 3 } }).png().toFile(path.join(outDir, 'classes', `${crop.id}.png`));
  }
  const spec = {
    schema: 1,
    sheet: { name: manifest.sheet.name, sha256: manifest.sheet.sha256 },
    units: 'Landmarks in crop pixels (origin at the crop rectangle top-left on the sheet); ratios in head widths, pupil offsets in eye radii.',
    overrides: Object.keys(overrides).length,
    crops: entries,
  };
  const text = `${JSON.stringify(spec, null, 2)}\n`;
  fs.writeFileSync(path.join(outDir, 'measured-spec.json'), text);
  const subjects = [...new Set(crops.map((c) => c.subject))];
  await board(cells, manifest.views, subjects, path.join(outDir, 'measurement-board.png'));
  return { spec, specSha256: sha256(Buffer.from(text)) };
}

const PALETTE = {
  [CLASS.background]: [250, 250, 250], [CLASS.skin]: [240, 170, 120], [CLASS.eyeWhite]: [80, 160, 255],
  [CLASS.dark]: [0, 0, 0], [CLASS.hair]: [140, 60, 20], [CLASS.lip]: [230, 30, 120], [CLASS.other]: [120, 200, 120],
};

/** RGB buffer showing each pixel's class, for checking the segmentation by eye. */
export function classImage(cls) {
  const out = Buffer.alloc(cls.length * 3);
  for (let i = 0; i < cls.length; i++) out.set(PALETTE[cls[i]], i * 3);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const sourceDir = option('--source-dir') ?? process.env.CONCEPT_SOURCE_DIR;
  if (!sourceDir) { console.error('Pass --source-dir <folder> or set CONCEPT_SOURCE_DIR.'); process.exit(2); }
  const manifestPath = option('--manifest') ?? path.join(here, 'manifests', 'headshots-and-angles.json');
  const outDir = option('--out') ?? path.resolve('artifacts', 'concept-fitting', 'headshots-and-angles');
  const { spec, specSha256 } = await run({ sourceDir, manifestPath, outDir, overridesPath: option('--overrides') });
  const flagged = spec.crops.filter((c) => c.flags.length);
  console.log(`Measured ${spec.crops.length} crops (${flagged.length} flagged). measured-spec.json sha256 ${specSha256}`);
  for (const c of flagged) console.log(`  ${c.id}: ${c.flags.join('; ')}`);
}
