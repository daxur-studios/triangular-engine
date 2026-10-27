/**
 * Spike S1 (Plan 063) Q2: the runway's placement. Pure and framework-free. The height stamp and the paint now come
 * from the library's flat features (`airfield-features.ts`); the runway distance stays here for the forest clearance.
 */

export const RUNWAY_LENGTH_M = 2000;
export const RUNWAY_WIDTH_M = 45;
/** Flat plateau beyond the runway edge, then the blend back to natural terrain (the stamp's apron and shoulder). Wide enough for the coarsest terrain LOD. */
export const RUNWAY_APRON_M = 120;
export const RUNWAY_SHOULDER_M = 1400;

export type Vec3 = readonly [number, number, number];

/** Where the runway is: a unit direction, its tangent frame and the flattened surface height (metres above the datum). */
export interface IRunwaySite {
  /** Unit direction from the planet centre. */
  readonly centre: Vec3;
  /** Unit tangent along the runway. */
  readonly along: Vec3;
  /** Unit tangent across the runway (`centre x along`). */
  readonly across: Vec3;
  /** Flattened surface height, metres above the sea datum (the same units `modifyElevation` receives). */
  readonly heightM: number;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalise = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Tangent frame at `centre` with the runway heading `headingRad` measured from east towards north. */
export function runwayFrame(centre: Vec3, headingRad: number): { along: Vec3; across: Vec3 } {
  const east = normalise(cross([0, 1, 0], centre));
  const north = cross(centre, east);
  const c = Math.cos(headingRad);
  const s = Math.sin(headingRad);
  const along = normalise([east[0] * c + north[0] * s, east[1] * c + north[1] * s, east[2] * c + north[2] * s]);
  return { along, across: cross(centre, along) };
}

/** Distance outside the runway rectangle in metres (negative inside), in the tangent plane at the site. */
export function runwayDistanceM(site: IRunwaySite, direction: Vec3, radiusM: number): number {
  const a = dot(direction, site.along) * radiusM;
  const b = dot(direction, site.across) * radiusM;
  const qx = Math.abs(a) - RUNWAY_LENGTH_M / 2;
  const qy = Math.abs(b) - RUNWAY_WIDTH_M / 2;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
}

/** What the site search needs from the world sampler. */
export interface IRunwaySiteSampler {
  /** Surface height above the datum in metres, or `null` where the ground is water or ice. */
  heightM(direction: Vec3): number | null;
}

/**
 * Finds the flattest dry spot on a coarse lat/lon scan: the smallest height range over a disc of about 2.6 km
 * radius, all samples land. Deterministic, so every worker finds the same site.
 */
export function findRunwaySite(sampler: IRunwaySiteSampler, radiusM: number, headingRad = 0.4): IRunwaySite | null {
  const rings = [700, 1500, 2600];
  let best: { score: number; centre: Vec3; heightM: number } | null = null;
  for (let latDeg = -50; latDeg <= 50; latDeg += 2) {
    for (let lonDeg = -180; lonDeg < 180; lonDeg += 2) {
      const lat = (latDeg * Math.PI) / 180;
      const lon = (lonDeg * Math.PI) / 180;
      const centre: Vec3 = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
      const centreHeight = sampler.heightM(centre);
      if (centreHeight === null || centreHeight < 20) continue;
      const { along, across } = runwayFrame(centre, headingRad);
      let lo = centreHeight;
      let hi = centreHeight;
      let dry = true;
      for (const ring of rings) {
        for (let k = 0; k < 8 && dry; k += 1) {
          const angle = (k / 8) * Math.PI * 2;
          const dx = (Math.cos(angle) * ring) / radiusM;
          const dy = (Math.sin(angle) * ring) / radiusM;
          const p = normalise([
            centre[0] + along[0] * dx + across[0] * dy,
            centre[1] + along[1] * dx + across[1] * dy,
            centre[2] + along[2] * dx + across[2] * dy,
          ]);
          const h = sampler.heightM(p);
          if (h === null || h < 5) dry = false;
          else {
            lo = Math.min(lo, h);
            hi = Math.max(hi, h);
          }
        }
      }
      if (!dry) continue;
      const score = hi - lo;
      if (!best || score < best.score) best = { score, centre, heightM: centreHeight };
    }
  }
  if (!best) return null;
  const { along, across } = runwayFrame(best.centre, headingRad);
  return { centre: best.centre, along, across, heightM: best.heightM };
}
