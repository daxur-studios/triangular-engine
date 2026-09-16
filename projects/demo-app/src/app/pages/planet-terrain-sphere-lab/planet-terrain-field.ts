import type {
  ITerrainField,
  ITerrainFieldSample,
  TerrainVector3,
} from 'triangular-engine/terrain';

export interface PlanetTerrainFeatures extends ITerrainFieldSample {
  readonly land: number;
  readonly mountain: number;
  readonly river: number;
  readonly volcano: number;
  readonly mesa: number;
  readonly crater: number;
}

type Direction = TerrainVector3;

const CONTINENTS: readonly [Direction, number, number][] = [
  [[0.86, 0.18, 0.47], 1.05, 0.72],
  [[-0.22, 0.64, 0.74], 0.78, 0.56],
  [[-0.76, -0.2, 0.61], 0.68, 0.48],
  [[0.2, -0.82, 0.54], 0.62, 0.42],
  [[0.45, 0.73, -0.5], 0.46, 0.35],
];

const VOLCANOES: readonly [Direction, number, number][] = [
  [[0.8, 0.33, 0.5], 0.13, 720],
  [[-0.34, 0.76, 0.56], 0.1, 560],
  [[-0.72, -0.27, 0.64], 0.085, 480],
  [[0.18, -0.7, 0.69], 0.075, 420],
];

const RIVERS: readonly [Direction, Direction][] = [
  [[0.82, 0.48, 0.3], [0.73, 0.08, 0.68]],
  [[-0.32, 0.88, 0.34], [-0.78, 0.18, 0.6]],
  [[0.33, -0.72, 0.61], [-0.12, -0.88, 0.45]],
];

/**
 * A deliberately exaggerated but continuous whole-planet fixture.
 *
 * The field consumes unit-sphere directions, so the same sampler can be used
 * by a cubesphere renderer now and by a tangent-plane/cell projection later.
 * It is a demo fixture, not yet the cell-planet production worldgen source.
 */
export class PlanetTerrainField implements ITerrainField {
  readonly minElevationM = -520;
  readonly maxElevationM = 1_360;

  sample(direction: TerrainVector3): ITerrainFieldSample {
    return { elevationM: this.features(direction).elevationM };
  }

  sampleBatch(
    positions: Float64Array,
    output = new Float64Array(positions.length / 3),
  ): Float64Array {
    if (positions.length % 3 !== 0 || output.length !== positions.length / 3)
      throw new RangeError('Planet terrain field buffers must contain xyz triples.');
    for (let index = 0; index < output.length; index += 1) {
      output[index] = this.sample([
        positions[index * 3],
        positions[index * 3 + 1],
        positions[index * 3 + 2],
      ]).elevationM;
    }
    return output;
  }

  features(direction: TerrainVector3): PlanetTerrainFeatures {
    const d = normalize(direction);
    let continental = 0;
    for (const [center, angle, weight] of CONTINENTS)
      continental += sphericalBump(d, center, angle, angle * 0.42) * weight;

    const land = smoothstep(0.28, 0.62, continental);
    const shelf = -410 + land * 420 + continental * 70;

    // Two broad plate-boundary belts, with a third shorter island-chain belt.
    const beltA = belt(d, [0.08, 0.92, 0.38], 0.095);
    const beltB = belt(d, [-0.84, 0.16, 0.52], 0.075);
    const beltC = belt(d, [0.45, -0.2, 0.87], 0.052);
    const beltVariation =
      0.55 +
      0.45 *
        Math.abs(
          Math.sin(d[0] * 17 + d[1] * 9) *
            Math.cos(d[2] * 13 - d[0] * 5),
        );
    const mountain =
      land *
      Math.min(
        1,
        (beltA * 0.95 + beltB * 0.75 + beltC * 0.55) * beltVariation,
      );
    const ridgeDetail =
      0.55 * Math.abs(Math.sin(d[0] * 43 + d[2] * 29)) +
      0.3 * Math.abs(Math.cos(d[1] * 61 - d[0] * 17)) +
      0.15 * Math.abs(Math.sin((d[0] + d[1] - d[2]) * 97));
    const mountains = mountain * (380 + ridgeDetail * 340);

    let volcano = 0;
    for (const [center, angle, height] of VOLCANOES)
      volcano += sphericalBump(d, center, angle, angle * 0.18) * height;
    const crater =
      sphericalBump(d, [0.68, 0.5, -0.53], 0.12, 0.065) * -260;
    const mesa =
      sphericalBump(d, [-0.44, 0.24, -0.86], 0.16, 0.1) * 260;

    const river = Math.max(...RIVERS.map(([from, to]) => riverChannel(d, from, to)));
    const riverValley = river * land * 210;
    const localRelief =
      Math.sin(d[0] * 31 + d[2] * 19) * 9 +
      Math.sin(d[1] * 47 - d[0] * 23) * 6;
    const elevationM = clamp(
      shelf + mountains + volcano + mesa + crater - riverValley + localRelief,
      this.minElevationM,
      this.maxElevationM,
    );

    return {
      elevationM,
      land,
      mountain,
      river,
      volcano: clamp(volcano / 720, 0, 1),
      mesa: clamp(mesa / 260, 0, 1),
      crater: clamp(-crater / 260, 0, 1),
    };
  }
}

function belt(direction: Direction, normal: Direction, width: number): number {
  return Math.exp(-Math.pow(Math.asin(Math.abs(dot(direction, normalize(normal)))) / width, 2));
}

function riverChannel(direction: Direction, from: Direction, to: Direction): number {
  const a = normalize(from);
  const b = normalize(to);
  const normal = normalize(cross(a, b));
  const lineDistance = Math.asin(Math.min(1, Math.abs(dot(direction, normal))));
  const endpointDistance = Math.min(angularDistance(direction, a), angularDistance(direction, b));
  const distance = Math.max(0, Math.min(lineDistance, endpointDistance + 0.035));
  return Math.exp(-Math.pow(distance / 0.018, 2));
}

function sphericalBump(
  direction: Direction,
  center: Direction,
  outerAngle: number,
  innerAngle: number,
): number {
  return smoothstep(
    outerAngle,
    innerAngle,
    angularDistance(direction, normalize(center)),
  );
}

function angularDistance(a: Direction, b: Direction): number {
  return Math.acos(clamp(dot(a, b), -1, 1));
}

function cross(a: Direction, b: Direction): Direction {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Direction, b: Direction): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(value: Direction): Direction {
  const length = Math.hypot(...value) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
