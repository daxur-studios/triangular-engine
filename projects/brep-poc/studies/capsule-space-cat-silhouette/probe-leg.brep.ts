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
 * Throwaway probe: can a leg tube and a paw ball be fused and bevelled at their
 * join the same way the head meets the body?
 *
 * CAD millimetres, Z-up, -Y forward. The leg is a vertical capsule whose top
 * tip is buried above the join; the paw is an ellipsoid centred below it.
 */
export const params = defineParams({
  legLength: {
    type: 'number',
    default: 240,
    min: 160,
    max: 340,
    step: 10,
    unit: 'mm',
    label: 'Leg length',
    group: 'Silhouette',
  },
  legRadius: {
    type: 'number',
    default: 60,
    min: 45,
    max: 75,
    step: 5,
    unit: 'mm',
    label: 'Leg radius',
    group: 'Silhouette',
  },
  pawScale: {
    type: 'number',
    default: 1,
    min: 0.7,
    max: 1.4,
    step: 0.05,
    label: 'Paw scale',
    group: 'Silhouette',
  },
  joinFillet: {
    type: 'number',
    default: 30,
    min: 0,
    max: 80,
    step: 5,
    unit: 'mm',
    label: 'Join bevel',
    group: 'Silhouette',
  },
});

export type LegValues = typeof params.values;

/** Top of the leg, buried in the torso. */
const LEG_TOP = 40;

/** Paw centre, below the leg's straight run. */
const PAW_Z = -218;

function buildLeg(p: LegValues): Shape3D {
  const r = p.legRadius;
  const bottom = LEG_TOP - p.legLength;
  const topEquator = LEG_TOP - r;
  const bottomEquator = bottom + r;
  const sections: { z: number; radius: number }[] = [];

  // Bottom cap, from just off the tip up to its equator.
  for (const t of [0.995, 0.97, 0.92, 0.85, 0.76, 0.65, 0.53, 0.4, 0.28, 0.16, 0.06]) {
    sections.push({ z: bottomEquator - r * t, radius: r * Math.sqrt(1 - t * t) });
  }
  sections.push({ z: bottomEquator, radius: r });
  const steps = Math.max(1, Math.ceil((topEquator - bottomEquator) / 20));
  for (let i = 1; i < steps; i += 1) {
    sections.push({ z: bottomEquator + ((topEquator - bottomEquator) * i) / steps, radius: r });
  }
  // Top cap.
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
    const topTip: Vec3 = [0, 0, LEG_TOP];
    const bottomTip: Vec3 = [0, 0, bottom];
    return unwrap(loft(wires, { ruled: false, startPoint: bottomTip, endPoint: topTip }));
  });
}

export default function buildLegProbe(p: LegValues = params.values): Shape3D {
  const paw = 66 * p.pawScale;
  return withScope(scope => {
    const ball = scope.register(ellipsoid(
      paw * 1.1, paw * 1.25, paw * 0.95, { at: [0, -12, PAW_Z] },
    ));
    const leg = scope.register(buildLeg(p));
    const joined = unwrap(fuse(leg, ball));
    if (p.joinFillet <= 0.5) return joined;
    // Everything except the loft seam is circular, so the join ring is the ring
    // closest to where the leg leaves the paw.
    const ring = edgeFinder()
      .not(finder => finder.ofCurveType('LINE'))
      .findAll(joined);
    return ring.length ? unwrap(fillet(joined, ring, p.joinFillet)) : joined;
  });
}
