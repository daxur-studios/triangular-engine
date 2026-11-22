import { BufferGeometry, Float32BufferAttribute } from 'three';

export interface BobShape { length: number; flare: number; fringe: number; grooves: number; depth: number; }
export const DEFAULT_BOB_SHAPE: BobShape = { length: 0, flare: 100, fringe: 0, grooves: 18, depth: 100 };

/** Continuous crown, fringe and side surface, in the experimental head's coordinates. */
export function buildBobGeometry(shape: BobShape): BufferGeometry {
  const vertices: number[] = [], indices: number[] = [];
  const cols = 240, crownRows = 32, skirtRows = 24;
  const endY = 1.1 - shape.length * .008;
  for (let j = 0; j <= crownRows + skirtRows; j++) {
    const t = Math.max(0, (j - crownRows) / skirtRows);
    const theta = Math.min(j / crownRows, 1) * Math.PI / 2;
    for (let i = 0; i <= cols; i++) {
    const a = Math.PI * 2 * i / cols;
    // Each recessed line follows the same continuous crown and skirt surface.
    // Fade towards the crown's pole so all the lines meet smoothly.
    const channel = Math.pow((1 + Math.cos(a * shape.grooves)) / 2, 8);
    const inset = shape.depth * .001 * channel * Math.pow(Math.sin(theta), 2);
    // A short front edge becomes the fringe; it flows into the longer sides.
    const frontAngle = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
    const blend = Math.max(0, Math.min(1, (frontAngle - .63) / .38));
    const side = blend * blend * (3 - 2 * blend);
    const fringeEnd = 3.15 - shape.fringe * .006;
    const hem = fringeEnd * (1 - side) + endY * side;
    // Curve the final rows inward to soften the edge without adding a seam.
    const round = Math.pow(Math.max(0, (t - .86) / .14), 2) * .11;
    const y = j <= crownRows ? 3.2 + 1.4 * Math.cos(theta) : 3.2 + (hem - 3.2) * t;
    // One rounded profile runs from the top all the way to the side hem.
    // Its width keeps increasing down the head, rather than starting a
    // separate flare below an almost vertical crown.
    const height = Math.max(0, Math.min(1, (y - endY) / (4.6 - endY)));
    const sideRadius = (2.08 + shape.flare * .0025) * Math.sqrt(Math.max(0, 1 - height * height));
    const frontRadius = 1.65 * Math.sin(theta);
    const r = frontRadius * (1 - side) + sideRadius * side - inset - round;
    vertices.push(Math.sin(a) * r, y, Math.cos(a) * r);
    }
  }
  for (let j = 0; j < crownRows + skirtRows; j++) for (let i = 0; i < cols; i++) {
    const n = j * (cols + 1) + i;
    indices.push(n, n + cols + 1, n + 1, n + 1, n + cols + 1, n + cols + 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
