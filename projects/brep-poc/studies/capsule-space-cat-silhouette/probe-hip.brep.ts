import {
  defineParams,
  edgeFinder,
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
import buildCatTube, { params as tubeParams } from '../../src/app/part/capsule-space-cat-tube.brep.ts';

/**
 * Throwaway probe: with a bone rig the legs could be fused into the body solid.
 * Does the hip join fillet the same way the head join does?
 *
 * CAD millimetres, Z-up, -Y forward, matching the tube body part. One front-left
 * leg, splayed slightly outward, top buried inside the body.
 */
export const params = defineParams({
  hipX: {
    type: 'number',
    default: 150,
    min: 120,
    max: 200,
    step: 10,
    unit: 'mm',
    label: 'Hip offset',
    group: 'Silhouette',
  },
  hipY: {
    type: 'number',
    default: -120,
    min: -220,
    max: 0,
    step: 10,
    unit: 'mm',
    label: 'Hip position',
    group: 'Silhouette',
  },
  legRadius: {
    type: 'number',
    default: 62,
    min: 50,
    max: 80,
    step: 2,
    unit: 'mm',
    label: 'Leg radius',
    group: 'Silhouette',
  },
  splay: {
    type: 'number',
    default: 40,
    min: 0,
    max: 120,
    step: 10,
    unit: 'mm',
    label: 'Splay',
    group: 'Silhouette',
  },
  joinFillet: {
    type: 'number',
    default: 60,
    min: 0,
    max: 100,
    step: 5,
    unit: 'mm',
    label: 'Join bevel',
    group: 'Silhouette',
  },
});

export type HipValues = typeof params.values;

const LEG_TOP = -60;
const LEG_LENGTH = 350;

function buildLeg(p: HipValues): Shape3D {
  const r = p.legRadius;
  const bottom = LEG_TOP - LEG_LENGTH;
  const topEquator = LEG_TOP - r;
  const bottomEquator = bottom + r;
  const sections: { z: number; radius: number }[] = [];

  for (const t of [0.995, 0.97, 0.92, 0.85, 0.76, 0.65, 0.53, 0.4, 0.28, 0.16, 0.06]) {
    sections.push({ z: bottomEquator - r * t, radius: r * Math.sqrt(1 - t * t) });
  }
  sections.push({ z: bottomEquator, radius: r });
  const steps = Math.max(1, Math.ceil((topEquator - bottomEquator) / 20));
  for (let i = 1; i < steps; i += 1) {
    sections.push({ z: bottomEquator + ((topEquator - bottomEquator) * i) / steps, radius: r });
  }
  for (const t of [0, 0.16, 0.28, 0.4, 0.53, 0.65, 0.76, 0.85, 0.92, 0.97, 0.995]) {
    sections.push({ z: topEquator + r * t, radius: r * Math.sqrt(1 - t * t) });
  }

  // Splay: the leg's centreline moves outward as it descends.
  const xAt = (z: number) => p.hipX + (p.splay * (LEG_TOP - z)) / LEG_LENGTH;

  return withScope(scope => {
    const wires = sections.map(section => {
      const edge = scope.register(
        unwrap(ellipse(section.radius, section.radius * 0.9995, {
          at: [xAt(section.z), p.hipY, section.z],
          axis: [0, 0, 1],
          xDir: [1, 0, 0],
        })),
      );
      return scope.register(unwrap(wireLoop([edge])));
    });
    return unwrap(loft(wires, {
      ruled: false,
      startPoint: [xAt(bottom), p.hipY, bottom] as Vec3,
      endPoint: [xAt(LEG_TOP), p.hipY, LEG_TOP] as Vec3,
    }));
  });
}

export default function buildHipProbe(p: HipValues = params.values): Shape3D {
  return withScope(scope => {
    // The body without its head bevel, so the only sharp rings left are the hip.
    const body = scope.register(buildCatTube({ ...tubeParams.values, joinFillet: 0 }));
    const leg = scope.register(buildLeg(p));
    const joined = unwrap(fuse(body, leg));
    if (p.joinFillet <= 0.5) return joined;
    const ring = edgeFinder().not(finder => finder.ofCurveType('LINE')).findAll(joined);
    return ring.length ? unwrap(fillet(joined, ring, p.joinFillet)) : joined;
  });
}
