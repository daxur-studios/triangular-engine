import {
  Fn,
  abs,
  asin,
  atan,
  clamp,
  cos,
  dot,
  float,
  sin,
  vec2,
} from 'three/tsl';

/**
 * TSL ports of the map projection and antimeridian-seam maths. The CPU references are
 * `worldgen/render/core/map-projections.ts` (`EQUIRECTANGULAR_PROJECTION`, `EQUAL_EARTH_PROJECTION`)
 * and `antimeridian-seam.ts`; `projection-nodes.spec.ts` evaluates these graphs on a real GPU backend
 * and compares them to the CPU functions.
 *
 * three's TSL typings do not model `Fn` argument lists, so parameters are loosely typed here.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const EE_A1 = 1.340264;
const EE_A2 = -0.081106;
const EE_A3 = 0.000893;
const EE_A4 = 0.003796;
const EE_M = Math.sqrt(3) / 2;

/** Half-extent of the raw Equal Earth projection at the equator (`lon = pi, lat = 0`). */
export const EQUAL_EARTH_RAW_X_MAX = (() => {
  const theta = Math.asin(EE_M * Math.sin(0));
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  return (
    (Math.PI * Math.cos(theta)) /
    (EE_M * (EE_A1 + 3 * EE_A2 * t2 + t6 * (7 * EE_A3 + 9 * EE_A4 * t2)))
  );
})();

/** Longitude of `dir` in the frame `(forward, right)`, in `(-pi, pi]`. */
export const seamProjectedLon = Fn(([dir, forward, right]: any[]) =>
  atan(dot(dir, right), dot(dir, forward)),
);

/** True when the edge `a -> b` crosses the antimeridian branch cut. */
export const seamEdgeCrosses = Fn(([a, b, forward, right]: any[]) =>
  abs(seamProjectedLon(a, forward, right).sub(seamProjectedLon(b, forward, right))).greaterThan(
    Math.PI,
  ),
);

/** True when any edge of the triangle `(d0, d1, d2)` crosses the antimeridian. */
export const seamTriangleCrosses = Fn(([d0, d1, d2, forward, right]: any[]) =>
  seamEdgeCrosses(d0, d1, forward, right)
    .or(seamEdgeCrosses(d0, d2, forward, right))
    .or(seamEdgeCrosses(d1, d2, forward, right)),
);

/** Equirectangular map position (x, y) for a projected `lon`/`lat`, filling `mapWidth` x `mapHeight`. */
export const equirectangularFlat = Fn(([lon, lat, mapWidth, mapHeight]: any[]) =>
  vec2(
    lon.div(Math.PI).mul(float(mapWidth).mul(0.5)),
    lat.div(Math.PI / 2).mul(float(mapHeight).mul(0.5)),
  ),
);

/** Equal Earth map position (x, y), scaled so the equator spans `mapWidth`. */
export const equalEarthFlat = Fn(([lon, lat, mapWidth]: any[]) => {
  const theta = asin(clamp(sin(lat).mul(EE_M), -1, 1)).toVar();
  const theta2 = theta.mul(theta).toVar();
  const theta6 = theta2.mul(theta2).mul(theta2).toVar();
  const rawX = lon
    .mul(cos(theta))
    .div(
      theta6
        .mul(theta2.mul(9 * EE_A4).add(7 * EE_A3))
        .add(theta2.mul(3 * EE_A2))
        .add(EE_A1)
        .mul(EE_M),
    );
  const rawY = theta.mul(
    theta6.mul(theta2.mul(EE_A4).add(EE_A3)).add(theta2.mul(EE_A2)).add(EE_A1),
  );
  const scale = float(mapWidth).div(2 * EQUAL_EARTH_RAW_X_MAX);
  return vec2(rawX.mul(scale), rawY.mul(scale));
});
