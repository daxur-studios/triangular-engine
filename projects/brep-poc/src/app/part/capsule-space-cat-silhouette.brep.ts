import {
  defineParams,
  ellipse,
  loft,
  unwrap,
  wireLoop,
  withScope,
  type Shape3D,
  type Vec3,
} from 'brepjs';

/**
 * A single-surface head and body for the capsule space cat, lofted through
 * oval sections from rump to muzzle. The cheeks, shoulder and chest flow into
 * one another instead of meeting at a sphere/capsule intersection.
 *
 * The section frame matches the Concept Fit cat's torso group: CAD millimetres,
 * Z-up and -Y forward, with 1000 mm = 1 m at the engine boundary. The head
 * ellipsoid is the same size and place as the Concept Fit head sphere, so the
 * existing eyes, ears, whiskers and nose keep their anchors.
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
  blendLength: {
    type: 'number',
    default: 340,
    min: 200,
    max: 380,
    step: 5,
    unit: 'mm',
    label: 'Blend length',
    group: 'Silhouette',
  },
});

export type CatSilhouetteValues = typeof params.values;

/** One oval cross-section of the loft, normal to CAD +Y. Width is the X semi-axis. */
export interface CatSection {
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
}

const REAR_TIP_Y = 470;
const REAR_TIP_Z = -40;
const RUMP_CENTER_Y = 235;
const RUMP_DEPTH = 235;
const BODY_WIDTH = 268;
const BODY_HEIGHT = 243;
const BODY_Z = -52;

const HEAD_Y = -436;
const HEAD_DEPTH = 292;
const HEAD_WIDTH = 318;
const HEAD_HEIGHT = 300;
const HEAD_Z = 100;

const CHEEK_Y = HEAD_Y - 70;
const CHEEK_SPREAD = 150;
const CHEEK_WIDTH_PER_PERCENT = 0.4;
const MIN_HEIGHT = 0.01;

// Finishing offsets on the neck/shoulder outline. The underside is drawn down
// under the chin, then fades out at the head centre so the face anchors stay
// where the rig expects them.
const UNDER_FILL_Y = -300;
const UNDER_FILL_DROP = 20;
const UNDER_FILL_SPREAD = 150;
const FILL_GATE = 140;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/**
 * Draw the underside down under the chin so the chest reaches the jaw by
 * volume. It fades out at the head centre so the face anchors stay put.
 */
function withFills(
  section: { z: number; width: number; height: number },
  y: number,
  shoulderY: number,
): { z: number; width: number; height: number } {
  void shoulderY;
  const under = UNDER_FILL_DROP
    * smoothstep(clamp01((y - HEAD_Y) / FILL_GATE))
    * Math.exp(-(((y - UNDER_FILL_Y) / UNDER_FILL_SPREAD) ** 2));
  return {
    z: section.z - under * 0.5,
    width: section.width,
    height: section.height + under * 0.5,
  };
}

/** The body-only profile, from the rear tip up to where the head blend starts. */
function bodySection(y: number, shoulderY: number): { z: number; width: number; height: number } {
  const rump = clamp01((y - RUMP_CENTER_Y) / RUMP_DEPTH);
  const area = Math.sqrt(Math.max(0, 1 - rump * rump));
  // A gentle bow along the back, so the mid-body is not a flat shelf.
  const bow = 8 * Math.sin(Math.PI * clamp01((y - shoulderY) / (RUMP_CENTER_Y - shoulderY)));
  // The chest and shoulder stand a little taller than the rump, so the back
  // keeps rising into the head instead of dipping at the neck.
  const lift = 88 * Math.exp(-(((y - shoulderY) / 240) ** 2));
  return {
    z: BODY_Z + (REAR_TIP_Z - BODY_Z) * rump + bow + lift * 0.45,
    width: Math.max(BODY_WIDTH * area, MIN_HEIGHT),
    height: Math.max(BODY_HEIGHT * area + lift * 0.55, MIN_HEIGHT),
  };
}

/**
 * A lateral cheek bulge centred just ahead of the head's widest section.
 */
function cheekBulge(y: number, p: CatSilhouetteValues): number {
  const offset = (y - CHEEK_Y) / CHEEK_SPREAD;
  return p.cheekFullness * CHEEK_WIDTH_PER_PERCENT * Math.exp(-(offset * offset));
}

/** The head ellipsoid's section, before the cheek bulge is added. */
function baseHead(y: number, p: CatSilhouetteValues): { z: number; width: number; height: number } {
  const t = clamp01((HEAD_Y - y) / HEAD_DEPTH);
  // A cubic falloff keeps the face full where the eyes and whiskers sit; a
  // plain ellipsoid tapers too fast there and leaves them off the surface.
  const area = Math.sqrt(Math.max(0, 1 - t ** 3));
  return {
    z: HEAD_Z + p.headRise,
    width: Math.max(HEAD_WIDTH * area, MIN_HEIGHT),
    height: Math.max(HEAD_HEIGHT * area, MIN_HEIGHT),
  };
}

/** The head section with the cheek, applied exactly once. */
function headSection(y: number, p: CatSilhouetteValues): { z: number; width: number; height: number } {
  const base = baseHead(y, p);
  const cheek = cheekBulge(y, p);
  return {
    z: base.z - cheek * 0.35,
    width: Math.max(base.width + cheek, MIN_HEIGHT),
    height: Math.max(base.height + cheek * 0.35, MIN_HEIGHT),
  };
}

/**
 * The silhouette at one Y. Behind the blend start it is the body, across the
 * blend it morphs into the head with a cheek bulge, and ahead of the head
 * centre it is the head ellipsoid.
 */
export function sectionAt(y: number, p: CatSilhouetteValues = params.values): CatSection {
  const shoulderY = HEAD_Y + p.blendLength;
  if (y >= shoulderY) {
    return { y, ...withFills(bodySection(y, shoulderY), y, shoulderY) };
  }
  if (y <= HEAD_Y) {
    return { y, ...headSection(y, p) };
  }

  const u = clamp01((shoulderY - y) / (shoulderY - HEAD_Y));
  const s = smoothstep(u);
  const body = bodySection(y, shoulderY);
  // Mix toward the cheek-free head, then add the cheek once, so the width and
  // height stay continuous across the head junction.
  const head = baseHead(HEAD_Y, p);
  const cheek = cheekBulge(y, p);
  const blended = {
    z: body.z + (head.z - body.z) * s - cheek * 0.35,
    width: body.width + (head.width - body.width) * s + cheek,
    height: body.height + (head.height - body.height) * s + cheek * 0.35,
  };
  return { y, ...withFills(blended, y, shoulderY) };
}

/**
 * The oval sections of the loft, ordered from the rump (-Y forward). Each
 * transition gets its own dense sampling so the smooth loft follows it.
 */
export function silhouetteSections(p: CatSilhouetteValues = params.values): CatSection[] {
  const shoulderY = HEAD_Y + p.blendLength;
  const ys: number[] = [];

  // Muzzle to the back of the head: t along the head ellipsoid's forward half.
  // Dense sampling keeps the smooth loft from undershooting the cheek peak.
  for (const t of [
    0.99, 0.98, 0.96, 0.93, 0.89, 0.84, 0.78, 0.71, 0.63, 0.54, 0.45, 0.36, 0.28, 0.21, 0.15, 0.1, 0.06,
  ]) {
    ys.push(HEAD_Y - HEAD_DEPTH * t);
  }
  // Shoulder blend: u from the head back to the shoulder. Sample the two
  // finish peaks as well, so the smooth loft cannot undershoot them.
  const blendUs = [0.03, 0.08, 0.14, 0.2, 0.27, 0.34, 0.42, 0.5, 0.58, 0.66, 0.74, 0.81, 0.87, 0.92, 0.96];
  const peakU = (UNDER_FILL_Y - HEAD_Y) / p.blendLength;
  if (peakU > 0.02 && peakU < 0.98) blendUs.push(peakU);
  for (const u of blendUs.sort((a, b) => a - b)) {
    ys.push(HEAD_Y + (shoulderY - HEAD_Y) * u);
  }
  // Body from the shoulder to the rump centre.
  for (const t of [0.01, 0.06, 0.12, 0.19, 0.27, 0.35, 0.44, 0.53, 0.62, 0.71, 0.8, 0.88, 0.94, 0.98]) {
    ys.push(shoulderY + (RUMP_CENTER_Y - shoulderY) * t);
  }
  // Rump cap out to (but not including) the rear tip.
  for (const t of [0.1, 0.2, 0.31, 0.42, 0.53, 0.63, 0.72, 0.8, 0.87, 0.92, 0.96]) {
    ys.push(RUMP_CENTER_Y + RUMP_DEPTH * t);
  }
  return ys.map(y => sectionAt(y, p));
}

/** Section extents, used both for the assertion and by the preview. */
export function silhouetteExtents(p: CatSilhouetteValues = params.values) {
  let width = 0;
  let bottom = Infinity;
  let top = -Infinity;
  for (const section of silhouetteSections(p)) {
    width = Math.max(width, section.width);
    bottom = Math.min(bottom, section.z - section.height);
    top = Math.max(top, section.z + section.height);
  }
  return { width, bottom, top };
}

export const expected = (p: CatSilhouetteValues = params.values) => {
  const { width, bottom, top } = silhouetteExtents(p);
  return {
    bounds: {
      xMin: -width,
      xMax: width,
      yMin: HEAD_Y - HEAD_DEPTH,
      yMax: REAR_TIP_Y,
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
  return { y: (HEAD_Z + p.headRise) / 1000, z: -HEAD_Y / 1000 };
}

export default function buildCatSilhouette(p: CatSilhouetteValues = params.values): Shape3D {
  const sections = silhouetteSections(p);
  return withScope(scope => {
    const wires = sections.map(section => {
      // OCCT rejects equal radii, and the shoulder can make the oval taller than
      // it is wide: run the major axis along whichever direction is longer.
      const major = Math.max(section.width, section.height);
      const minor = Math.min(section.width, section.height, major * 0.9995);
      const edge = scope.register(
        unwrap(ellipse(major, minor, {
          at: [0, section.y, section.z],
          axis: [0, 1, 0],
          xDir: section.width >= section.height ? [1, 0, 0] : [0, 0, 1],
        })),
      );
      return scope.register(unwrap(wireLoop([edge])));
    });
    const frontTip: Vec3 = [0, HEAD_Y - HEAD_DEPTH, HEAD_Z + p.headRise];
    const rearTip: Vec3 = [0, REAR_TIP_Y, REAR_TIP_Z];
    return unwrap(loft(wires, { ruled: false, startPoint: frontTip, endPoint: rearTip }));
  });
}
