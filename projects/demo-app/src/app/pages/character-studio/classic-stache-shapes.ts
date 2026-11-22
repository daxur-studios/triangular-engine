import { Group, MathUtils, Mesh, MeshStandardMaterial } from 'three';
import { buildClayLock, type ClayLock, type ClayPoint } from './capsule-clay-lock';

export type StacheHandle = 'fringe' | 'mustache';
export type ShapeOffset = readonly [x: number, y: number];
export type StacheShape = Readonly<Record<StacheHandle, ShapeOffset>>;

export const CLASSIC_STACHE_YAW = 30;
const unchanged: ShapeOffset = [0, 0];
export const DEFAULT_STACHE_SHAPE: StacheShape = { fringe: unchanged, mustache: unchanged };

const fringe: ClayLock = [[-.94, 3.70, .71], [-.02, 4.22, 1.22], [1.37, 3.82, 1.14], .34];
const mustache: ClayLock = [[-.11, 1.68, 1.49], [.31, 1.46, 1.55], [.76, 1.53, 1.32], .143];

export function stacheTip(handle: StacheHandle, offset: ShapeOffset): ClayPoint {
  const [x, y] = boundStacheOffset(handle, ...offset);
  const [, , tip] = handle === 'fringe' ? fringe : mustache;
  return [tip[0] + x, tip[1] + y, tip[2]];
}

export function boundStacheOffset(handle: StacheHandle, x: number, y: number): ShapeOffset {
  // The mustache band leaves a visible gap below the eye whites even at its widest, highest setting.
  return handle === 'fringe'
    ? [MathUtils.clamp(x, -.44, .43), MathUtils.clamp(y, -.17, .52)]
    : [MathUtils.clamp(x, -.16, .11), MathUtils.clamp(y, -.14, .04)];
}

export const classicStacheTemple: ClayLock = [[-.92, 3.72, .46], [-1.27, 3.32, .39], [-1.38, 2.76, .30], .22];

export const classicStacheSweep: readonly ClayLock[] = [
  [[-.87, 3.71, .25], [-.04, 4.48, .41], [1.21, 4.28, .32], .30],
  [[-.93, 3.65, -.02], [-.16, 4.35, -.11], [1.05, 4.51, -.37], .29],
  [[-.76, 3.73, -.40], [-.10, 4.15, -.69], [1.11, 4.12, -1.04], .30],
  [[-.98, 3.53, .86], [-.26, 3.93, 1.29], [1.24, 3.46, 1.25], .28],
  classicStacheTemple,
  [[-1.01, 3.63, .37], [-1.41, 3.29, .10], [-1.40, 2.72, -.05], .22],
  [[-1.06, 3.59, .01], [-1.39, 3.03, -.37], [-1.38, 2.18, -.35], .24],
  [[.82, 3.86, .46], [1.19, 3.43, .64], [1.38, 2.85, .55], .23],
];

export function classicStacheFringe(offset: ShapeOffset): ClayLock {
  const [base, bend, , radius] = fringe;
  return [base, [bend[0] + offset[0] * .35, bend[1] + offset[1] * .40, bend[2]], stacheTip('fringe', offset), radius];
}

/** Independent of the hairstyle. Both halves use the same editable tip. */
export function buildClassicMustache(material: MeshStandardMaterial) {
  const root = new Group();
  root.name = 'classic-mustache';
  const [base, bend, , radius] = mustache;
  const right = new Mesh(buildClayLock(mustache, .73), material);
  const left = new Mesh(right.geometry, material);
  right.position.set(...base);
  left.position.set(-base[0], base[1], base[2]);
  left.scale.x = -1;
  root.add(left, right);
  let current = unchanged;
  return {
    root,
    setTip(requested: ShapeOffset) {
      const offset = boundStacheOffset('mustache', ...requested);
      if (offset[0] === current[0] && offset[1] === current[1]) return;
      const geometry = buildClayLock([
        base, [bend[0] + offset[0] * .45, bend[1] + offset[1] * .20, bend[2]],
        stacheTip('mustache', offset), radius,
      ], .73);
      right.geometry.dispose();
      right.geometry = left.geometry = geometry;
      current = offset;
    },
  };
}
