import {
  BoxGeometry,
  BufferGeometry,
  Camera,
  ConeGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
} from 'three';
import type { IInstancedMeshData, InstancedMeshComponent } from 'triangular-engine';
import {
  bucketScatterInstancesByLod,
  buildScatterInstancedMeshesByLod,
  type IScatterLodInstancedMesh,
  type ITerrainScatterInstance,
  type ScatterInstanceId,
  type ScatterLodDefinition,
  type ScatterPlacementRules,
} from 'triangular-engine/scatter';

/**
 * Performance scenarios are deterministic scene workloads that the perf
 * harness loads, renders and measures. Each one declares:
 *
 * - `version`: bump whenever the workload changes meaning (geometry, counts,
 *   camera, per-frame work). History entries are only compared when the
 *   scenario id, version and resolved params all match.
 * - `defaults`: tunable params; tests can override them per run.
 * - functional `checks()` that must hold every run (draw calls, instance
 *   counts...). These are hardware-independent and always enforced, so
 *   an engine change that breaks the system fails even when timing is noisy.
 */
export type PerfScenarioParamValue = number | string | boolean;
export type PerfScenarioParams = Record<string, PerfScenarioParamValue>;
export type PerfScenarioFacts = Record<string, PerfScenarioParamValue>;

export interface PerfScenarioCheck {
  name: string;
  expected: PerfScenarioParamValue;
  actual: PerfScenarioParamValue;
  pass: boolean;
}

/** What the harness knows about the frame that was rendered last. */
export interface PerfFrameInfo {
  /** Draw calls in the last frame minus the empty-scene overhead. */
  drawCalls: number;
  /** Triangles in the last frame minus the empty-scene overhead. */
  triangles: number;
}

/**
 * Capabilities the hosting page provides. Template-driven scenarios (e.g.
 * the engine's `<instancedMesh>` component) need Angular to mount them, so
 * the page implements these hooks; plain Three.js scenarios ignore them.
 */
export interface PerfScenarioHost {
  mountInstancedMeshComponent?(options: {
    geometry: BufferGeometry;
    material: Material;
    data: IInstancedMeshData[];
  }): Promise<InstancedMeshComponent>;
  unmountInstancedMeshComponent?(): Promise<void>;
}

export interface PerfScenarioContext {
  /** Group already attached to the engine scene; add scenario objects here. */
  root: Group;
  camera: Camera;
  host: PerfScenarioHost;
  /** Record a named timing sample (ms). Ignored outside a measurement window. */
  recordSample(name: string, valueMs: number): void;
}

export interface PerfScenarioInstance {
  facts(): PerfScenarioFacts;
  checks(frame: PerfFrameInfo): PerfScenarioCheck[];
  /** Called from `engine.tick$` every frame, before render. */
  update?(deltaS: number, elapsedS: number): void;
  dispose(): void | Promise<void>;
}

export interface PerfScenarioDefinition {
  id: string;
  version: number;
  title: string;
  description: string;
  defaults: PerfScenarioParams;
  create(context: PerfScenarioContext, params: PerfScenarioParams): PerfScenarioInstance | Promise<PerfScenarioInstance>;
}

/** Deterministic PRNG so every run places the same instances. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Square XZ grid layout centred on the origin. */
export function gridPosition(index: number, count: number, spacing: number): [number, number, number] {
  const side = Math.max(1, Math.ceil(Math.sqrt(count)));
  const half = ((side - 1) * spacing) / 2;
  return [(index % side) * spacing - half, 0, Math.floor(index / side) * spacing - half];
}

/** Frames a square grid of the given extent from a fixed elevated diagonal. */
export function frameGrid(camera: Camera, extent: number): void {
  const distance = Math.max(extent, 4);
  camera.position.set(distance * 0.75, distance * 0.6, distance * 0.75);
  camera.lookAt(0, 0, 0);
  if (camera instanceof PerspectiveCamera) {
    camera.near = 0.1;
    camera.far = distance * 6;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);
}

function num(params: PerfScenarioParams, key: string): number {
  const value = Number(params[key]);
  if (!Number.isFinite(value)) throw new Error(`INVALID_PARAM: ${key} must be a finite number`);
  return value;
}

function check(name: string, expected: PerfScenarioParamValue, actual: PerfScenarioParamValue): PerfScenarioCheck {
  return { name, expected, actual, pass: expected === actual };
}

/** Box geometry is indexed with 36 indices = 12 triangles per instance. */
const BOX_TRIANGLES = 12;

const emptyScenario: PerfScenarioDefinition = {
  id: 'empty',
  version: 1,
  title: 'Empty scene',
  description: 'Engine loop with nothing to draw. Measures the fixed per-frame overhead floor.',
  defaults: {},
  create: (context) => {
    frameGrid(context.camera, 10);
    return {
      facts: () => ({}),
      checks: (frame) => [check('drawCalls', 0, frame.drawCalls)],
      dispose: () => undefined,
    };
  },
};

function createInstancedBoxes(context: PerfScenarioContext, count: number, spacing: number): { mesh: InstancedMesh; geometry: BoxGeometry; material: MeshStandardMaterial } {
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshStandardMaterial({ color: '#38bdf8' });
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.name = 'perf-instanced-boxes';
  // Measure instance submission, not whole-mesh culling luck.
  mesh.frustumCulled = false;
  const matrix = new Matrix4();
  for (let index = 0; index < count; index++) {
    const [x, y, z] = gridPosition(index, count, spacing);
    matrix.makeTranslation(x, y, z);
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  context.root.add(mesh);
  frameGrid(context.camera, Math.sqrt(count) * spacing);
  return { mesh, geometry, material };
}

const instancedStaticScenario: PerfScenarioDefinition = {
  id: 'instanced-static',
  version: 1,
  title: 'InstancedMesh — static',
  description: 'One InstancedMesh of boxes with matrices written once. Measures pure instanced draw cost.',
  defaults: { count: 20000, spacing: 1.5 },
  create: (context, params) => {
    const count = num(params, 'count');
    const { mesh, geometry, material } = createInstancedBoxes(context, count, num(params, 'spacing'));
    return {
      facts: () => ({ instanceCount: mesh.count }),
      checks: (frame) => [
        check('instanceCount', count, mesh.count),
        check('drawCalls', 1, frame.drawCalls),
        check('triangles', count * BOX_TRIANGLES, frame.triangles),
      ],
      dispose: () => {
        mesh.removeFromParent();
        mesh.dispose();
        geometry.dispose();
        material.dispose();
      },
    };
  },
};

const instancedDynamicScenario: PerfScenarioDefinition = {
  id: 'instanced-dynamic',
  version: 1,
  title: 'InstancedMesh — per-frame matrix updates',
  description: 'Rewrites every instance matrix each frame (wave animation). Measures CPU matrix writes plus GPU buffer upload.',
  defaults: { count: 20000, spacing: 1.5 },
  create: (context, params) => {
    const count = num(params, 'count');
    const spacing = num(params, 'spacing');
    const { mesh, geometry, material } = createInstancedBoxes(context, count, spacing);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    const base = Array.from({ length: count }, (_, index) => gridPosition(index, count, spacing));
    const matrix = new Matrix4();
    let updates = 0;
    return {
      facts: () => ({ instanceCount: mesh.count, updates, firstInstanceY: mesh.instanceMatrix.array[13] }),
      checks: (frame) => [
        check('instanceCount', count, mesh.count),
        check('drawCalls', 1, frame.drawCalls),
        check('triangles', count * BOX_TRIANGLES, frame.triangles),
        check('matricesUpdated', true, updates > 0),
      ],
      update: (_delta, elapsed) => {
        const started = performance.now();
        for (let index = 0; index < count; index++) {
          const [x, , z] = base[index];
          matrix.makeTranslation(x, Math.sin(elapsed * 2 + x * 0.15 + z * 0.1) * 0.75, z);
          mesh.setMatrixAt(index, matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        updates++;
        context.recordSample('scenarioUpdateMs', performance.now() - started);
      },
      dispose: () => {
        mesh.removeFromParent();
        mesh.dispose();
        geometry.dispose();
        material.dispose();
      },
    };
  },
};

/**
 * Exercises the engine's own `<instancedMesh>` component: mounting through
 * Angular signals, then pushing new data through `onDataChanged` each frame.
 * This is the path consumers use, so regressions in the component show here
 * even when raw Three.js instancing is unchanged.
 */
const instancedComponentScenario: PerfScenarioDefinition = {
  id: 'instanced-component',
  version: 1,
  title: '<instancedMesh> component — per-frame data',
  description: 'Mounts the engine InstancedMeshComponent via signals, then pushes new instance data through onDataChanged every frame.',
  defaults: { count: 10000, spacing: 1.5, animate: true },
  create: async (context, params) => {
    const mount = context.host.mountInstancedMeshComponent;
    const unmount = context.host.unmountInstancedMeshComponent;
    if (!mount || !unmount) throw new Error('UNSUPPORTED: host cannot mount the InstancedMeshComponent');
    const count = num(params, 'count');
    const spacing = num(params, 'spacing');
    const animate = params['animate'] !== false;
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshStandardMaterial({ color: '#a78bfa' });
    const data: IInstancedMeshData[] = Array.from({ length: count }, (_, index) => ({
      position: gridPosition(index, count, spacing),
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    }));
    const component = await mount({ geometry, material, data });
    frameGrid(context.camera, Math.sqrt(count) * spacing);
    let updates = 0;
    return {
      facts: () => ({ instanceCount: component.instancedMesh().count, updates }),
      checks: (frame) => [
        check('instanceCount', count, component.instancedMesh().count),
        check('meshInScene', true, component.instancedMesh().parent !== null),
        check('drawCalls', 1, frame.drawCalls),
        check('triangles', count * BOX_TRIANGLES, frame.triangles),
      ],
      update: animate
        ? (_delta, elapsed) => {
            const started = performance.now();
            for (let index = 0; index < count; index++) {
              const entry = data[index];
              entry.position[1] = Math.sin(elapsed * 2 + entry.position[0] * 0.15 + entry.position[2] * 0.1) * 0.75;
              entry.rotation[1] = elapsed + index * 0.001;
            }
            component.onDataChanged(data, component.instancedMesh());
            updates++;
            context.recordSample('scenarioUpdateMs', performance.now() - started);
          }
        : undefined,
      dispose: async () => {
        await unmount();
        geometry.dispose();
        material.dispose();
      },
    };
  },
};

/** Draw-call-bound comparison point for the instanced scenarios. */
const meshesIndividualScenario: PerfScenarioDefinition = {
  id: 'meshes-individual',
  version: 1,
  title: 'Individual meshes',
  description: 'N separate Mesh objects sharing one geometry/material. Measures per-object scene-graph and draw-call cost.',
  defaults: { count: 2000, spacing: 1.5 },
  create: (context, params) => {
    const count = num(params, 'count');
    const spacing = num(params, 'spacing');
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshStandardMaterial({ color: '#f97316' });
    const group = new Group();
    group.name = 'perf-individual-meshes';
    for (let index = 0; index < count; index++) {
      const mesh = new Mesh(geometry, material);
      mesh.position.set(...gridPosition(index, count, spacing));
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    context.root.add(group);
    frameGrid(context.camera, Math.sqrt(count) * spacing);
    return {
      facts: () => ({ meshCount: group.children.length }),
      checks: (frame) => [
        check('meshCount', count, group.children.length),
        check('drawCalls', count, frame.drawCalls),
        check('triangles', count * BOX_TRIANGLES, frame.triangles),
      ],
      dispose: () => {
        group.removeFromParent();
        geometry.dispose();
        material.dispose();
      },
    };
  },
};

/**
 * Scatter streaming churn: a viewpoint circles a field of synthetic
 * instances and the LOD buckets + per-tier InstancedMeshes are rebuilt
 * every `rebuildEveryFrames` frames, as a streamed scatter layer does when
 * the camera moves. Uses the public `triangular-engine/scatter` API.
 */
const scatterLodRebuildScenario: PerfScenarioDefinition = {
  id: 'scatter-lod-rebuild',
  version: 1,
  title: 'Scatter — LOD bucketing + instanced rebuild',
  description: 'Moves a viewpoint through synthetic scatter instances, re-bucketing by LOD and rebuilding per-tier InstancedMeshes.',
  defaults: { count: 20000, radiusM: 150, rebuildEveryFrames: 1, seed: 1234 },
  create: (context, params) => {
    const count = num(params, 'count');
    const radiusM = num(params, 'radiusM');
    const rebuildEveryFrames = Math.max(1, Math.floor(num(params, 'rebuildEveryFrames')));
    const random = mulberry32(num(params, 'seed'));
    const instances: ITerrainScatterInstance[] = Array.from({ length: count }, (_, index) => {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * radiusM;
      return {
        instanceId: `perf-${index}`,
        worldPositionM: [Math.cos(angle) * distance, 0, Math.sin(angle) * distance],
        normal: [0, 1, 0],
        surfaceUp: [0, 1, 0],
        rotationSeed01: random(),
        scaleSeed01: random(),
        embedSeed01: random(),
      };
    });
    const lods: ScatterLodDefinition[] = [
      { kind: 'mesh', maxDistanceM: radiusM * 0.3, castShadow: false },
      { kind: 'mesh', maxDistanceM: radiusM * 0.9, castShadow: false },
    ];
    const rules: ScatterPlacementRules = { alignment: 'align-to-surface-up' };
    const tierAssets = [
      { geometry: new ConeGeometry(0.6, 2, 8), material: new MeshStandardMaterial({ color: '#16a34a' }) },
      { geometry: new BoxGeometry(0.8, 2, 0.8), material: new MeshStandardMaterial({ color: '#15803d' }) },
    ];
    const group = new Group();
    group.name = 'perf-scatter';
    context.root.add(group);
    frameGrid(context.camera, radiusM * 1.6);

    let meshes: readonly IScatterLodInstancedMesh[] = [];
    let previousTierByInstanceId: ReadonlyMap<ScatterInstanceId, number> | undefined;
    let frame = 0;
    let rebuilds = 0;
    let bucketed = 0;

    const rebuild = (elapsedS: number) => {
      const started = performance.now();
      const orbit = radiusM * 0.5;
      const viewpoint: [number, number, number] = [Math.cos(elapsedS * 0.5) * orbit, 2, Math.sin(elapsedS * 0.5) * orbit];
      const bucketing = bucketScatterInstancesByLod({ instances, lods, viewpointWorldM: viewpoint, previousTierByInstanceId, hysteresisM: 2 });
      previousTierByInstanceId = bucketing.tierByInstanceId;
      const bucketedAt = performance.now();
      for (const entry of meshes) {
        entry.mesh.removeFromParent();
        entry.mesh.dispose();
      }
      meshes = buildScatterInstancedMeshesByLod({
        buckets: bucketing.buckets,
        assetsByTier: (tierIndex) => tierAssets[tierIndex],
        rules,
        scale: { min: 0.8, max: 1.2 },
        anchorWorldM: [0, 0, 0],
      });
      for (const entry of meshes) group.add(entry.mesh);
      bucketed = bucketing.buckets.reduce((sum, bucket) => sum + bucket.instances.length, 0);
      rebuilds++;
      context.recordSample('scatterBucketMs', bucketedAt - started);
      context.recordSample('scatterBuildMs', performance.now() - bucketedAt);
    };
    rebuild(0);

    return {
      facts: () => ({ instances: count, bucketedInstances: bucketed, tiers: meshes.length, rebuilds }),
      checks: (frameInfo) => [
        check('drawCalls', meshes.length, frameInfo.drawCalls),
        check('hasVisibleTiers', true, meshes.length > 0),
        check('bucketedWithinTotal', true, bucketed > 0 && bucketed <= count * 2),
      ],
      update: (_delta, elapsed) => {
        frame++;
        if (frame % rebuildEveryFrames === 0) rebuild(elapsed);
      },
      dispose: () => {
        for (const entry of meshes) entry.mesh.dispose();
        group.removeFromParent();
        for (const asset of tierAssets) {
          asset.geometry.dispose();
          asset.material.dispose();
        }
      },
    };
  },
};

export const PERF_SCENARIOS: readonly PerfScenarioDefinition[] = [
  emptyScenario,
  instancedStaticScenario,
  instancedDynamicScenario,
  instancedComponentScenario,
  meshesIndividualScenario,
  scatterLodRebuildScenario,
];

export function findPerfScenario(id: string): PerfScenarioDefinition {
  const found = PERF_SCENARIOS.find((scenario) => scenario.id === id);
  if (!found) throw new Error(`SCENARIO_NOT_FOUND: ${id}`);
  return found;
}

export function resolvePerfParams(definition: PerfScenarioDefinition, overrides: PerfScenarioParams = {}): PerfScenarioParams {
  for (const key of Object.keys(overrides)) {
    if (!(key in definition.defaults)) throw new Error(`INVALID_PARAM: ${definition.id} has no param "${key}"`);
  }
  return { ...definition.defaults, ...overrides };
}
