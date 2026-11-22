import { cut, defineParams, Sketcher, unwrap, withScope } from 'brepjs';

/** A rigid hair piece for the workshop's default capsule head, in millimetres and Z-up. */
export const params = defineParams({
  length: { type: 'number', default: 48, min: 0, max: 80, step: 1, unit: 'mm', label: 'Side length' },
  flare: { type: 'number', default: 16, min: 0, max: 35, step: 1, unit: 'mm', label: 'Flare' },
  fringe: { type: 'number', default: 14, min: 0, max: 35, step: 1, unit: 'mm', label: 'Fringe length' },
});

export type BobValues = typeof params.values;

const crown = 460;
const shortHem = 153;

export const expected = (p = params.values) => ({
  bounds: { zMin: shortHem - p.length, zMax: crown },
  tolerancePct: 0.25,
});

export default function buildBob(p: BobValues = params.values) {
  const hem = shortHem - p.length;
  const rim = 161 + p.flare;
  const fringe = 325 - p.fringe;
  return withScope((scope) => {
    // Revolve a cross-section that includes the inside of the cap and the
    // rounded bottom lip. The outer crown and skirt share tangent directions.
    const cap = scope.register(
      new Sketcher('XZ')
        .movePointerTo([0, crown])
        .cubicBezierCurveTo([151, 354], [78, crown], [134, 407])
        .cubicBezierCurveTo([rim, hem + 9], [168, 301], [rim, hem + 63])
        .quadraticBezierCurveTo([rim - 9, hem], [rim, hem])
        .lineTo([150, hem])
        .quadraticBezierCurveTo([144, hem + 8], [144, hem])
        .lineTo([144, 278])
        .cubicBezierCurveTo([0, 443], [144, 376], [84, 443])
        .close()
        .revolve([0, 0, 1]),
    );

    // Forward in the CAD coordinates is -Y. Leave the side and rear curtain
    // intact while cutting out the face. The corners lift into a blunt fringe.
    const opening = scope.register(
      new Sketcher('XZ', [0, -28, 0])
        .movePointerTo([-143, 0])
        .lineTo([143, 0])
        .lineTo([143, fringe - 19])
        .quadraticBezierCurveTo([121, fringe - 2], [143, fringe - 3])
        .quadraticBezierCurveTo([-121, fringe - 2], [0, fringe + 9])
        .quadraticBezierCurveTo([-143, fringe - 19], [-143, fringe - 3])
        .close()
        .extrude(230, { extrusionDirection: [0, -1, 0] }),
    );

    return unwrap(cut(cap, opening));
  });
}
