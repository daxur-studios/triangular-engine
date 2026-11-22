import {
  compound, cut, defineParams, mirror, Sketcher, unwrap, withScope, type Shape3D, type Vec3,
} from 'brepjs';
import { sculptLock, type LockSection } from './sculpt-lock.ts';

export const params = defineParams({
  crownSweep: { type: 'number', default: 18, min: 0, max: 34, step: 1, unit: 'mm', label: 'Crown sweep' },
  backLength: { type: 'number', default: 38, min: 14, max: 58, step: 1, unit: 'mm', label: 'Side and rear lock extension' },
});

export type SweptHairValues = typeof params.values;
type Part = { shape: Shape3D; surface: 'hair' | 'mustache' };

const up: Vec3 = [0, 0, 1];
const front: Vec3 = [0, -1, 0];
const back: Vec3 = [0, 1, 0];

export const expected = () => ({ bounds: { yMin: -166 }, tolerancePct: 1 });

/** Keep the upper lip accessory independent of the hairstyle. Coordinates are mm, Z-up and -Y forward. */
export function withSweptHairParts<T>(p: SweptHairValues, consume: (parts: readonly Part[]) => T): T {
  return withScope(scope => {
    const cap = scope.register(new Sketcher('XZ')
      .movePointerTo([0, 453])
      .cubicBezierCurveTo([126, 361], [65, 453], [112, 411])
      .cubicBezierCurveTo([141, 257], [140, 327], [140, 285])
      .cubicBezierCurveTo([127, 237], [142, 245], [138, 237])
      .lineTo([0, 237]).close().revolve(up));
    const opening = scope.register(new Sketcher('YZ', [-195, 0, 0])
      .movePointerTo([-190, 200]).lineTo([79, 200]).lineTo([79, 235])
      .cubicBezierCurveTo([-83, 356], [43, 275], [-18, 332])
      .cubicBezierCurveTo([-190, 360], [-121, 358], [-153, 360])
      .close().extrude(390, { extrusionDirection: [1, 0, 0] }));
    const arch = scope.register(new Sketcher('XZ', [0, -67, 0])
      .movePointerTo([-161, 200]).lineTo([161, 200]).lineTo([161, 338])
      .cubicBezierCurveTo([-4, 386], [111, 342], [65, 387])
      .cubicBezierCurveTo([-161, 329], [-71, 382], [-106, 355])
      .close().extrude(125, { extrusionDirection: front }));
    const trimmed = scope.register(unwrap(cut(cap, opening)));
    const parts: Part[] = [{ shape: scope.register(unwrap(cut(trimmed, arch))), surface: 'hair' }];

    // Apply the controls progressively along each lock so the buried roots stay attached.
    function lock(start: Vec3, sections: readonly LockSection[], end: Vec3, guide: Vec3, offset: Vec3 = [0, 0, 0]) {
      const displace = ([x, y, z]: Vec3, weight: number): Vec3 => [
        x + offset[0] * weight, y + offset[1] * weight, z + offset[2] * weight,
      ];
      const profiles: LockSection[] = sections.map(([center, width, depth], index) => [
        displace(center, ((index + 1) / (sections.length + 1)) ** 2), width, depth,
      ]);
      parts.push({ shape: sculptLock(scope, start, profiles, displace(end, 1), guide), surface: 'hair' });
    }

    const sweep: Vec3 = [p.crownSweep, 0, 0];
    lock([-102, -24, 377], [
      [[-77, -39, 425], 37, 27], [[-34, -46, 464], 43, 29],
      [[24, -46, 478], 38, 26], [[78, -43, 464], 22, 16],
      [[108, -39, 445], 9, 7],
    ], [129, -36, 432], [0, -.30, 1], sweep);
    lock([-63, 24, 414], [
      [[-37, 31, 456], 35, 23], [[5, 37, 486], 31, 20],
      [[49, 48, 491], 21, 15], [[79, 65, 481], 10, 8],
    ], [99, 78, 462], up, sweep);
    lock([-26, -1, 426], [
      [[-10, -6, 453], 23, 17], [[14, -4, 478], 21, 14],
      [[35, 1, 491], 13, 10], [[50, 8, 498], 6, 5],
    ], [61, 13, 499], front, [p.crownSweep * .45, 0, 0]);
    lock([-69, -46, 398], [
      [[-45, -80, 426], 31, 24], [[9, -103, 442], 39, 26],
      [[66, -117, 425], 31, 22], [[113, -118, 394], 16, 12],
    ], [148, -110, 364], [0, -.42, 1], sweep);
    lock([-29, -47, 419], [
      [[-23, -91, 420], 30, 21], [[-7, -125, 397], 28, 20],
      [[1, -145, 374], 19, 13], [[-2, -149, 357], 8, 7],
    ], [-11, -146, 346], front, [p.crownSweep * .38, 0, 0]);
    lock([-66, -38, 410], [
      [[-79, -79, 416], 24, 18], [[-91, -112, 396], 24, 19],
      [[-108, -125, 370], 15, 11], [[-128, -119, 352], 7, 6],
    ], [-140, -111, 341], front);
    lock([-58, -5, 413], [
      [[-92, -10, 421], 27, 16], [[-122, -6, 416], 25, 17],
      [[-144, 6, 399], 15, 11], [[-150, 16, 380], 7, 6],
    ], [-151, 27, 368], up);
    lock([-81, 11, 400], [
      [[-106, 21, 429], 21, 15], [[-127, 39, 443], 17, 13],
      [[-143, 55, 442], 10, 8], [[-152, 70, 434], 5, 4],
    ], [-159, 78, 426], up);
    lock([66, -38, 404], [
      [[108, -64, 383], 23, 19], [[127, -64, 350], 22, 17],
      [[139, -57, 330], 13, 10], [[149, -47, 324], 6, 5],
    ], [153, -38, 321], [.9, -.4, 0]);

    // Bow out high at the temple, tuck in beside the cheek, then curl forward below the ear.
    const sideDrop: Vec3 = [0, 0, -.8 * p.backLength];
    lock([71, -6, 419], [
      [[112, 5, 393], 30, 20], [[140, 13, 341], 29, 19],
      [[146, 24, 283], 23, 16], [[142, 30, 223], 18, 11],
      [[145, 24, 187], 13, 9], [[153, 8, 169], 7, 6],
    ], [160, -4, 158], [1, 0, 0], sideDrop);
    lock([-79, -8, 419], [
      [[-125, 5, 390], 34, 22], [[-147, 14, 341], 31, 20],
      [[-148, 25, 275], 23, 16], [[-140, 31, 216], 17, 11],
      [[-145, 25, 182], 12, 8], [[-153, 10, 163], 7, 6],
    ], [-158, -5, 153], [-1, 0, 0], sideDrop);

    const rearDrop: Vec3 = [0, 0, -p.backLength];
    lock([-86, 33, 402], [
      [[-119, 48, 369], 31, 18], [[-135, 56, 315], 32, 18],
      [[-137, 62, 260], 23, 14], [[-147, 68, 232], 11, 9],
    ], [-168, 73, 224], [-.9, .45, 0], rearDrop);
    lock([99, 31, 395], [
      [[124, 51, 362], 30, 17], [[133, 59, 310], 30, 16],
      [[138, 63, 261], 21, 14], [[149, 66, 235], 12, 9],
    ], [170, 70, 229], [.9, .45, 0], rearDrop);
    lock([-81, 66, 375], [
      [[-104, 88, 330], 24, 13], [[-115, 94, 282], 26, 14],
      [[-116, 96, 241], 19, 12], [[-126, 102, 218], 9, 7],
    ], [-140, 108, 211], [-.78, .62, 0], [0, 0, -p.backLength * .6]);
    lock([84, 70, 370], [
      [[104, 91, 326], 24, 13], [[113, 100, 283], 25, 14],
      [[118, 102, 244], 18, 11], [[129, 108, 226], 8, 6],
    ], [143, 108, 221], [.76, .65, 0], [0, 0, -p.backLength * .6]);
    lock([-57, 57, 410], [
      [[-82, 96, 366], 32, 18], [[-91, 121, 314], 35, 16],
      [[-100, 126, 246], 30, 16], [[-121, 130, 214], 13, 10],
    ], [-144, 133, 211], back, rearDrop);
    lock([10, 59, 417], [
      [[-9, 107, 391], 35, 17], [[-19, 136, 340], 44, 19],
      [[-19, 146, 263], 39, 15], [[-31, 147, 222], 16, 11],
    ], [-48, 141, 205], back, rearDrop);
    lock([61, 55, 411], [
      [[66, 102, 381], 35, 17], [[70, 132, 322], 41, 18],
      [[72, 137, 259], 34, 16], [[87, 132, 226], 15, 10],
    ], [110, 128, 215], back, rearDrop);

    const mustache = sculptLock(scope, [-9, -137, 165], [
      [[5, -147, 163], 12, 11], [[23, -152, 156], 17, 15],
      [[43, -150, 153], 15, 13], [[61, -143, 155], 8, 8],
      [[72, -137, 159], 5, 4],
    ], [77, -127, 164], front);
    parts.push({ shape: mustache, surface: 'mustache' }, { shape: scope.register(mirror(mustache)), surface: 'mustache' });
    return consume(parts);
  });
}

export default function buildSweptHair(p: SweptHairValues = params.values) {
  return withSweptHairParts(p, parts => compound(parts.map(part => part.shape)));
}
