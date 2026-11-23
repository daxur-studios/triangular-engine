import {
  defineParams,
  edgeFinder,
  ellipsoid,
  ellipse,
  fillet,
  fuse,
  loft,
  unwrap,
  wireLoop,
  withScope,
  type Shape3D,
  type Vec3,
} from 'brepjs';

/**
 * One capsule space cat leg: a straight tube fused to a paw ball and bevelled
 * where the two meet, in the same way the head meets the body.
 *
 * The origin is the ankle joint, which is where the engine's paw socket already
 * sits, and the leg rises along +Z to the hip. The mesh is deliberately straight:
 * the bend comes from a three-bone chain (hip, knee, ankle) and smooth skin
 * weights, so the baked shape only has to be right in its rest pose.
 *
 * CAD millimetres, Z-up, -Y forward, 1 m = 1000 mm at the engine boundary.
 */
export const params = defineParams({
  legLength: {
    type: 'number',
    // Measured hip-to-ankle distance on the Concept Fit cat at rest.
    default: 265,
    min: 180,
    max: 360,
    step: 5,
    unit: 'mm',
    label: 'Hip to ankle',
    group: 'Silhouette',
  },
  legRadius: {
    type: 'number',
    default: 62,
    min: 45,
    max: 80,
    step: 1,
    unit: 'mm',
    label: 'Leg radius',
    group: 'Silhouette',
  },
  pawScale: {
    type: 'number',
    // The paw has to be wider than the leg, or the fuse has no join to bevel.
    default: 1.25,
    min: 1,
    max: 1.5,
    step: 0.05,
    label: 'Paw scale',
    group: 'Silhouette',
  },
  pawForward: {
    type: 'number',
    default: 16,
    min: 0,
    max: 40,
    step: 1,
    unit: 'mm',
    label: 'Paw forward',
    group: 'Silhouette',
  },
  joinFillet: {
    type: 'number',
    default: 60,
    min: 0,
    // 90 and above cannot be solved on the default leg; 85 is the widest that
    // still passes every corner of the parameter space.
    max: 85,
    step: 5,
    unit: 'mm',
    label: 'Join bevel',
    group: 'Silhouette',
  },
});

export type CatLegValues = typeof params.values;

/** Paw shape, as half-extents relative to its own radius. */
const PAW_WIDTH = 1.15;
const PAW_DEPTH = 1.25;
const PAW_HEIGHT = 0.86;
const PAW_DROP = 0.54;

/** How far the leg's buried end reaches below the ankle joint. */
const buriedTip = (p: CatLegValues): number => -p.legRadius * 0.55;

export function pawRadius(p: CatLegValues = params.values): number {
  return p.legRadius * p.pawScale;
}

export const expected = (p: CatLegValues = params.values) => {
  const paw = pawRadius(p);
  return {
    bounds: {
      xMin: -Math.max(p.legRadius, PAW_WIDTH * paw),
      xMax: Math.max(p.legRadius, PAW_WIDTH * paw),
      yMin: Math.min(-p.legRadius, -p.pawForward - PAW_DEPTH * paw),
      yMax: Math.max(p.legRadius, -p.pawForward + PAW_DEPTH * paw),
      zMin: Math.min(buriedTip(p), -PAW_DROP * paw - PAW_HEIGHT * paw),
      zMax: p.legLength,
    },
    tolerancePct: 1,
  };
};

/**
 * Where the preview puts the bones, in metres above the ankle joint. The chain
 * splits the leg at the knee and hands the paw to the ankle bone.
 */
export function restPose(p: CatLegValues = params.values) {
  return {
    hipHeight: p.legLength / 1000,
    pawRadius: pawRadius(p) / 1000,
  };
}

function buildLegTube(p: CatLegValues): Shape3D {
  const r = p.legRadius;
  const bottom = buriedTip(p);
  const top = p.legLength;
  const bottomEquator = bottom + r;
  const topEquator = top - r;
  const sections: { z: number; radius: number }[] = [];

  // Buried bottom cap, from just off its tip up to the equator.
  for (const t of [0.995, 0.97, 0.92, 0.85, 0.76, 0.65, 0.53, 0.4, 0.28, 0.16, 0.06]) {
    sections.push({ z: bottomEquator - r * t, radius: r * Math.sqrt(1 - t * t) });
  }
  sections.push({ z: bottomEquator, radius: r });
  const run = topEquator - bottomEquator;
  const steps = Math.max(1, Math.ceil(run / 20));
  for (let i = 1; i < steps; i += 1) {
    sections.push({ z: bottomEquator + (run * i) / steps, radius: r });
  }
  for (const t of [0, 0.16, 0.28, 0.4, 0.53, 0.65, 0.76, 0.85, 0.92, 0.97, 0.995]) {
    sections.push({ z: topEquator + r * t, radius: r * Math.sqrt(1 - t * t) });
  }

  return withScope(scope => {
    const wires = sections.map(section => {
      const edge = scope.register(
        unwrap(ellipse(section.radius, section.radius * 0.9995, {
          at: [0, 0, section.z],
          axis: [0, 0, 1],
          xDir: [1, 0, 0],
        })),
      );
      return scope.register(unwrap(wireLoop([edge])));
    });
    return unwrap(loft(wires, {
      ruled: false,
      startPoint: [0, 0, bottom] as Vec3,
      endPoint: [0, 0, top] as Vec3,
    }));
  });
}

export default function buildCatLeg(p: CatLegValues = params.values): Shape3D {
  const paw = pawRadius(p);
  return withScope(scope => {
    const ball = scope.register(ellipsoid(
      PAW_WIDTH * paw,
      PAW_DEPTH * paw,
      PAW_HEIGHT * paw,
      { at: [0, -p.pawForward, -PAW_DROP * paw] },
    ));
    const leg = scope.register(buildLegTube(p));
    const joined = unwrap(fuse(ball, leg));
    if (p.joinFillet <= 0.5) return joined;
    // Both surfaces are smooth, so the only real curve left is the ring where
    // the leg leaves the paw. Rounding it is the bevel between leg and paw.
    const ring = edgeFinder().not(finder => finder.ofCurveType('LINE')).findAll(joined);
    return ring.length ? unwrap(fillet(joined, ring, p.joinFillet)) : joined;
  });
}
