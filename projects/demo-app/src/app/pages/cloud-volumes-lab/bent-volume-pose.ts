import { Matrix4, Quaternion, Vector3 } from 'three';
import { bend, bendCurvature, bendFrame, type Vec3 } from 'triangular-engine/atmosphere';

/**
 * Plan 051 §The morph: rigid placement of a cloud volume on the bent planet.
 *
 * A volume keeps its box and its march. Only its pose follows the bent ground: the centre goes through `bend()`, and the
 * frame turns by the rotation that carries the globe's east/north/up at that point to the bent ground's. That rotation is
 * returned as `turn`. The volume's light is baked in its own frame, so the sun it should see is `turn * sun` (the globe's
 * sun, turned the same way); then its frame-local sun, and with it the light, does not change with the morph.
 *
 * Lab frame: y up at the map centre, the planet centre at the origin. The map frame of `bend()` is x right, y up (north),
 * z out of the map, so lab = (x, z, -y). The map is the bend's own plane (longitude and latitude times the radius), not
 * Equal Earth. The map centre stays at lab (0, radius, 0) at every morph. Points at the poles (|latitude| = 90 degrees) are
 * not handled.
 */
export interface BentVolumePose {
  /** Where the volume's centre goes, in the lab frame. */
  readonly position: Vector3;
  /** The volume's orientation on the bent ground. */
  readonly quaternion: Quaternion;
  /** The rotation from the globe's local frame at the volume to the bent one. Apply it to the sun for this volume. */
  readonly turn: Quaternion;
}

const toMap = (x: number, y: number, z: number): Vec3 => [x, -z, y];
const toLab = (v: Vec3): Vector3 => new Vector3(v[0], v[2], -v[1]);

function basis(east: Vec3, north: Vec3, up: Vec3): Matrix4 {
  const e = toLab(east);
  const n = toLab(north);
  const u = toLab(up);
  return new Matrix4().makeBasis(e, n, u);
}

/**
 * @param rest The volume's pose on the globe (morph 0), in the lab frame, relative to the planet centre at the origin.
 * @param radius The planet's radius, the same unit as the positions.
 * @param morph 0 (globe) to 1 (flat map).
 */
export function placeOnBentPlanet(
  rest: { readonly position: Vector3; readonly quaternion: Quaternion },
  radius: number,
  morph: number,
): BentVolumePose {
  const distance = rest.position.length();
  const height = distance - radius;
  const direction = toMap(rest.position.x / distance, rest.position.y / distance, rest.position.z / distance);
  const longitude = Math.atan2(direction[0], direction[2]);
  const latitude = Math.asin(Math.max(-1, Math.min(1, direction[1])));
  const x = longitude * radius;
  const y = latitude * radius;
  const k = bendCurvature(morph, radius);

  const bent = bend(x, y, k, height).position;
  const position = toLab(bent).add(new Vector3(0, radius, 0));

  const globeFrame = bendFrame(x, y, 1 / radius);
  const bentFrame = bendFrame(x, y, k);
  const from = basis(globeFrame.east, globeFrame.north, globeFrame.up);
  const to = basis(bentFrame.east, bentFrame.north, bentFrame.up);
  const turn = new Quaternion().setFromRotationMatrix(to.multiply(from.transpose()));
  const quaternion = turn.clone().multiply(rest.quaternion);
  return { position, quaternion, turn };
}
