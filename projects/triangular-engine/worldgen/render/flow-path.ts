import { BufferAttribute, BufferGeometry, DoubleSide, MathUtils, Mesh, ShaderMaterial, Vector3 } from 'three';
import type { ITerrainField, ITerrainFieldSample, TerrainVector3 } from 'triangular-engine/terrain';
import type { WaterSurface } from 'triangular-engine/water';
import {
  WATER_LOGDEPTH_FRAGMENT_GLSL,
  WATER_LOGDEPTH_PARS_FRAGMENT_GLSL,
  WATER_LOGDEPTH_PARS_VERTEX_GLSL,
  WATER_LOGDEPTH_VERTEX_GLSL,
} from 'triangular-engine/water';

/**
 * Relocated from the `river-lab` demo POC (`river-lab/river-system.ts`) into `worldgen/render` —
 * see runbook 022's "world profiles + per-cell terrain features" spike section. This solves a
 * different problem than `worldgen/core/rivers.ts::traceRivers()`: `traceRivers()` decides
 * *where* a river runs (graph pathfinding over the cell-planet's spherical corner graph);
 * everything in this file assumes a path already exists (as an ordered list of control points)
 * and handles width/flow interpolation, terrain carving, and the actual flowing-water render
 * mesh + shader. A cell-planet caller converts `IPlanetRivers.riverPaths`/`riverFlow` into
 * `RiverControlPoint[]` (position from a corner's unit direction × effective radius, width from
 * `sqrt(flow)` — `rivers.ts`'s own doc comment already names this as the intended use of
 * `riverFlow`) and gets real ribbon+shader rendering instead of a flat debug line.
 */

export interface RiverControlPoint {
  readonly x: number;
  readonly z: number;
  readonly surfaceY: number;
  readonly halfWidth: number;
  readonly flowMps: number;
}

export interface RiverSample {
  readonly x: number;
  readonly z: number;
  readonly surfaceY: number;
  readonly halfWidth: number;
  readonly flowMps: number;
  readonly tangentX: number;
  readonly tangentZ: number;
  readonly distance: number;
  readonly progress: number;
}

/** Canonical flow-path description. Both terrain carving and rendering consume this object;
 * neither subsystem knows about the other. */
export class RiverPath implements WaterSurface {
  readonly points: readonly RiverControlPoint[];
  readonly lengthM: number;
  private readonly cumulativeLengths: readonly number[];

  constructor(points: readonly RiverControlPoint[]) {
    if (points.length < 2) throw new RangeError('A river needs two points.');
    this.points = points;
    const cumulative = [0];
    for (let index = 1; index < points.length; index++) {
      cumulative.push(
        cumulative[index - 1] +
          Math.hypot(points[index].x - points[index - 1].x, points[index].z - points[index - 1].z),
      );
    }
    this.cumulativeLengths = cumulative;
    this.lengthM = cumulative[cumulative.length - 1];
  }

  sample(x: number, z: number): RiverSample {
    let closest: RiverSample | undefined;
    for (let index = 0; index < this.points.length - 1; index++) {
      const start = this.points[index];
      const end = this.points[index + 1];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const lengthSquared = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - start.x) * dx + (z - start.z) * dz) / lengthSquared));
      const sampleX = start.x + dx * t;
      const sampleZ = start.z + dz * t;
      const distance = Math.hypot(x - sampleX, z - sampleZ);
      if (!closest || distance < closest.distance) {
        const segmentLength = Math.sqrt(lengthSquared);
        closest = {
          x: sampleX,
          z: sampleZ,
          surfaceY: MathUtils.lerp(start.surfaceY, end.surfaceY, t),
          halfWidth: MathUtils.lerp(start.halfWidth, end.halfWidth, t),
          flowMps: MathUtils.lerp(start.flowMps, end.flowMps, t),
          tangentX: dx / segmentLength,
          tangentZ: dz / segmentLength,
          distance,
          progress: (this.cumulativeLengths[index] + segmentLength * t) / this.lengthM,
        };
      }
    }
    return closest!;
  }

  getHeight(x: number, z: number, _time: number): number {
    return this.sample(x, z).surfaceY;
  }

  getNormal(_x: number, _z: number, _time: number, out = new Vector3()): Vector3 {
    return out.set(0, 1, 0);
  }

  getFlow(x: number, z: number, _time: number, out = new Vector3()): Vector3 {
    const sample = this.sample(x, z);
    return out.set(sample.tangentX * sample.flowMps, 0, sample.tangentZ * sample.flowMps);
  }
}

/** Composes a channel into any existing terrain field. */
export class RiverCarvedTerrainField implements ITerrainField {
  readonly minElevationM: number;
  readonly maxElevationM: number;

  constructor(
    readonly base: ITerrainField,
    readonly river: RiverPath,
    readonly channelDepthM = 2.5,
    readonly bankWidthMultiplier = 1.7,
  ) {
    this.minElevationM = Math.min(base.minElevationM, ...river.points.map(({ surfaceY }) => surfaceY - channelDepthM));
    this.maxElevationM = base.maxElevationM;
  }

  sample(position: TerrainVector3): ITerrainFieldSample {
    return { elevationM: this.sampleElevation(position) };
  }

  sampleBatch(positions: Float64Array, elevations = new Float64Array(positions.length / 3)): Float64Array {
    if (positions.length % 3 !== 0 || elevations.length !== positions.length / 3) {
      throw new RangeError('Terrain samples must contain packed xyz triples.');
    }
    for (let index = 0; index < elevations.length; index++) {
      elevations[index] = this.sampleElevation([positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]]);
    }
    return elevations;
  }

  private sampleElevation(position: TerrainVector3): number {
    const baseElevation = this.base.sample(position).elevationM;
    const sample = this.river.sample(position[0], position[2]);
    const bankRadius = sample.halfWidth * this.bankWidthMultiplier;
    if (sample.distance >= bankRadius) return baseElevation;
    const normalized = sample.distance / bankRadius;
    const smooth = normalized * normalized * (3 - 2 * normalized);
    const bed = sample.surfaceY - this.channelDepthM;
    return Math.min(baseElevation, MathUtils.lerp(bed, baseElevation, smooth));
  }
}

export function createProceduralRiver(): RiverPath {
  const points: RiverControlPoint[] = [];
  const count = 49;
  for (let index = 0; index < count; index++) {
    const progress = index / (count - 1);
    const z = -470 + progress * 940;
    const envelope = Math.sin(progress * Math.PI);
    const x = envelope * (72 * Math.sin(progress * Math.PI * 3.2) + 24 * Math.sin(progress * Math.PI * 7.4 + 0.8));
    points.push({
      x,
      z,
      surfaceY: 30 - progress * 24,
      halfWidth: 6 + progress * 9,
      flowMps: 1.2 + progress * 1.8,
    });
  }
  return new RiverPath(points);
}

export function createFlowRibbon(river: RiverPath, material: ShaderMaterial): Mesh {
  const count = river.points.length;
  const positions = new Float32Array(count * 2 * 3);
  const uvs = new Float32Array(count * 2 * 2);
  const indices: number[] = [];
  for (let index = 0; index < count; index++) {
    const point = river.points[index];
    const previous = river.points[Math.max(0, index - 1)];
    const next = river.points[Math.min(count - 1, index + 1)];
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const inverseLength = 1 / (Math.hypot(dx, dz) || 1);
    const perpendicularX = -dz * inverseLength;
    const perpendicularZ = dx * inverseLength;
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1;
      const vertex = index * 2 + side;
      positions[vertex * 3] = point.x + perpendicularX * point.halfWidth * sign;
      positions[vertex * 3 + 1] = point.surfaceY + 0.08;
      positions[vertex * 3 + 2] = point.z + perpendicularZ * point.halfWidth * sign;
      uvs[vertex * 2] = side;
      uvs[vertex * 2 + 1] = index / (count - 1);
    }
    if (index < count - 1) {
      const start = index * 2;
      indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 1;
  return mesh;
}

/** @deprecated kept as an alias while callers migrate — same as `createFlowRibbon()`. */
export const createRiverRibbon = createFlowRibbon;

export function createWaterFlowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `
      ${WATER_LOGDEPTH_PARS_VERTEX_GLSL}
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        ${WATER_LOGDEPTH_VERTEX_GLSL}
      }
    `,
    fragmentShader: `
      ${WATER_LOGDEPTH_PARS_FRAGMENT_GLSL}
      uniform float time;
      varying vec2 vUv;
      void main() {
        float travelling = sin((vUv.y * 150.0 - time * 7.0) + sin(vUv.x * 11.0));
        float crossRipple = sin(vUv.x * 28.0 + time * 1.8) * 0.5 + 0.5;
        float foam = smoothstep(0.82, 1.0, travelling * 0.5 + 0.5) * crossRipple;
        float edge = smoothstep(0.0, 0.16, vUv.x) * smoothstep(0.0, 0.16, 1.0 - vUv.x);
        vec3 deep = vec3(0.025, 0.24, 0.31);
        vec3 crest = vec3(0.38, 0.78, 0.78);
        gl_FragColor = vec4(mix(deep, crest, foam * 0.65), 0.83 * edge);
        ${WATER_LOGDEPTH_FRAGMENT_GLSL}
      }
    `,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

/** @deprecated kept as an alias while callers migrate — same as `createWaterFlowMaterial()`. */
export const createFlowMaterial = createWaterFlowMaterial;

/** Lava variant: slower, thicker-reading travelling waves, an emissive orange/red palette
 * instead of water's blue-teal, and full opacity (lava doesn't read as translucent the way
 * water's edge-fade does). Same ribbon geometry (`createFlowRibbon()`) works for both — only the
 * material differs. */
export function createLavaFlowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `
      ${WATER_LOGDEPTH_PARS_VERTEX_GLSL}
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        ${WATER_LOGDEPTH_VERTEX_GLSL}
      }
    `,
    fragmentShader: `
      ${WATER_LOGDEPTH_PARS_FRAGMENT_GLSL}
      uniform float time;
      varying vec2 vUv;
      void main() {
        float travelling = sin((vUv.y * 60.0 - time * 2.2) + sin(vUv.x * 7.0));
        float crust = sin(vUv.x * 14.0 + time * 0.6) * 0.5 + 0.5;
        float glow = smoothstep(0.55, 1.0, travelling * 0.5 + 0.5) * crust;
        vec3 deep = vec3(0.22, 0.03, 0.0);
        vec3 crest = vec3(1.0, 0.55, 0.08);
        gl_FragColor = vec4(mix(deep, crest, glow), 1.0);
        ${WATER_LOGDEPTH_FRAGMENT_GLSL}
      }
    `,
    transparent: false,
    side: DoubleSide,
  });
}
