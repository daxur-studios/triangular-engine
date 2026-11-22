import {
  compound, cut, defineParams, mirror, Sketcher, unwrap, withScope, type Shape3D, type Vec3,
} from 'brepjs';
import { sculptLock, type LockOrientation, type LockSection } from './sculpt-lock.ts';

export const params = defineParams({
  crownSweep: { type: 'number', default: 18, min: 0, max: 34, step: 1, unit: 'mm', label: 'Crown sweep' },
  backLength: { type: 'number', default: 38, min: 14, max: 58, step: 1, unit: 'mm', label: 'Side and rear lock extension' },
});

export type SweptHairValues = typeof params.values;
type Part = { shape: Shape3D; surface: 'hair' | 'mustache' };

const up: Vec3 = [0, 0, 1];
const front: Vec3 = [0, -1, 0];
const rearWidth: LockOrientation = { widthDirection: [-1, 0, 0] };

export const expected = () => ({ bounds: { yMin: -166 }, tolerancePct: 1 });

/** Keep the upper lip accessory independent of the hairstyle. Coordinates are mm, Z-up and -Y forward. */
export function withSweptHairParts<T>(p: SweptHairValues, consume: (parts: readonly Part[]) => T): T {
  return withScope(scope => {
    const cap = scope.register(new Sketcher('XZ')
      .movePointerTo([0, 453])
      .cubicBezierCurveTo([126, 361], [65, 453], [112, 411])
      .cubicBezierCurveTo([142, 259], [140, 327], [142, 285])
      .cubicBezierCurveTo([138, 189], [142, 233], [138, 205])
      .cubicBezierCurveTo([122, 169], [138, 176], [131, 169])
      .lineTo([0, 169]).close().revolve(up));
    const opening = scope.register(new Sketcher('YZ', [-195, 0, 0])
      .movePointerTo([-190, 118]).lineTo([190, 118]).lineTo([190, 162])
      .cubicBezierCurveTo([79, 225], [147, 162], [115, 189])
      .cubicBezierCurveTo([-83, 356], [40, 266], [-18, 332])
      .cubicBezierCurveTo([-190, 360], [-121, 358], [-153, 360])
      .close().extrude(390, { extrusionDirection: [1, 0, 0] }));
    const arch = scope.register(new Sketcher('XZ', [0, -67, 0])
      .movePointerTo([-161, 200]).lineTo([161, 200]).lineTo([161, 338])
      .cubicBezierCurveTo([-4, 386], [111, 342], [65, 387])
      .cubicBezierCurveTo([-161, 329], [-71, 382], [-106, 355])
      .close().extrude(125, { extrusionDirection: front }));
    const trimmed = scope.register(unwrap(cut(cap, opening)));
    const parts: Part[] = [{ shape: scope.register(unwrap(cut(trimmed, arch))), surface: 'hair' }];

    // Ease into the offsets at both ends to preserve the buried roots and tip direction.
    function lock(start: Vec3, sections: readonly LockSection[], end: Vec3, orientation: LockOrientation, offset: Vec3 = [0, 0, 0]) {
      const displace = ([x, y, z]: Vec3, weight: number): Vec3 => [
        x + offset[0] * weight, y + offset[1] * weight, z + offset[2] * weight,
      ];
      const profiles: LockSection[] = sections.map(([center, width, depth], index) => {
        const t = (index + 1) / (sections.length + 1);
        return [displace(center, t * t * (3 - 2 * t)), width, depth];
      });
      parts.push({ shape: sculptLock(scope, start, profiles, displace(end, 1), orientation), surface: 'hair' });
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
    lock([-26, 19, 426], [
      [[-12, 12, 454], 23, 17], [[12, -7, 480], 21, 14],
      [[34, -30, 498], 14, 10], [[49, -49, 509], 6, 5],
    ], [61, -65, 516], { widthDirection: [1, .7, 0] }, [p.crownSweep * .45, 0, 0]);
    lock([-69, -46, 398], [
      [[-45, -80, 426], 31, 24], [[9, -103, 442], 39, 26],
      [[66, -116, 425], 31, 22], [[115, -125, 397], 13, 9],
    ], [151, -130, 366], [0, -.42, 1], sweep);
    lock([-29, -47, 419], [
      [[-23, -88, 421], 27, 19], [[-10, -119, 405], 25, 17],
      [[-1, -136, 384], 17, 11], [[0, -144, 367], 7, 4.5],
    ], [-4, -149, 351], front, [p.crownSweep * .38, 0, 0]);
    lock([-66, -38, 410], [
      [[-79, -79, 416], 24, 18], [[-91, -108, 397], 23, 17],
      [[-109, -119, 375], 14, 9], [[-126, -123, 355], 6, 4],
    ], [-141, -125, 339], front);
    lock([-58, -5, 413], [
      [[-92, -10, 421], 27, 16], [[-122, -6, 416], 25, 17],
      [[-144, 6, 399], 15, 11], [[-150, 16, 380], 7, 6],
    ], [-151, 27, 368], up);
    lock([-81, 11, 400], [
      [[-106, 21, 429], 21, 15], [[-127, 39, 443], 17, 13],
      [[-143, 55, 442], 10, 8], [[-152, 70, 434], 5, 4],
    ], [-159, 78, 426], up);
    lock([66, -38, 404], [
      [[105, -61, 384], 22, 18], [[123, -66, 357], 18, 14],
      [[135, -66, 339], 10, 7], [[144, -64, 328], 3.5, 2.5],
    ], [150, -62, 321], [.9, -.4, 0]);

    // Bow out high at the temple, tuck in beside the cheek, then curl forward below the ear.
    const sideDrop: Vec3 = [0, 0, -.8 * p.backLength];
    lock([71, -6, 419], [
      [[112, -5, 393], 33, 20], [[140, -5, 341], 33, 20],
      [[145, 3, 284], 26, 16], [[142, 13, 229], 17, 11],
      [[143, 17, 188], 10, 7], [[150, 13, 168], 4, 3],
    ], [157, 7, 158], [1, 0, 0], sideDrop);
    lock([-79, -8, 419], [
      [[-121, -7, 390], 34, 21], [[-144, -7, 341], 34, 21],
      [[-147, 2, 282], 27, 16], [[-140, 13, 222], 18, 11],
      [[-141, 16, 186], 11, 7], [[-148, 12, 165], 4.5, 3],
    ], [-154, 6, 153], [-1, 0, 0], sideDrop);

    // Keep neighboring sections spaced along the bend so the smooth loft does not overshoot.
    // The profile rounds out high, tucks in at the nape, then flicks back up.
    const rearDrop: Vec3 = [0, 0, -p.backLength];
    lock([-86, 33, 402], [
      [[-118, 40, 369], 34, 18], [[-139, 44, 316], 34, 19],
      [[-138, 48, 262], 26, 15], [[-133, 72, 215], 14, 9],
    ], [-154, 104, 224], { widthDirection: [-.45, -.9, 0] }, rearDrop);
    lock([99, 31, 395], [
      [[124, 44, 362], 34, 17], [[138, 48, 309], 34, 18],
      [[137, 53, 258], 25, 15], [[132, 75, 216], 14, 9],
    ], [152, 106, 225], { widthDirection: [-.45, .9, 0] }, rearDrop);
    lock([-81, 66, 375], [
      [[-112, 84, 339], 30, 16], [[-122, 88, 285], 29, 15],
      [[-119, 86, 229], 23, 13], [[-112, 103, 176], 14, 9],
    ], [-133, 135, 182], { widthDirection: [-.62, -.78, 0] }, rearDrop);
    lock([84, 70, 370], [
      [[109, 87, 332], 29, 16], [[120, 92, 282], 27, 15],
      [[115, 91, 237], 21, 12], [[110, 105, 186], 13, 8],
    ], [131, 137, 194], { widthDirection: [-.65, .76, 0] }, rearDrop);
    lock([-57, 57, 410], [
      [[-81, 105, 365], 34, 18], [[-89, 129, 313], 34, 17],
      [[-89, 123, 258], 28, 16], [[-85, 112, 207], 21, 13],
      [[-92, 116, 169], 14, 9], [[-103, 132, 163], 6, 4],
    ], [-119, 151, 172], rearWidth, rearDrop);
    lock([10, 59, 417], [
      [[-1, 120, 391], 36, 18], [[-9, 151, 335], 44, 19],
      [[-9, 145, 272], 43, 17], [[-11, 134, 215], 33, 15],
      [[-14, 133, 164], 24, 13], [[-20, 146, 154], 11, 6],
    ], [-28, 166, 162], rearWidth, rearDrop);
    lock([61, 55, 411], [
      [[65, 106, 380], 35, 17], [[74, 136, 324], 37, 17],
      [[74, 130, 261], 32, 16], [[72, 115, 207], 24, 14],
      [[76, 118, 169], 16, 10], [[89, 133, 161], 7, 5],
    ], [102, 151, 170], rearWidth, rearDrop);

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
