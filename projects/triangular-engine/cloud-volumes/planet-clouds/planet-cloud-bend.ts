import { asin, clamp, dot, select, vec3 } from 'three/tsl';
import {
  equalEarthFlat,
  equirectangularFlat,
  planetBentSurfaceNodes,
  seamProjectedLon,
  type IPlanetMorphUniforms,
} from 'triangular-engine/planet-material';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The cloud shell's vertex-stage bend: the TSL position of a shell vertex at morph `uniforms.uMorph`, for the unit
 * direction `dir` (body frame) and the shell's radius `shellRadius` (world units, a uniform node). Internal to this
 * folder (not in the public API): {@link PlanetCloudShell} uses it, and the GPU spec evaluates it.
 *
 * It is the same bend the terrain and ocean materials use (`planetBentSurfaceNodes`), fed the way `planetMorphGraph`
 * feeds it for a geometry without `aFlatPos`: the flat map point is computed from `dir` with the same projection helpers.
 * The flat map's height is `shellRadius - uRadius`, so the layer stays the same distance above the ground at every morph.
 * Without a centre (`uProjMode` 0) the default basis is used, as `planetMorphGraph` does for its static mode.
 *
 * @param uniforms The planet's morph uniforms (`<planet>`'s `morphUniforms`).
 * @param dir The vertex's unit direction from the planet's centre, never a bent or morphed position.
 * @param shellRadius The shell's radius in world units (the planet radius plus the band's altitude).
 * @returns The bent position in body (= scene) axes, as a vec3 node.
 */
export function cloudShellBendPosition(uniforms: IPlanetMorphUniforms, dir: any, shellRadius: any): any {
  const u = uniforms as any;
  const dynamic = u.uProjMode.greaterThan(0.5);
  const forward = select(dynamic, u.uProjForward, vec3(0, 0, 1));
  const up = select(dynamic, u.uProjUp, vec3(0, 1, 0));
  const right = select(dynamic, u.uProjRight, vec3(1, 0, 0));
  const projLon = seamProjectedLon(dir, forward, right);
  const projLat = asin(clamp(dot(dir, up), -1, 1));
  const flatXY = select(
    u.uProjectionType.lessThan(0.5),
    equirectangularFlat(projLon, projLat, u.uMapWidth, u.uMapHeight),
    equalEarthFlat(projLon, projLat, u.uMapWidth),
  );
  return planetBentSurfaceNodes(uniforms, {
    sphere: dir.mul(shellRadius),
    dir,
    flatXY,
    flatHeight: shellRadius.sub(u.uRadius),
    projLon,
    projLat,
  }).pos;
}
