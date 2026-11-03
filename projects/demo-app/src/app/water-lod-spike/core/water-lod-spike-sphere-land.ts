/* eslint-disable @typescript-eslint/no-explicit-any */
import { dot, exp, float, vec3 } from 'three/tsl';
import { FIXTURE_GROUND, groundFrame, type HeightSource, type Vec3 } from 'triangular-engine/lod-surface/core';
import { ISLANDS, SEABED_M, SEA_LEVEL_M } from './water-lod-spike-land';

/**
 * Plan 080, water on a planet (stage A): land under the sphere water. The plane spike's islands, laid on a sphere.
 *
 * The islands of `ISLANDS` are put in the tangent frame at the home ground point (east = x, north = -z, the plane's own
 * convention), each at the point of the sphere under that offset. A Gaussian island of standard deviation `sigmaM` is a function
 * of the straight distance to its centre, which at these sizes (up to 3.5 km on a 600 km sphere) is the arc length to better than
 * one part in a million, so the same table gives the same coast as the plane's. Everywhere else the land is the seabed.
 *
 * Heights are metres above the sphere of radius `WATER_SPHERE_RADIUS_M`, the sea level is 0 (the sphere itself).
 */

/** Radius of the water sphere, metres: the planet scene's radius, the size the atmosphere's earth preset is tuned for. */
export const WATER_SPHERE_RADIUS_M = 600_000;

/** The local frame at the home ground point: where the islands sit and where the page's poses stand. */
export const SPHERE_HOME = groundFrame('sphere', FIXTURE_GROUND.sphere);

/** One island on the sphere: the unit direction of its centre, standard deviation and peak height. */
export interface ISphereIsland {
  readonly dir: Vec3;
  readonly sigmaM: number;
  readonly peakM: number;
}

/**
 * The unit direction of the point `eastM` metres east and `northM` metres north of the home point (a tangent offset put back on
 * the sphere). Used for the islands and for the camera poses.
 */
export function sphereDirectionAt(eastM: number, northM: number, radiusM: number = WATER_SPHERE_RADIUS_M): Vec3 {
  const { up, east, north } = SPHERE_HOME;
  const p: Vec3 = [
    up[0] * radiusM + east[0] * eastM + north[0] * northM,
    up[1] * radiusM + east[1] * eastM + north[1] * northM,
    up[2] * radiusM + east[2] * eastM + north[2] * northM,
  ];
  const length = Math.hypot(p[0], p[1], p[2]);
  return [p[0] / length, p[1] / length, p[2] / length];
}

/** The plane spike's islands on the sphere (see the file comment). */
export function sphereIslandsFrom(islands: typeof ISLANDS = ISLANDS, radiusM: number = WATER_SPHERE_RADIUS_M): readonly ISphereIsland[] {
  return islands.map((island) => ({ dir: sphereDirectionAt(island.x, -island.z, radiusM), sigmaM: island.sigmaM, peakM: island.peakM }));
}

/** The islands of the page. */
export const SPHERE_ISLANDS: readonly ISphereIsland[] = sphereIslandsFrom();

/**
 * Land height at a point (x, y, z) of the sphere frame (doubles; its distance from the centre is ignored), metres above the
 * sphere: the seabed plus every island.
 */
export function sphereLandHeightM(
  x: number, y: number, z: number, islands: readonly ISphereIsland[] = SPHERE_ISLANDS, radiusM: number = WATER_SPHERE_RADIUS_M,
): number {
  const length = Math.hypot(x, y, z) || 1;
  const ux = x / length;
  const uy = y / length;
  const uz = z / length;
  let h = SEABED_M;
  for (const island of islands) {
    const dx = ux - island.dir[0];
    const dy = uy - island.dir[1];
    const dz = uz - island.dir[2];
    const distanceSquared = (dx * dx + dy * dy + dz * dz) * radiusM * radiusM;
    h += island.peakM * Math.exp(-distanceSquared / (2 * island.sigmaM * island.sigmaM));
  }
  return h;
}

/** Water depth at a point of the sphere frame, metres: the sea level minus the land height. Negative where the land stands above the sea. */
export function sphereWaterDepthM(x: number, y: number, z: number, islands: readonly ISphereIsland[] = SPHERE_ISLANDS): number {
  return SEA_LEVEL_M - sphereLandHeightM(x, y, z, islands);
}

/** TSL twin of {@link sphereLandHeightM} at a unit direction node (the base point's direction from the centre). */
export function sphereLandHeightNode(up: any, islands: readonly ISphereIsland[] = SPHERE_ISLANDS, radiusM: number = WATER_SPHERE_RADIUS_M): any {
  let h: any = float(SEABED_M);
  for (const island of islands) {
    const d = up.sub(vec3(...island.dir));
    h = h.add(exp(dot(d, d).mul(radiusM * radiusM).div(-2 * island.sigmaM * island.sigmaM)).mul(island.peakM));
  }
  return h;
}

/**
 * `HeightSource` for the land's own `<planetTerrain>`. Analytic, the CPU twin and the TSL nodes reading the one island table;
 * `boundM` is the largest |height| (the seabed, or every peak at once). The vertex stage gives the node the base point
 * `up * radius` (float32), and the node takes its direction.
 */
export function createSphereLandHeights(islands: readonly ISphereIsland[] = SPHERE_ISLANDS, radiusM: number = WATER_SPHERE_RADIUS_M): HeightSource {
  const boundM = Math.max(Math.abs(SEABED_M), Math.abs(SEABED_M + islands.reduce((sum, island) => sum + island.peakM, 0)));
  const direction = (global: any) => global.div(radiusM);
  return {
    id: 'bumps',
    boundM,
    heightAt: (x, y, z) => sphereLandHeightM(x, y, z, islands, radiusM),
    heightNode: (global: any) => sphereLandHeightNode(direction(global).normalize(), islands, radiusM),
    gradientNode(global: any) {
      // d(height)/d(position) = -height_i / sigma^2 * (p - c_i) for each island; the surface takes the part along the tangent plane.
      const up = direction(global).normalize();
      let gradient: any = vec3(0, 0, 0);
      for (const island of islands) {
        const d = up.sub(vec3(...island.dir));
        const sigma2 = island.sigmaM * island.sigmaM;
        const bump = exp(dot(d, d).mul(radiusM * radiusM).div(-2 * sigma2)).mul(-island.peakM * radiusM / sigma2);
        gradient = gradient.add(d.mul(bump));
      }
      return gradient;
    },
  } as HeightSource;
}
