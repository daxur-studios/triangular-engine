import {
  defineParams,
  edgeFinder,
  ellipsoid,
  fillet,
  fuse,
  unwrap,
  withScope,
  type Shape3D,
} from 'brepjs';

/**
 * The capsule space cat's head and body as one solid: a head ball and a body
 * ball, fused and then rounded along the join.
 *
 * The reference character is exactly that shape - two overlapping balls with a
 * soft crease between them - so this builds the two lobes the way the reference
 * draws them and lets the fillet do the blending. The earlier version lofted a
 * single oval profile from rump to muzzle instead; that turns into a smooth
 * sausage and loses the ball head, because one profile cannot be a ball and a
 * barrel at once.
 *
 * The head lobe is the Concept Fit head sphere, in the same size and place, so
 * the existing eyes, ears, whiskers and nose keep their anchors. The section
 * frame matches the Concept Fit cat's torso group: CAD millimetres, Z-up and
 * -Y forward, with 1000 mm = 1 m at the engine boundary.
 */
export const params = defineParams({
  headRise: {
    type: 'number',
    default: 30,
    min: -40,
    max: 140,
    step: 1,
    unit: 'mm',
    label: 'Head rise',
    group: 'Silhouette',
  },
  cheekFullness: {
    type: 'number',
    default: 115,
    min: 70,
    max: 140,
    step: 1,
    unit: '%',
    label: 'Cheek fullness',
    group: 'Silhouette',
  },
  headSetback: {
    type: 'number',
    default: 0,
    min: 0,
    max: 200,
    step: 5,
    unit: 'mm',
    label: 'Head setback',
    group: 'Silhouette',
  },
  joinFillet: {
    type: 'number',
    default: 85,
    min: 0,
    max: 110,
    step: 5,
    unit: 'mm',
    label: 'Join fillet',
    group: 'Silhouette',
  },
});

export type CatSilhouetteValues = typeof params.values;

/** Head lobe: the Concept Fit head sphere, in CAD millimetres. */
const HEAD_Y = -436;
const HEAD_DEPTH = 291;
const HEAD_WIDTH = 318;
const HEAD_HEIGHT = 300;
const HEAD_Z = 130;

/** Body lobe: a barrel that carries the back and belly from shoulder to rump. */
const BODY_CENTER_Y = -40;
const BODY_DEPTH = 380;
const BODY_WIDTH = 345;
const BODY_HEIGHT = 355;
const BODY_Z = -5;

/** Half-width of the head at one cheek setting. */
function headRadius(p: CatSilhouetteValues): number {
  return HEAD_WIDTH * (1 + (p.cheekFullness - 100) * 0.0015);
}

/** Section extents, used both for the assertion and by the preview. */
export function silhouetteExtents(p: CatSilhouetteValues = params.values) {
  const headCz = HEAD_Z + p.headRise;
  return {
    width: Math.max(headRadius(p), BODY_WIDTH),
    bottom: Math.min(headCz - HEAD_HEIGHT, BODY_Z - BODY_HEIGHT),
    top: Math.max(headCz + HEAD_HEIGHT, BODY_Z + BODY_HEIGHT),
  };
}

export const expected = (p: CatSilhouetteValues = params.values) => {
  const { width, bottom, top } = silhouetteExtents(p);
  return {
    bounds: {
      xMin: -width,
      xMax: width,
      yMin: HEAD_Y + p.headSetback - HEAD_DEPTH,
      yMax: BODY_CENTER_Y + BODY_DEPTH,
      zMin: bottom,
      zMax: top,
    },
    tolerancePct: 1,
  };
};

/**
 * Where the preview mounts the original face rig, in metres and the cat's
 * Three.js frame (Y-up, +Z forward). The head sits at CAD Y=-436.
 */
export function rigAnchor(p: CatSilhouetteValues = params.values) {
  return { y: (HEAD_Z + p.headRise) / 1000, z: -(HEAD_Y + p.headSetback) / 1000 };
}

export default function buildCatSilhouette(p: CatSilhouetteValues = params.values): Shape3D {
  return withScope(scope => {
    const head = scope.register(ellipsoid(
      headRadius(p), HEAD_DEPTH, HEAD_HEIGHT,
      { at: [0, HEAD_Y + p.headSetback, HEAD_Z + p.headRise] },
    ));
    const body = scope.register(ellipsoid(
      BODY_WIDTH, BODY_DEPTH, BODY_HEIGHT, { at: [0, BODY_CENTER_Y, BODY_Z] },
    ));
    // The returned shape is owned by the caller, so it is deliberately not
    // registered with this scope: a registered handle is disposed when it ends.
    const joined = unwrap(fuse(head, body));
    if (p.joinFillet <= 0.5) return joined;
    // Everything except the straight seams is the join curve between the two
    // lobes (plus their poles); rounding it is what makes the pair read as one
    // surface. A larger radius is a longer blend.
    const seam = edgeFinder().not(finder => finder.ofCurveType('LINE')).findAll(joined);
    return seam.length ? unwrap(fillet(joined, seam, p.joinFillet)) : joined;
  });
}
