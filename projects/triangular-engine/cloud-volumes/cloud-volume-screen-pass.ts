import { HalfFloatType, LinearFilter, Matrix4, RGBAFormat, RenderTarget, Vector2, type Camera, type PerspectiveCamera, type Scene } from 'three';
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu';
import {
  abs,
  clamp,
  exp,
  float,
  floor,
  fract,
  getViewPosition,
  max,
  min,
  mix,
  normalize,
  pass,
  perspectiveDepthToViewZ,
  rtt,
  select,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { CloudVolume } from './cloud-volume';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Textures a volume samples in the march (density, light, occupancy). */
const TEXTURES_PER_VOLUME = 3;
/** Sampled textures per shader stage WebGPU guarantees; the device may allow more if the renderer requested it. */
const DEFAULT_SAMPLED_TEXTURE_LIMIT = 16;
/** Textures the rest of the cloud shader samples (the scene depth and a spare). */
const RESERVED_TEXTURES = 1;

/** How many volumes one cloud target can march on this renderer's device (fewer chunks means fewer half-res passes). */
function volumesPerTarget(renderer: WebGPURenderer): number {
  const limits = (renderer as any).backend?.device?.limits;
  // Every sampled texture also takes a sampler slot, so the smaller of the two limits decides.
  const limit = limits ? Math.min(limits.maxSampledTexturesPerShaderStage ?? Infinity, limits.maxSamplersPerShaderStage ?? Infinity) : undefined;
  const budget = (typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_SAMPLED_TEXTURE_LIMIT) - RESERVED_TEXTURES;
  return Math.max(1, Math.floor(budget / TEXTURES_PER_VOLUME));
}

export interface CloudVolumeScreenPassOptions {
  /** Cloud resolution per axis relative to the canvas. Default 0.5 (a quarter of the pixels). */
  scale?: number;
  /** How strongly the upsample rejects taps at a different depth. Default 40. */
  depthSharpness?: number;
  /** Temporal reuse: fewer steps per frame, averaged over reprojected history. Default false (measured slower, see runbook 051). */
  temporal?: boolean;
  /** Weight of the reprojected history when it is valid. Default 0.85. */
  historyBlend?: number;
  /** Fraction of the march steps taken per frame while `temporal` is on. Default 0.5. */
  temporalStepScale?: number;
}

interface TemporalChunk {
  accumulated: any;
  history: any;
  target: RenderTarget | null;
}

/**
 * Half-resolution cloud pass (Plan 051, Phase 2b step 3).
 *
 * Draws the scene into a colour + depth target, marches every volume once per low-resolution pixel (each ray stops at the
 * scene depth, so clouds sit in front of and behind other geometry correctly), upsamples the result with a depth-aware
 * bilinear filter and composites it over the scene. It owns the frame's main render, so it replaces the box-proxy meshes:
 * do not add `volume.mesh` to the scene when you use it.
 *
 * Volumes are composited in the order given, first = farthest; there is no per-pixel sorting between volumes. Depth is
 * read as a standard perspective depth (reversed depth buffers work, logarithmic depth does not).
 */
export class CloudVolumeScreenPass {
  readonly pipeline: RenderPipeline;
  /** Debug: `clouds` shows only the composited clouds, `surface` the scene distance (grey, 0 to 1000 m). Call {@link rebuild} after changing it. */
  debugView: 'none' | 'clouds' | 'surface' | 'depth' | 'ray' = 'none';

  private readonly scenePass: any;
  private cloudNodes: any[] = [];
  private marchNodes: any[] = [];
  private temporalChunks: TemporalChunk[] = [];
  private temporal: boolean;
  private readonly historyBlend: number;
  private readonly temporalStepScale: number;
  private readonly uHistoryBlend = uniform(0);
  private historyReady = false;
  private frame = 0;
  private scale: number;
  private readonly uCloudSize = uniform(new Vector2(1, 1));
  private readonly uSharpness: any;
  // The camera nodes of three.js resolve to the full-screen quad's camera in these passes, so the scene camera is mirrored here.
  private readonly uProjectionInverse = uniform(new Matrix4());
  private readonly uCameraWorld = uniform(new Matrix4());
  private readonly uNear = uniform(1);
  private readonly uFar = uniform(1000);
  private readonly size = new Vector2();

  constructor(
    private readonly renderer: WebGPURenderer,
    scene: Scene,
    private readonly camera: Camera,
    private readonly volumes: CloudVolume[],
    options: CloudVolumeScreenPassOptions = {},
  ) {
    this.scale = options.scale ?? 0.5;
    this.temporal = options.temporal ?? false;
    this.historyBlend = options.historyBlend ?? 0.85;
    this.temporalStepScale = options.temporalStepScale ?? 0.5;
    this.uSharpness = uniform(options.depthSharpness ?? 40);
    this.scenePass = pass(scene, camera);
    this.pipeline = new RenderPipeline(renderer);
    this.rebuild();
  }

  /** Changes the cloud resolution per axis relative to the canvas (1 = full). */
  setScale(scale: number): void {
    this.scale = scale;
    this.rebuild();
  }

  /** Turns temporal reuse on or off (it changes the shader graph, so toggle it rarely). */
  setTemporal(on: boolean): void {
    if (on === this.temporal) return;
    this.temporal = on;
    this.rebuild();
  }

  get isTemporal(): boolean {
    return this.temporal;
  }

  /** Draws one frame: the scene, the clouds and the composite. Run each volume's `update()` before this. */
  render(): void {
    this.renderer.getDrawingBufferSize(this.size);
    this.uCloudSize.value.set(Math.floor(this.size.x * this.scale), Math.floor(this.size.y * this.scale));
    const camera = this.camera as PerspectiveCamera;
    this.uProjectionInverse.value.copy(camera.projectionMatrixInverse);
    this.uCameraWorld.value.copy(camera.matrixWorld);
    this.uNear.value = camera.near;
    this.uFar.value = camera.far;
    camera.updateMatrixWorld();
    for (const volume of this.volumes) volume.setView(camera);
    this.frame++;
    for (const volume of this.volumes) {
      volume.uStepScale.value = this.temporal ? this.temporalStepScale : 1;
      volume.uFrameJitter.value = this.temporal ? (this.frame * 0.6180339887) % 1 : 0;
    }
    if (this.temporal) this.prepareHistory();
    this.pipeline.render();
    if (this.temporal) this.storeHistory();
  }

  /** Makes sure each chunk's history target matches the cloud target size; a new target starts empty, so it is not blended. */
  private prepareHistory(): void {
    const width = Math.floor(this.size.x * this.scale);
    const height = Math.floor(this.size.y * this.scale);
    for (const chunk of this.temporalChunks) {
      if (chunk.target?.width === width && chunk.target.height === height) continue;
      chunk.target?.dispose();
      chunk.target = new RenderTarget(width, height, {
        format: RGBAFormat,
        type: HalfFloatType,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
        generateMipmaps: false,
      });
      chunk.history.value = chunk.target.texture;
      this.historyReady = false;
    }
    this.uHistoryBlend.value = this.historyReady ? this.historyBlend : 0;
  }

  /** Copies this frame's accumulated clouds into the history targets for the next frame. */
  private storeHistory(): void {
    let copied = true;
    for (const chunk of this.temporalChunks) {
      const source: RenderTarget | undefined = chunk.accumulated.renderTarget;
      if (!source || !chunk.target || source.width !== chunk.target.width || source.height !== chunk.target.height) {
        copied = false;
        continue;
      }
      this.renderer.copyTextureToTexture(source.texture, chunk.target.texture);
    }
    this.historyReady = copied;
  }

  /** A pipeline the engine's `registerRenderPipeline` accepts (structurally an `EngineRenderPipeline`). */
  asEngineRenderPipeline(): { render(deltaTime: number): void; setSize(width: number, height: number, pixelRatio: number): void } {
    return { render: () => this.render(), setSize: () => undefined };
  }

  dispose(): void {
    for (const volume of this.volumes) volume.onMarchRebuilt = undefined;
    this.disposeNodes();
    this.pipeline.dispose();
    this.scenePass.dispose?.();
  }

  private disposeNodes(): void {
    for (const node of this.cloudNodes) node.dispose?.();
    for (const node of this.marchNodes) node.dispose?.();
    for (const chunk of this.temporalChunks) chunk.target?.dispose();
    this.cloudNodes = [];
    this.marchNodes = [];
    this.temporalChunks = [];
    this.historyReady = false;
  }

  /** Builds (or rebuilds, after a scale change or a march rebuild) the cloud target and the composite. */
  rebuild(): void {
    for (const volume of this.volumes) volume.onMarchRebuilt = () => this.rebuild();
    const sceneColor = this.scenePass.getTextureNode('output');
    const sceneDepth = this.scenePass.getTextureNode('depth');
    const screenUv = uv();

    // March: one ray per low-resolution pixel, ended at the scene surface.
    const viewRay = getViewPosition(screenUv, float(0.5), this.uProjectionInverse);
    const dirWorld = normalize(this.uCameraWorld.mul(vec4(viewRay, 0)).xyz);
    const surfaceMetres = getViewPosition(screenUv, sceneDepth.sample(screenUv).r, this.uProjectionInverse).length();
    // A shader stage binds a limited number of sampled textures (16 unless the renderer requested more) and each volume reads three
    // (density, light, occupancy), so volumes are marched in chunks sized from the device limit, one cloud target per chunk, and the
    // chunks are composited far to near.
    this.disposeNodes();
    const perTarget = volumesPerTarget(this.renderer);
    for (let first = 0; first === 0 || first < this.volumes.length; first += perTarget) {
      let accumulated: any = vec4(0, 0, 0, 0);
      const chunkVolumes = this.volumes.slice(first, first + perTarget);
      for (const volume of chunkVolumes) {
        const march = volume.buildScreenMarchNode(dirWorld, surfaceMetres);
        accumulated = vec4(march.rgb.add(accumulated.rgb.mul(float(1).sub(march.a))), march.a.add(accumulated.a.mul(float(1).sub(march.a))));
      }
      const marched = rtt(accumulated, null, null, { resolutionScale: this.scale });
      this.marchNodes.push(marched);
      if (!this.temporal || chunkVolumes.length === 0) {
        this.cloudNodes.push(marched);
        continue;
      }
      // Temporal reuse: reproject last frame's result to where the nearest volume's visible span now projects, clamp it to the
      // colour range of this frame's 3x3 neighbourhood (rejects ghosts and disocclusions) and blend.
      let best: any = chunkVolumes[0].buildScreenReprojectionNode(dirWorld, surfaceMetres);
      for (const volume of chunkVolumes.slice(1)) {
        const next = volume.buildScreenReprojectionNode(dirWorld, surfaceMetres);
        const closer = next.z.greaterThan(0.5).and(best.z.lessThan(0.5).or(next.w.lessThan(best.w)));
        best = select(closer, next, best);
      }
      const history: any = texture(new RenderTarget(1, 1).texture);
      const cloudUv = uv();
      const texel = vec2(1).div(this.uCloudSize);
      const current = marched.sample(cloudUv);
      let low: any = current;
      let high: any = current;
      for (const [dx, dy] of [
        [-1, -1],
        [0, -1],
        [1, -1],
        [-1, 0],
        [1, 0],
        [-1, 1],
        [0, 1],
        [1, 1],
      ]) {
        const neighbour = marched.sample(cloudUv.add(vec2(dx, dy).mul(texel)));
        low = min(low, neighbour);
        high = max(high, neighbour);
      }
      const reused = clamp(history.sample(best.xy), low, high);
      const accumulatedNode = rtt(mix(current, reused, best.z.mul(this.uHistoryBlend)), null, null, { resolutionScale: this.scale });
      this.cloudNodes.push(accumulatedNode);
      this.temporalChunks.push({ accumulated: accumulatedNode, history, target: null });
    }

    // Composite: depth-aware bilinear upsample of the cloud target over the scene colour.
    const here = abs(perspectiveDepthToViewZ(sceneDepth.sample(screenUv).r, this.uNear, this.uFar));
    const position = screenUv.mul(this.uCloudSize).sub(0.5);
    const base = floor(position);
    const fraction = fract(position);
    const limit = vec2(0.5).div(this.uCloudSize);
    const taps: { uv: any; weight: any }[] = [];
    let weightSum: any = float(0);
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const tapUv = clamp(base.add(vec2(dx, dy)).add(0.5).div(this.uCloudSize), limit, vec2(1).sub(limit));
      const tapDepth = abs(perspectiveDepthToViewZ(sceneDepth.sample(tapUv).r, this.uNear, this.uFar));
      const relative = abs(tapDepth.sub(here)).div(here.max(1e-3));
      const bilinear = (dx ? fraction.x : float(1).sub(fraction.x)).mul(dy ? fraction.y : float(1).sub(fraction.y));
      const weight = bilinear.mul(exp(relative.mul(this.uSharpness).negate()).add(1e-4));
      taps.push({ uv: tapUv, weight });
      weightSum = weightSum.add(weight);
    }
    let clouds: any = vec4(0, 0, 0, 0);
    for (const node of this.cloudNodes) {
      let sum: any = vec4(0, 0, 0, 0);
      for (const tap of taps) sum = sum.add(node.sample(tap.uv).mul(tap.weight));
      const layer = sum.div(weightSum.max(1e-6));
      clouds = vec4(layer.rgb.add(clouds.rgb.mul(float(1).sub(layer.a))), layer.a.add(clouds.a.mul(float(1).sub(layer.a))));
    }
    if (this.debugView === 'clouds') {
      this.pipeline.outputNode = vec4(clouds.rgb, 1);
    } else if (this.debugView === 'depth') {
      this.pipeline.outputNode = vec4(vec3(sceneDepth.sample(screenUv).r), 1);
    } else if (this.debugView === 'ray') {
      this.pipeline.outputNode = vec4(dirWorld.mul(0.5).add(0.5), 1);
    } else if (this.debugView === 'surface') {
      this.pipeline.outputNode = vec4(vec3(surfaceMetres.div(1000)), 1);
    } else this.pipeline.outputNode = vec4(sceneColor.rgb.mul(float(1).sub(clouds.a)).add(clouds.rgb), clouds.a.add(sceneColor.a.mul(float(1).sub(clouds.a))));
    this.pipeline.needsUpdate = true;
  }
}
