/* eslint-disable @typescript-eslint/no-explicit-any */
import { Color, Matrix4, Mesh, PerspectiveCamera, RenderTarget, Scene, Vector3, type Camera } from 'three';
import { EngineService } from 'triangular-engine';
import {
  CAP_SLACK,
  LodSelector,
  TERRAIN_DEFAULTS,
  frustumNormals,
  latticeSteps,
  maxLevelFor,
  newAnchor,
  type LatticeAnchor,
  type LodDomain,
} from 'triangular-engine/lod-surface/core';
import { MORPH_POSES, computeMorphFrame, poseOf, projectionBasis, type MorphFrame, type MorphPose, type MorphPoseId, type MorphView } from './morph-frame';
import { FAN_DEFAULT_RAYS } from './morph-fan';
import { instanceCapacity, type MorphPack } from './morph-leaves';
import { createMorphSurfaceMesh, type MorphMethod, type MorphSurfaceMesh } from './morph-surface-mesh';
import { runMorphProbe, type ProbeOptions, type ProbeRenderer, type ProbeResult } from './morph-probe';
import { installStretchMetric, type LodMetric } from './morph-stretch';
import { CRACK_DEFAULTS, RELIEF_KAPPA, reliefLambdaCap, runCrackProbe, type CrackCase, type CrackHost, type CrackProbeOptions, type CrackRow } from './morph-crack-probe';

export interface ILodSurfaceMorphSpikeDiagnostics {
  readonly drawCalls: number;
  readonly triangles: number;
  /** Leaves drawn. */
  readonly leaves: number;
  /** Instances drawn: leaves plus the second instance of each leaf that reaches the cut (morph above 0). */
  readonly instances: number;
  /** Leaves drawn twice because they reach the cut. */
  readonly duplicates: number;
  readonly deepestLevel: number;
  /** The camera's place in the projection basis, degrees and metres above the ground. */
  readonly cameraLonDeg: number;
  readonly cameraLatDeg: number;
  readonly altitudeM: number;
  /** The unwrap-side window of the camera's leaf and the frame's curvature, for the readout. */
  readonly curvature: number;
  /** The pole fan's cost when it is on (vertices, triangles, CPU milliseconds of its last build); undefined otherwise. */
  readonly fanVertices?: number;
  readonly fanTriangles?: number;
  readonly fanBuildMs?: number;
}

/** The knobs of the spike; `setState` takes a partial. */
export interface MorphSpikeState {
  /** Planet radius, metres. */
  radiusM: number;
  /** 0 = globe, 1 = map. */
  morph: number;
  /** Projection centre, degrees. */
  centreLonDeg: number;
  centreLatDeg: number;
  poseId: MorphPoseId;
  /** Overrides of the preset pose's fields (cleared when `poseId` is set). */
  poseOverride: Partial<MorphPose>;
  method: MorphMethod;
  /**
   * The LOD metric: 'sphere' (the library's selector, distances and cell sizes on the unbent sphere; the default) or 'stretch' (each
   * candidate leaf measured at its morphed position, see `morph-stretch.ts`).
   */
  lodMetric: LodMetric;
  /**
   * The selector's leaf cap (default the terrain default, 4,096). The spike's mesh holds up to {@link MAX_SPIKE_LEAF_CAP}; a larger cap
   * is for measuring whether a hole is a budget problem.
   */
  leafCap: number;
  /**
   * The pole fan (iteration 4, `morph-fan.ts`): the leaves that hold a pole of the projection are drawn as a CPU-built polar mesh
   * instead of instances (default false). Never active at morph 0.
   */
  poleFan: boolean;
  /** Rays per full turn of the pole fan (256, 1,024 or 4,096). */
  fanRays: number;
  wireframe: boolean;
  /** Height of every vertex above the base surface, metres (a constant offset along the bent up). */
  heightM: number;
}

export interface ILodSurfaceMorphSpikeSceneHandle {
  getState(): MorphSpikeState;
  /** Setting `poseId` clears `poseOverride` unless the patch carries one. */
  setState(patch: Partial<MorphSpikeState>): void;
  setWireframe(enabled: boolean): void;
  /** Runs the GPU precision probe (see `morph-probe.ts`); the page keeps rendering meanwhile. */
  runProbe(options?: ProbeOptions): Promise<ProbeResult[]>;
  /**
   * Runs the crack probe (see `morph-crack-probe.ts`): draws the probe material over a cleared background for each case of the
   * matrix and counts holes inside the map's outline. The page's own frame is paused while it runs and restored afterwards.
   */
  runCrackProbe(options?: CrackProbeOptions): Promise<CrackRow[]>;
  dispose(): void;
}

const FOV_DEG = 60;
/** The largest `leafCap` the spike's mesh has room for. */
export const MAX_SPIKE_LEAF_CAP = 16_384;
const STEPS = latticeSteps(TERRAIN_DEFAULTS.patchCells, maxLevelFor(TERRAIN_DEFAULTS.patchCells));
const DEFAULT_STATE: MorphSpikeState = {
  radiusM: 6_371_000,
  morph: 0.5,
  centreLonDeg: 0,
  centreLatDeg: 0,
  poseId: 'mid-2m',
  poseOverride: {},
  method: 'p2',
  lodMetric: 'sphere',
  leafCap: TERRAIN_DEFAULTS.leafCap,
  poleFan: false,
  fanRays: FAN_DEFAULT_RAYS,
  wireframe: false,
  heightM: 0,
};
/** The probe selects this many times per case, so that the hysteresis and the budget settle. */
const PROBE_SELECT_PASSES = 3;

/**
 * Plan 059 morph spike: the LOD sphere drawn bent between globe (morph 0) and map (morph 1), with the camera placed
 * in the bent frame. The selector sees the unbent sphere position of the camera (`cull: false`), the vertex stage bends
 * (`morph-surface-mesh.ts`), the camera sits at the bent position with the bent east / north / up for its axes. Part 2 adds the
 * cut (leaves that reach it are drawn twice, once per side), the fragment clip at the map's outline and the crack probe.
 *
 * A plain factory that takes the `EngineService` an existing `<scene>` created; it adds the mesh, steers the engine camera
 * each tick and creates no renderer, controls or loop of its own. The wireframe toggle changes this mesh's own material.
 */
export function createLodSurfaceMorphSpikeScene(
  engine: EngineService,
  onDiagnostics: (diagnostics: ILodSurfaceMorphSpikeDiagnostics) => void,
): ILodSurfaceMorphSpikeSceneHandle {
  const state: MorphSpikeState = { ...DEFAULT_STATE, poseOverride: {} };
  // Room for the duplicates: a view can add at most one second instance per leaf.
  const capacity = instanceCapacity(MAX_SPIKE_LEAF_CAP + CAP_SLACK + 6);
  const surface: MorphSurfaceMesh = createMorphSurfaceMesh({
    domain: domainOf(state.radiusM), patchCells: TERRAIN_DEFAULTS.patchCells, capacity,
  });
  engine.scene.add(surface.mesh);
  engine.scene.add(surface.fan.mesh);

  let selector = newSelector(state.radiusM, state.lodMetric, state.leafCap, () => state);
  let selectorRadius = state.radiusM;
  let selectorMetric: LodMetric = state.lodMetric;
  let selectorCap = state.leafCap;
  const anchor = newAnchor();
  const frustum = new Float64Array(12);
  const right = new Vector3();
  const up = new Vector3();
  const back = new Vector3();
  const basis = new Matrix4();
  let lastSampleMs = 0;
  /** True while the crack probe owns the surface's uniforms: the page's frame is paused. */
  let probeBusy = false;

  function domainOf(radiusM: number): LodDomain {
    return { kind: 'sphere', sizeM: radiusM, warp: 'equal-angle' };
  }

  /** The selector of a radius and metric; 'stretch' measures in the bent frame with the morph, centre and radius `params` gives. */
  function newSelector(
    radiusM: number, metric: LodMetric, leafCap: number, params: () => { morph: number; radiusM: number; centreLonDeg: number; centreLatDeg: number },
  ): LodSelector {
    const sel = new LodSelector({
      domain: domainOf(radiusM), patchCells: TERRAIN_DEFAULTS.patchCells, mode: 'distance', fixedLevel: 5,
      cellPixels: TERRAIN_DEFAULTS.cellPixels, leafCap: Math.min(MAX_SPIKE_LEAF_CAP, leafCap), heightBoundM: 0, cull: false,
      hysteresis: TERRAIN_DEFAULTS.hysteresis,
    });
    if (metric === 'stretch') {
      installStretchMetric(sel, projectionBasis, domainOf(radiusM), STEPS, TERRAIN_DEFAULTS.patchCells, TERRAIN_DEFAULTS.cellPixels, params);
    }
    return sel;
  }

  function currentPose(): MorphPose {
    return { ...poseOf(state.poseId, state.radiusM, state.morph), ...state.poseOverride };
  }

  function currentView(): MorphView {
    return {
      radiusM: state.radiusM, morph: state.morph, centreLonDeg: state.centreLonDeg, centreLatDeg: state.centreLatDeg,
      pose: currentPose(), groundHeightM: 0,
    };
  }

  /**
   * One frame for `view`: the camera placed at the bent camera, the selection for the unbent one and the surface uploaded. The
   * camera's field of view and planes are set when it is a perspective camera; `aspect` is the camera's.
   */
  function stepFrame(
    camera: Camera, view: MorphView, sel: LodSelector, anchorOut: LatticeAnchor, aspect: number, heightPx: number, passes: number, metric: LodMetric = 'sphere',
  ): { frame: MorphFrame; pack: MorphPack } {
    const domain = domainOf(view.radiusM);
    const frame = computeMorphFrame(view, domain, STEPS, anchorOut);
    right.set(...frame.axes.right);
    up.set(...frame.axes.up);
    back.set(-frame.axes.forward[0], -frame.axes.forward[1], -frame.axes.forward[2]);
    camera.position.set(...frame.camBody);
    camera.quaternion.setFromRotationMatrix(basis.makeBasis(right, up, back));
    if (camera instanceof PerspectiveCamera) {
      const near = Math.min(1000, Math.max(0.02, 0.25 * view.pose.altitudeM));
      if (camera.fov !== FOV_DEG || camera.near !== near || camera.far !== 1e9 || camera.aspect !== aspect) {
        camera.fov = FOV_DEG;
        camera.near = near;
        camera.far = 1e9;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      }
    }
    camera.updateMatrixWorld();
    const fov = (FOV_DEG * Math.PI) / 180;
    frustumNormals(frame.axes, fov, aspect, frustum);
    for (let pass = 0; pass < passes; pass++) {
      sel.select({ camera: metric === 'stretch' ? frame.camBody : frame.selectorCamera, pixelAngle: (2 * Math.tan(fov / 2)) / heightPx, frustum });
    }
    const pack = surface.upload(sel, frame);
    return { frame, pack };
  }

  const tick = engine.tick$.subscribe(() => {
    if (probeBusy) return;
    if (state.radiusM !== selectorRadius || state.lodMetric !== selectorMetric || state.leafCap !== selectorCap) {
      selector = newSelector(state.radiusM, state.lodMetric, state.leafCap, () => state);
      selectorRadius = state.radiusM;
      selectorMetric = state.lodMetric;
      selectorCap = state.leafCap;
    }
    const view = currentView();
    const camera = engine.camera;
    const perspective = camera instanceof PerspectiveCamera ? camera : undefined;
    const aspect = perspective ? perspective.aspect : 16 / 9;
    const height = (engine.renderer as any).domElement?.height || 1080;
    surface.setHeight(state.heightM);
    surface.setMethod(state.method);
    surface.setFolding(true);
    surface.setGap(0);
    surface.setRelief(0, 0);
    surface.setPoleFan(state.poleFan, state.fanRays);
    const { frame, pack } = stepFrame(camera, view, selector, anchor, aspect, height, 1, selectorMetric);

    const nowMs = performance.now();
    if (nowMs - lastSampleMs >= 500) {
      lastSampleMs = nowMs;
      const info: any = (engine.renderer as any).info?.render;
      onDiagnostics({
        drawCalls: info?.drawCalls ?? info?.calls ?? 0,
        triangles: pack.instances * 2 * TERRAIN_DEFAULTS.patchCells ** 2 + (pack.fan?.triangles ?? 0),
        ...(pack.fan ? { fanVertices: pack.fan.vertices, fanTriangles: pack.fan.triangles, fanBuildMs: pack.fan.buildMs } : {}),
        leaves: pack.leaves,
        instances: pack.instances,
        duplicates: pack.duplicates,
        deepestLevel: selector.stats.deepestLevel,
        cameraLonDeg: view.pose.lonDeg,
        cameraLatDeg: view.pose.latDeg,
        altitudeM: view.pose.altitudeM,
        curvature: frame.k,
      });
    }
  });

  /** The crack probe's offscreen parts, made on first use. */
  let probeParts: { scene: Scene; mesh: Mesh; camera: PerspectiveCamera; target?: RenderTarget } | undefined;

  async function crackProbe(options?: CrackProbeOptions): Promise<CrackRow[]> {
    if (probeBusy) throw new Error('The crack probe is already running');
    const renderer = engine.renderer as any;
    await renderer.init?.();
    if (typeof renderer.readRenderTargetPixelsAsync !== 'function') throw new Error('The crack probe needs a renderer that reads render targets back');
    if (!probeParts) {
      const scene = new Scene();
      const mesh = new Mesh(surface.mesh.geometry, surface.probeMaterial);
      mesh.frustumCulled = false;
      scene.add(mesh);
      scene.add(surface.fan.probeMesh);
      probeParts = { scene, mesh, camera: new PerspectiveCamera(FOV_DEG, 16 / 9, 0.02, 1e9) };
    }
    const parts = probeParts;
    const probeAnchor = newAnchor();
    const previousTarget = renderer.getRenderTarget?.() ?? null;
    const previousClear = new Color();
    renderer.getClearColor?.(previousClear);
    const previousAlpha = renderer.getClearAlpha?.() ?? 1;
    probeBusy = true;
    let compiled = false;

    const host: CrackHost = {
      prepare(c: CrackCase) {
        surface.setHeight(0);
        surface.setMethod('p2');
        surface.setFolding(c.control !== 'folding-off');
        surface.setGap(c.control === 'gap' ? CRACK_DEFAULTS.gapShare : 0);
        surface.setPoleFan(c.poleFan === true, c.fanRays ?? FAN_DEFAULT_RAYS);
        const view: MorphView = {
          radiusM: c.radiusM, morph: c.morph, centreLonDeg: c.centreLonDeg ?? 0, centreLatDeg: c.centreLatDeg ?? 0,
          pose: { ...poseOf(c.view, c.radiusM, c.morph), ...c.poseOverride }, groundHeightM: 0,
        };
        if (c.control === 'folding-off' || c.control === 'relief') {
          const unitM = (c.radiusM * Math.PI) / 4 / STEPS;
          surface.setRelief(RELIEF_KAPPA, reliefLambdaCap(view.pose.altitudeM, unitM));
        } else {
          surface.setRelief(0, 0);
        }
        const aspect = 16 / 9;
        const heightPx = Math.max(1, Math.round((options?.widthPx ?? CRACK_DEFAULTS.widthPx) / aspect));
        const metric = c.lodMetric ?? 'sphere';
        const { frame, pack } = stepFrame(
          parts.camera, view, newSelector(c.radiusM, metric, c.leafCap ?? TERRAIN_DEFAULTS.leafCap, () => view), probeAnchor, aspect, heightPx, PROBE_SELECT_PASSES, metric,
        );
        parts.mesh.position.copy(surface.mesh.position);
        return { frame, pack, aspect, fovDeg: FOV_DEG };
      },
      async draw(width, height) {
        if (!parts.target || parts.target.width !== width || parts.target.height !== height) {
          parts.target?.dispose();
          parts.target = new RenderTarget(width, height, { depthBuffer: true });
        }
        parts.camera.aspect = width / height;
        parts.camera.updateProjectionMatrix();
        parts.camera.updateMatrixWorld();
        parts.mesh.updateMatrixWorld();
        if (!compiled) {
          compiled = true;
          if (typeof renderer.compileAsync === 'function') await renderer.compileAsync(parts.scene, parts.camera);
        }
        renderer.setClearColor?.(new Color(0, 0, 0), 1);
        renderer.setRenderTarget(parts.target);
        renderer.render(parts.scene, parts.camera);
        renderer.setRenderTarget(previousTarget);
        return (await renderer.readRenderTargetPixelsAsync(parts.target, 0, 0, width, height)) as ArrayLike<number>;
      },
      restore() {
        renderer.setRenderTarget?.(previousTarget);
        renderer.setClearColor?.(previousClear, previousAlpha);
        surface.setFolding(true);
        surface.setGap(0);
        surface.setRelief(0, 0);
        surface.setPoleFan(state.poleFan, state.fanRays);
      },
    };
    try {
      return await runCrackProbe(host, options);
    } finally {
      host.restore();
      probeBusy = false;
    }
  }

  return {
    getState: () => ({ ...state, poseOverride: { ...state.poseOverride } }),
    setState(patch) {
      if (patch.poseId !== undefined && patch.poseOverride === undefined) state.poseOverride = {};
      for (const key of Object.keys(patch) as (keyof MorphSpikeState)[]) {
        if (patch[key] !== undefined) (state as any)[key] = patch[key];
      }
      if (patch.poseId !== undefined && !(patch.poseId in MORPH_POSES)) throw new Error(`Unknown pose ${patch.poseId}`);
      surface.setWireframe(state.wireframe);
    },
    setWireframe(enabled) {
      state.wireframe = enabled;
      surface.setWireframe(enabled);
    },
    async runProbe(options) {
      const renderer = engine.renderer as any;
      await renderer.init?.();
      if (!renderer.backend?.isWebGPUBackend) throw new Error('The precision probe needs the WebGPU renderer');
      return runMorphProbe(renderer as ProbeRenderer, options);
    },
    runCrackProbe: crackProbe,
    dispose() {
      tick.unsubscribe();
      engine.scene.remove(surface.mesh);
      engine.scene.remove(surface.fan.mesh);
      probeParts?.target?.dispose();
      surface.dispose();
    },
  };
}
