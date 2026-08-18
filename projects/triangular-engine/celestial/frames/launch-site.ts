import { ICelestialBody } from '../bodies/celestial-body';
import { Vec3d, vec3Scale } from '../math/vec3';
import {
  Quatd,
  quatFromAxisAngle,
  quatFromUnitVectors,
  quatMultiply,
} from '../math/quat';
import { surfaceRadiusM } from '../surfaces/surface-query';

/** A launch site's data record (doc 04 §2) — a pad or runway fixed to a body's surface. */
export interface ILaunchSite {
  id: string;
  bodyId: string;
  /** Degrees, -90 (south pole) to 90 (north pole). */
  latitude: number;
  /** Degrees, measured around the body's polar (+Y) axis from +X. */
  longitude: number;
  /** Meters above the sampled terrain surface at this site. */
  altitude: number;
  /** Degrees of heading about the site's own surface normal (yaw); 0 is the reference direction. */
  orientation: number;
  type: 'pad' | 'runway';
}

export interface ILaunchSitePose {
  positionM: Vec3d;
  rotation: Quatd;
}

const WORLD_UP: Vec3d = [0, 1, 0];

/**
 * Converts an `ILaunchSite`'s lat/lon/altitude into a body-centered PCI
 * position and a rotation whose local +Y is the outward surface normal —
 * preserving the "thrust/gravity along vessel +Y" convention without a
 * special case; here "up" simply stops being literal world-Y. Pure
 * function, unit-testable without Jolt or Three.
 */
export function launchSitePose(
  site: ILaunchSite,
  body: ICelestialBody,
): ILaunchSitePose {
  const latRad = (site.latitude * Math.PI) / 180;
  const lonRad = (site.longitude * Math.PI) / 180;

  const normal: Vec3d = [
    Math.cos(latRad) * Math.cos(lonRad),
    Math.sin(latRad),
    Math.cos(latRad) * Math.sin(lonRad),
  ];
  const radiusM = surfaceRadiusM(body, normal) + site.altitude;

  const surfaceAlign = quatFromUnitVectors(WORLD_UP, normal);
  const headingRad = (site.orientation * Math.PI) / 180;
  // Rotating about the normal itself (which surfaceAlign just made local +Y)
  // changes only heading, never the surface alignment.
  const heading = quatFromAxisAngle(normal, headingRad);

  return {
    positionM: vec3Scale(normal, radiusM),
    rotation: quatMultiply(heading, surfaceAlign),
  };
}
