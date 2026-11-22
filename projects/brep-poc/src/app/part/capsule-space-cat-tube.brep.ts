import {
  defineParams,
  edgeFinder,
  ellipsoid,
  fillet,
  fuse,
  loft,
  ellipse,
  unwrap,
  wireLoop,
  withScope,
  type Shape3D,
  type Vec3,
} from 'brepjs';

/**
 * The capsule space cat as a tube body with a sphere head, fused into one solid
 * and bevelled where the two meet.
 *
 * The body is a capsule: a straight tube with rounded ends, so its length is a
 * single parameter. The head is the Concept Fit head ellipsoid, in the same size
 * and place, so the existing eyes, ears, whiskers and nose keep their anchors.
 * The tube's front end sits inside the head; only the join between the tube's
 * side and the head's ball is visible, and that join is what the fillet bevels.
 *
 * The section frame matches the Concept Fit cat's torso group: CAD millimetres,
 * Z-up and -Y forward, with 1000 mm = 1 m at the engine boundary.
 */
export const params = defineParams({
  bodyLength: {
    type: 'number',
    default: 900,
    min: 560,
    max: 1100,
    step: 20,
    unit: 'mm',
    label: 'Body length',
    group: 'Silhouette',
  },
  tubeRadius: {
    type: 'number',
    default: 280,
    min: 200,
    max: 340,
    step: 10,
    unit: 'mm',
    label: 'Tube radius',
    group: 'Silhouette',
  },
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
  joinFillet: {
    type: 'number',
    default: 90,
    min: 0,
    max: 140,
    step: 5,
    unit: 'mm',
    label: 'Join bevel',
    group: 'Silhouette',
  },
});

export type CatTubeValues = typeof params.values;

/** Head lobe: the Concept Fit head sphere, in CAD millimetres. */
const HEAD_Y = -436;
const HEAD_DEPTH = 291;
const HEAD_WIDTH = 318;
const HEAD_HEIGHT = 300;
const HEAD_Z = 130;

/** Where the tube's front tip sits, buried inside the head. */
const BODY_FRONT = -380;
/** Height of the tube's axis; the head sits above it. */
const BODY_Z = 0;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** The rear tip of the tube, in CAD Y. A capsule cannot be shorter than its two caps. */
export function rearTip(p: CatTubeValues = params.values): number {
  return BODY_FRONT + Math.max(p.bodyLength, p.tubeRadius * 2 + 40);
}

/** Section extents, used both for the assertion and by the preview. */
export function silhouetteExtents(p: CatTubeValues = params.values) {
  const headCz = HEAD_Z + p.headRise;
  return {
    width: Math.max(HEAD_WIDTH, p.tubeRadius),
    bottom: Math.min(headCz - HEAD_HEIGHT, BODY_Z - p.tubeRadius),
    top: Math.max(headCz + HEAD_HEIGHT, BODY_Z + p.tubeRadius),
  };
}

export const expected = (p: CatTubeValues = params.values) => {
  const { width, bottom, top } = silhouetteExtents(p);
  return {
    bounds: {
      xMin: -width,
      xMax: width,
      yMin: HEAD_Y - HEAD_DEPTH,
      yMax: rearTip(p),
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
export function rigAnchor(p: CatTubeValues = params.values) {
  return { y: (HEAD_Z + p.headRise) / 1000, z: -HEAD_Y / 1000 };
}

/**
 * The tube body: a straight section with a spherical cap at the rear. The front
 * cap is buried in the head, so it only has to close the solid cleanly.
 */
function buildTube(p: CatTubeValues): Shape3D {
  const radius = p.tubeRadius;
  const rear = rearTip(p);
  const frontEquator = BODY_FRONT + radius;
  const rearEquator = rear - radius;
  const sections: { y: number; radius: number }[] = [];

  // Front cap, from just off the tip out to its equator.
  for (const t of [0.995, 0.97, 0.92, 0.85, 0.76, 0.65, 0.53, 0.4, 0.28, 0.16, 0.06]) {
    sections.push({ y: frontEquator - radius * t, radius: radius * Math.sqrt(1 - t * t) });
  }
  sections.push({ y: frontEquator, radius });
  // Straight run.
  const steps = Math.max(1, Math.ceil((rearEquator - frontEquator) / 20));
  for (let i = 1; i < steps; i += 1) {
    sections.push({ y: frontEquator + ((rearEquator - frontEquator) * i) / steps, radius });
  }
  // Rear cap, from its equator back out to the tip.
  for (const t of [0, 0.16, 0.28, 0.4, 0.53, 0.65, 0.76, 0.85, 0.92, 0.97, 0.995]) {
    sections.push({ y: rearEquator + radius * t, radius: radius * Math.sqrt(1 - t * t) });
  }

  return withScope(scope => {
    const wires = sections.map(section => {
      const edge = scope.register(
        unwrap(ellipse(section.radius, section.radius * 0.9995, {
          at: [0, section.y, BODY_Z],
          axis: [0, 1, 0],
          xDir: [1, 0, 0],
        })),
      );
      return scope.register(unwrap(wireLoop([edge])));
    });
    const frontTip: Vec3 = [0, BODY_FRONT, BODY_Z];
    const backTip: Vec3 = [0, rear, BODY_Z];
    return unwrap(loft(wires, { ruled: false, startPoint: frontTip, endPoint: backTip }));
  });
}

export default function buildCatTube(p: CatTubeValues = params.values): Shape3D {
  return withScope(scope => {
    const head = scope.register(ellipsoid(
      HEAD_WIDTH, HEAD_DEPTH, HEAD_HEIGHT, { at: [0, HEAD_Y, HEAD_Z + p.headRise] },
    ));
    const tube = scope.register(buildTube(p));
    // The returned shape is owned by the caller, so it is deliberately not
    // registered with this scope: a registered handle is disposed when it ends.
    const joined = unwrap(fuse(head, tube));
    if (p.joinFillet <= 0.5) return joined;
    // The tube and the head are both smooth, so the only non-straight edge the
    // fuse leaves is the ring where their surfaces meet. Rounding it is the
    // bevel between the tube and the sphere.
    const ring = edgeFinder().not(finder => finder.ofCurveType('LINE')).findAll(joined);
    return ring.length ? unwrap(fillet(joined, ring, p.joinFillet)) : joined;
  });
}
