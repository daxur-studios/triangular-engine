import {
  BackSide,
  BoxGeometry,
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  Mesh,
  NormalBlending,
  Frustum,
  Quaternion,
  DataTexture,
  type BufferGeometry,
  RGBAFormat,
  RenderTarget,
  UnsignedByteType,
  Vector3,
} from 'three';
import { NodeMaterial, QuadMesh, type WebGPURenderer } from 'three/webgpu';
import {
  Break,
  Fn,
  If,
  Loop,
  abs,
  ceil,
  clamp,
  dot,
  exp,
  float,
  floor,
  fract,
  int,
  max,
  min,
  mx_fractal_noise_float,
  normalize,
  positionLocal,
  pow,
  screenCoordinate,
  select,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { CLOUD_BLOB_SIGMA } from './cloud-volume-reference';
import { CloudVolumeAtlasLayout } from './cloud-volume-atlas';
import { bakeMeshSdf, type MeshSdfOptions } from './cloud-volume-mesh-sdf';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** `mesh` is filled by {@link CloudVolume.setMeshSource}; until then it reads as empty. */
export type CloudVolumeShape = 'noise' | 'box' | 'blob' | 'mesh';

export interface CloudVolumeOptions {
  /** Box size in metres (x, y, z). Default 600 x 200 x 600. */
  size?: Vector3;
  /** Density texels per side. Default 128. */
  densitySize?: number;
  /** Sun optical-depth texels per side. Default half of `densitySize`. */
  lightSize?: number;
  /** What the density bake writes. Default `noise`; `box` and `blob` are analytic, for specs. */
  shape?: CloudVolumeShape;
  /** Extinction per metre at density 1. Default 0.02. */
  extinction?: number;
  /** Steps of the full-resolution march. Default 64. */
  marchSteps?: number;
  /** Steps of each light-bake ray toward the sun. Default 24. */
  lightSteps?: number;
  /** The sun must turn this far (degrees, in the volume's frame) before the light is rebaked. Default 0.5. */
  sunToleranceDeg?: number;
}

const SHAPE_ID: Record<CloudVolumeShape, number> = { noise: 0, box: 1, blob: 2, mesh: 3 };

function makeAtlasTarget(layout: CloudVolumeAtlasLayout, type: typeof HalfFloatType | typeof UnsignedByteType): RenderTarget {
  return new RenderTarget(layout.width, layout.height, {
    format: RGBAFormat,
    type,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    depthBuffer: false,
    generateMipmaps: false,
  });
}

/**
 * One bounded cloud volume (Plan 051, Phase 1 spike): a density atlas, a baked sun optical-depth atlas at
 * half resolution, and a box-proxy mesh that marches the density at full resolution with a white sun.
 *
 * The box is the mesh's own transform (scale = size in metres), so moving or turning `mesh` moves the cloud.
 * Both bakes are fragment passes into 2D atlas targets, so they run on WebGPU and on the WebGL2 fallback.
 * Call {@link update} once per frame outside any render pass: it rebakes the density only when invalidated and
 * the light only when the sun has turned past the tolerance in the volume's frame.
 */
export class CloudVolume {
  readonly mesh: Mesh;
  readonly size: Vector3;
  readonly densityLayout: CloudVolumeAtlasLayout;
  readonly lightLayout: CloudVolumeAtlasLayout;
  readonly densityTarget: RenderTarget;
  readonly lightTarget: RenderTarget;

  /** Extinction per metre at density 1; read live by both the bake and the march. */
  readonly uExtinction;
  readonly uSunColor = uniform(new Vector3(1, 1, 1));
  readonly uAmbient = uniform(new Vector3(0.12, 0.16, 0.24));
  /** Debug: lower bound on the scattering phase value (0 = off); about 0.3 lifts every view angle to the forward-scatter peak. */
  readonly uPhaseFloor = uniform(0);
  /** Noise controls; changing them needs {@link invalidateDensity}. */
  readonly uNoiseFrequency = uniform(3);
  readonly uNoiseThreshold = uniform(0.38);
  readonly uNoiseGain = uniform(3);
  readonly uNoiseSeed = uniform(0);
  /** Mesh source (Phase 5): half-width of the surface ramp, as a share of the distance band (0..0.5); needs {@link invalidateDensity}. */
  readonly uMeshSoftness = uniform(0.2);
  /** Mesh source: how far noise eats into the edge (0 = a smooth solid, 1 = ragged); needs {@link invalidateDensity}. */
  readonly uMeshErosion = uniform(0.6);
  /** Noise-space units per second that the noise slides by (0 = still); see {@link advanceNoise}. */
  noiseDriftPerSecond = 0;
  /** Seconds between animated-noise rebakes. A smaller step each rebake looks smoother; a longer one costs less. Default 0.5. */
  noiseRefreshSeconds = 0.5;
  private driftClock = 0;
  /** The mesh source's distance field, in the density atlas layout. */
  readonly meshTexture: DataTexture;
  /** Steps of the full-resolution march; read live, so changing it needs no rebuild. */
  readonly uMarchSteps = uniform(64, 'int');
  /** Target march step in density texels; the march takes fewer steps than `uMarchSteps` when a ray is short. */
  readonly uStepTexels = uniform(1.5);
  /** Debug (Plan 051, Phase 2a): 0 turns the per-pixel start jitter off. */
  readonly uJitter = uniform(1);

  /** How many times each bake has run, for specs and the lab readout. */
  densityBakes = 0;
  lightBakes = 0;
  /** Debug: rebake the light every update, to time the worst case. */
  alwaysRebakeLight = false;
  /** A bake is split into this many horizontal bands of its atlas, one per {@link bakeStep}. Default 4. */
  bakeBands = 4;

  private shape: CloudVolumeShape;
  private densityDirty = true;
  private lightDirty = true;
  /** The bake in flight: which atlas, and the next band to draw. */
  private job: { kind: 'density' | 'light'; band: number } | null = null;
  private readonly sunWorld = new Vector3(0, 1, 0);
  private readonly sunLocal = new Vector3(0, 1, 0);
  private readonly bakedSunLocal = new Vector3(0, 1, 0);
  private readonly cosTolerance: number;
  private readonly quaternion = new Quaternion();
  private readonly scratchPosition = new Vector3();
  private readonly scratchScale = new Vector3();

  private readonly uShape = uniform(0);
  private readonly uSunLocal = uniform(new Vector3(0, 1, 0));
  private readonly uCameraLocal = uniform(new Vector3()).onObjectUpdate(({ object, camera }: any) => this.cameraInVolumeFrame(object, camera));
  private readonly inverseScratch = new Matrix4();
  private readonly cameraScratch = new Vector3();
  private readonly uSize = uniform(new Vector3(1, 1, 1));
  private readonly uViewOrigin = uniform(new Vector3());
  private readonly uViewDirections = uniform(new Matrix4());
  /** 1 while the box is inside the camera frustum, else 0: a hidden volume's screen-pass rays end at once, with no recompile. */
  private readonly uScreenVisible = uniform(1);
  private readonly viewFrustum = new Frustum();
  private readonly viewMatrix = new Matrix4();
  /** Whether the last {@link setView} found the box inside the camera frustum. */
  inView = true;
  /** Debug: treats the volume as outside the frustum, so its screen-pass rays end at once (isolates per-volume shader overhead). */
  forceHidden = false;

  private readonly densityQuad: QuadMesh;
  private readonly lightQuad: QuadMesh;
  private readonly densityMaterial: NodeMaterial;
  private readonly lightMaterial: NodeMaterial;
  private readonly marchMaterial: NodeMaterial;
  private fetchEnabled = true;

  constructor(options: CloudVolumeOptions = {}) {
    this.size = (options.size ?? new Vector3(600, 200, 600)).clone();
    const densitySize = options.densitySize ?? 128;
    const lightSize = options.lightSize ?? Math.max(4, densitySize >> 1);
    this.shape = options.shape ?? 'noise';
    this.uExtinction = uniform(options.extinction ?? 0.02);
    this.cosTolerance = Math.cos(((options.sunToleranceDeg ?? 0.5) * Math.PI) / 180);
    this.densityLayout = new CloudVolumeAtlasLayout(densitySize);
    this.lightLayout = new CloudVolumeAtlasLayout(lightSize);
    // Density is a 0..1 fraction, so 8 bits is enough; the sun optical depth is unbounded, so it stays half float.
    this.densityTarget = makeAtlasTarget(this.densityLayout, UnsignedByteType);
    this.lightTarget = makeAtlasTarget(this.lightLayout, HalfFloatType);
    this.uShape.value = SHAPE_ID[this.shape];
    this.uSize.value.copy(this.size);
    // Starts as "all outside" (byte 255) so a mesh volume with no mesh yet is empty.
    this.meshTexture = new DataTexture(new Uint8Array(this.densityLayout.width * this.densityLayout.height * 4).fill(255), this.densityLayout.width, this.densityLayout.height, RGBAFormat, UnsignedByteType);
    this.meshTexture.minFilter = LinearFilter;
    this.meshTexture.magFilter = LinearFilter;
    this.meshTexture.generateMipmaps = false;
    this.meshTexture.needsUpdate = true;

    this.densityMaterial = new NodeMaterial();
    this.densityMaterial.fragmentNode = this.buildDensityNode();
    this.densityQuad = new QuadMesh(this.densityMaterial);
    this.lightMaterial = new NodeMaterial();
    this.lightMaterial.fragmentNode = this.buildLightNode(options.lightSteps ?? 24);
    this.lightQuad = new QuadMesh(this.lightMaterial);

    this.marchMaterial = new NodeMaterial();
    this.marchMaterial.side = BackSide;
    this.marchMaterial.transparent = true;
    this.marchMaterial.depthWrite = false;
    this.marchMaterial.blending = NormalBlending;
    this.marchMaterial.premultipliedAlpha = true;
    this.uMarchSteps.value = options.marchSteps ?? 64;
    this.marchMaterial.fragmentNode = this.buildBoxMarchNode();
    this.mesh = new Mesh(new BoxGeometry(1, 1, 1), this.marchMaterial);
    this.mesh.scale.copy(this.size);
    this.mesh.frustumCulled = false;
  }

  setShape(shape: CloudVolumeShape): void {
    if (shape === this.shape) return;
    this.shape = shape;
    this.uShape.value = SHAPE_ID[shape];
    this.invalidateDensity();
  }

  /**
   * Plan 051 Phase 5: makes the cloud the shape of a closed mesh. The mesh is scaled to fit the box, turned into a
   * band-limited distance field on the CPU (once, here), and the density bake ramps it into cloud with noise eroding the
   * edge. Call again to swap the mesh; tune `uMeshSoftness` / `uMeshErosion` afterwards with {@link invalidateDensity}.
   */
  setMeshSource(geometry: BufferGeometry, options: MeshSdfOptions = {}): void {
    const position = geometry.getAttribute('position');
    const { data } = bakeMeshSdf(position.array, geometry.getIndex()?.array ?? null, this.densityLayout.size, [this.size.x, this.size.y, this.size.z], options);
    (this.meshTexture.image.data as Uint8Array).set(data);
    this.meshTexture.needsUpdate = true;
    this.shape = 'mesh';
    this.uShape.value = SHAPE_ID.mesh;
    this.invalidateDensity();
  }

  /**
   * Plan 051 Phase 5, animated noise: advances the noise offset by `noiseDriftPerSecond` and rebakes the density (and so
   * the light) about every `noiseRefreshSeconds`, never while a bake is still in flight. Call once per frame with the frame
   * time. Nothing happens at drift 0. It costs one density and one light bake per refresh, spread over frames by the
   * bake scheduler, so a slow drift and a longer refresh are cheaper. Noise and mesh volumes only (a mesh's edge erosion
   * is what moves).
   */
  advanceNoise(deltaSeconds: number): void {
    if (this.noiseDriftPerSecond === 0 || (this.shape !== 'noise' && this.shape !== 'mesh')) return;
    this.driftClock += deltaSeconds;
    if (this.driftClock < this.noiseRefreshSeconds || this.job || this.densityDirty) return;
    this.uNoiseSeed.value += this.noiseDriftPerSecond * this.driftClock;
    this.driftClock = 0;
    this.invalidateDensity();
  }

  /** Marks the density, and so the light, for rebake on the next {@link update}. */
  invalidateDensity(): void {
    this.densityDirty = true;
    this.lightDirty = true;
    this.job = null;
  }

  /** Direction toward the sun in world space. The light rebakes once it has turned past the tolerance. */
  setSunDirection(x: number, y: number, z: number): void {
    this.sunWorld.set(x, y, z).normalize();
  }

  /** Rebakes what is stale and refreshes the march's per-frame uniforms. Call outside any render pass. */
  update(renderer: WebGPURenderer): void {
    this.prepare();
    while (this.bakeStep(renderer));
  }

  /**
   * Refreshes the per-frame uniforms and queues a bake when the density is invalid or the sun has turned past the
   * tolerance. Does not draw: spend the queued work with {@link bakeStep}, or let {@link update} finish it at once.
   */
  prepare(): void {
    this.mesh.updateWorldMatrix(true, false);
    this.mesh.matrixWorld.decompose(this.scratchPosition, this.quaternion, this.scratchScale);
    this.sunLocal.copy(this.sunWorld).applyQuaternion(this.quaternion.invert());
    this.uSunLocal.value.copy(this.sunLocal);

    if (this.densityDirty) {
      if (this.job?.kind !== 'density') this.job = { kind: 'density', band: 0 };
    } else if (!this.job && (this.lightDirty || this.alwaysRebakeLight || this.sunLocal.dot(this.bakedSunLocal) < this.cosTolerance)) {
      this.job = { kind: 'light', band: 0 };
      this.bakedSunLocal.copy(this.sunLocal);
    }
  }

  /** Whether a bake is queued: the next {@link bakeStep} draws something. */
  get hasPendingBake(): boolean {
    return this.job !== null;
  }

  /** Draws one band of the queued bake. Returns whether more bands remain. A finished density bake queues the light. */
  bakeStep(renderer: WebGPURenderer): boolean {
    const job = this.job;
    if (!job) return false;
    const bands = Math.max(1, Math.floor(this.bakeBands));
    const isDensity = job.kind === 'density';
    const target = isDensity ? this.densityTarget : this.lightTarget;
    const height = (isDensity ? this.densityLayout : this.lightLayout).height;
    this.bakeBand(renderer, isDensity ? this.densityQuad : this.lightQuad, target, height, job.band, bands);
    job.band++;
    if (job.band < bands) return true;
    if (isDensity) {
      this.densityBakes++;
      this.densityDirty = false;
      this.job = { kind: 'light', band: 0 };
      this.bakedSunLocal.copy(this.sunLocal);
      return true;
    }
    this.lightBakes++;
    this.lightDirty = false;
    this.job = null;
    return false;
  }

  dispose(): void {
    this.densityTarget.dispose();
    this.lightTarget.dispose();
    this.meshTexture.dispose();
    this.densityMaterial.dispose();
    this.lightMaterial.dispose();
    this.marchMaterial.dispose();
    this.mesh.geometry.dispose();
  }

  /**
   * The camera position in the box's unit frame (`[-0.5, 0.5]^3` inside the box), computed in double precision at draw
   * time, so a parent moved late in the frame is still current and no world-space position reaches the shader.
   */
  private cameraInVolumeFrame(object: Mesh, camera: { matrixWorld: Matrix4 }): Vector3 {
    this.inverseScratch.copy(object.matrixWorld).invert();
    return this.cameraScratch.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(this.inverseScratch);
  }

  /** Draws rows `[band, band + 1) / bands` of the atlas; with one band it draws the whole target. */
  private bakeBand(renderer: WebGPURenderer, quad: QuadMesh, target: RenderTarget, height: number, band: number, bands: number): void {
    const previous = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const sliced = bands > 1;
    if (sliced) {
      const y0 = Math.floor((band * height) / bands);
      const y1 = Math.floor(((band + 1) * height) / bands);
      target.scissor.set(0, y0, target.width, y1 - y0);
      target.scissorTest = true;
      // A clear would wipe the bands the other steps drew.
      renderer.autoClear = false;
    }
    renderer.setRenderTarget(target);
    quad.render(renderer);
    renderer.setRenderTarget(previous);
    renderer.autoClear = previousAutoClear;
    target.scissorTest = false;
  }

  /** The unit-frame position of slice channel `channel` of the atlas texel the current fragment writes, from the bake quad's uv. */
  private texelPosition(layout: CloudVolumeAtlasLayout, channel: number): any {
    const n = layout.size;
    const px = floor(uv().x.mul(layout.width));
    const py = floor(uv().y.mul(layout.height));
    const col = floor(px.div(n));
    const row = floor(py.div(n));
    const ix = px.sub(col.mul(n));
    const iy = py.sub(row.mul(n));
    const g = row.mul(layout.columns).add(col);
    const z = g.mul(CloudVolumeAtlasLayout.STRIDE).add(channel);
    return vec3(ix.add(0.5).div(n), iy.add(0.5).div(n), z.add(0.5).div(n));
  }

  private buildDensityNode(): any {
    const density = (p: any) => {
      const centered = p.sub(0.5);
      const noise = mx_fractal_noise_float(p.mul(this.uNoiseFrequency).add(this.uNoiseSeed), 4, 2.0, 0.5)
        .mul(0.5)
        .add(0.5);
      // A vertical squash keeps the cloud away from the box faces so the proxy edge never shows.
      const radius = vec3(centered.x, centered.y.mul(1.5), centered.z).length();
      const falloff = float(1).sub(smoothstep(0.2, 0.5, radius));
      const noiseDensity = clamp(noise.mul(falloff).sub(this.uNoiseThreshold).mul(this.uNoiseGain), 0, 1);
      const blob = exp(
        dot(centered, centered)
          .negate()
          .div(2 * CLOUD_BLOB_SIGMA * CLOUD_BLOB_SIGMA),
      );
      // Mesh: 1 inside the surface, a smooth ramp across it, then noise eats the ramp so the edge reads as cloud.
      const sdf = this.densityLayout.sample(this.meshTexture, p);
      const solid = float(1).sub(smoothstep(float(0.5).sub(this.uMeshSoftness), float(0.5).add(this.uMeshSoftness), sdf));
      const meshDensity = clamp(solid.sub(float(1).sub(noise).mul(this.uMeshErosion)).div(max(float(1).sub(this.uMeshErosion), 0.05)), 0, 1);
      return select(
        this.uShape.lessThan(0.5),
        noiseDensity,
        select(this.uShape.lessThan(1.5), float(1), select(this.uShape.lessThan(2.5), blob, meshDensity)),
      );
    };
    const [a, b, c, d] = [0, 1, 2, 3].map((k) => density(this.texelPosition(this.densityLayout, k)));
    return vec4(a, b, c, d);
  }

  private buildLightNode(lightSteps: number): any {
    const size = this.uSize;
    const half = size.mul(0.5);
    return Fn(() => {
      const dir = normalize(this.uSunLocal);
      // Slab exit distance toward the sun, per axis; a near-zero component never exits.
      const exit = (d: any, h: any, o: any) => {
        const safe = select(abs(d).lessThan(1e-6), float(1e-6), d);
        return select(safe.greaterThan(0), h, h.negate()).sub(o).div(safe);
      };
      const opticalDepth = (channel: number) => {
        const origin = this.texelPosition(this.lightLayout, channel).sub(0.5).mul(size);
        const length = max(min(min(exit(dir.x, half.x, origin.x), exit(dir.y, half.y, origin.y)), exit(dir.z, half.z, origin.z)), 0);
        const dt = length.div(lightSteps);
        const sum = float(0).toVar();
        Loop(lightSteps, ({ i }: { i: any }) => {
          const q = origin.add(dir.mul(float(i).add(0.5).mul(dt)));
          sum.addAssign(this.densityLayout.sample(this.densityTarget.texture, q.div(size).add(0.5)));
        });
        return sum.mul(dt).mul(this.uExtinction);
      };
      return vec4(opticalDepth(0), opticalDepth(1), opticalDepth(2), opticalDepth(3));
    })();
  }

  /**
   * Debug (Plan 051, Phase 2a): `false` rebuilds the march with an analytic blob instead of the atlas reads, to time the
   * fetches. It recompiles the shader, so toggle it rarely.
   */
  setFetchEnabled(on: boolean): void {
    if (on === this.fetchEnabled) return;
    this.fetchEnabled = on;
    this.marchMaterial.fragmentNode = this.buildBoxMarchNode();
    this.marchMaterial.needsUpdate = true;
    this.onMarchRebuilt?.();
  }

  /** Called after {@link setFetchEnabled} rebuilds the march, so a screen pass can rebuild its own copy. */
  onMarchRebuilt: (() => void) | undefined;

  /**
   * Points the screen-space march at `camera`: the camera position in the unit frame (double precision, on the CPU)
   * and the world-to-volume direction matrix. Call once per frame after {@link update}, before drawing a screen pass.
   */
  setView(camera: { matrixWorld: Matrix4; projectionMatrix?: Matrix4; matrixWorldInverse?: Matrix4 }): void {
    this.mesh.updateWorldMatrix(true, false);
    this.uViewOrigin.value.copy(this.cameraInVolumeFrame(this.mesh, camera));
    this.uViewDirections.value.copy(this.mesh.matrixWorld).invert();
    if (camera.projectionMatrix && camera.matrixWorldInverse) {
      this.viewFrustum.setFromProjectionMatrix(this.viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      this.inView = this.viewFrustum.intersectsObject(this.mesh);
      this.uScreenVisible.value = this.inView && !this.forceHidden ? 1 : 0;
      // A box proxy that is out of view is not drawn at all.
      this.mesh.visible = this.uScreenVisible.value > 0.5;
    }
  }

  /**
   * The march as a screen-space node: one ray per pixel from the camera along `dirWorld` (a unit vector node in world
   * space), stopping at `limitMetres` (a node: the distance along the ray to the scene surface). Returns premultiplied
   * RGBA. Needs {@link setView} each frame.
   */
  buildScreenMarchNode(dirWorld: any, limitMetres: any): any {
    const dir = this.uViewDirections.mul(vec4(dirWorld, 0)).xyz;
    return this.buildMarchNode(this.uViewOrigin, dir, limitMetres);
  }

  private buildBoxMarchNode(): any {
    // The ray runs from the camera (in the unit frame) through the interpolated box vertex.
    return this.buildMarchNode(this.uCameraLocal, positionLocal.sub(this.uCameraLocal), this.boxLimit);
  }

  /**
   * Plan 051 Phase 3b: aerial perspective for this volume's pixels. Given the premultiplied cloud colour, its alpha and the
   * distance (world units) to the middle of the ray's stretch inside the volume, returns the hazed colour. Set by a screen
   * pass ({@link CloudVolumeScreenPass.setHaze}); `null` = no haze. Takes effect on the next march rebuild.
   */
  haze: ((rgb: any, alpha: any, distanceUnits: any) => any) | null = null;

  /** The scene distance node the box proxy stops at (null = march the whole box). */
  private boxLimit: any = null;

  /**
   * Makes the box mesh stop each ray at `limitMetres` (a node: the distance from the camera to the scene surface at this
   * fragment), so the mesh can be drawn into a half-resolution target against the scene's depth. `null` restores the
   * plain box march.
   */
  setBoxLimit(limitMetres: any): void {
    this.boxLimit = limitMetres;
    this.marchMaterial.fragmentNode = this.buildBoxMarchNode();
    this.marchMaterial.needsUpdate = true;
  }

  /**
   * The march. Unit cube `[-0.5, 0.5]^3`; `dir` need not be unit length, so `t` is a fraction of `dir`, not a length, and
   * `dirLength` converts one unit of `t` to metres. `limitMetres` (or `null`) ends the ray early at a scene surface.
   */
  private buildMarchNode(origin: any, dir: any, limitMetres: any): any {
    const fetch = this.fetchEnabled;
    const steps = this.uMarchSteps;
    return Fn(() => {
      const dirVolume = dir.mul(this.uSize);
      const dirLength = dirVolume.length();
      const safeInv = (d: any) => float(1).div(select(abs(d).lessThan(1e-8), float(1e-8), d));
      const inv = vec3(safeInv(dir.x), safeInv(dir.y), safeInv(dir.z));
      const a = vec3(-0.5).sub(origin).mul(inv);
      const b = vec3(0.5).sub(origin).mul(inv);
      const tNear = max(max(min(a.x, b.x), min(a.y, b.y)), max(min(a.z, b.z), 0));
      const tBoxFar = min(min(max(a.x, b.x), max(a.y, b.y)), max(a.z, b.z));
      const tFar: any = limitMetres ? min(tBoxFar, limitMetres.div(dirLength)) : tBoxFar;
      const color = vec3(0).toVar();
      const transmittance = float(1).toVar();
      const hit: any = limitMetres ? tFar.greaterThan(tNear).and(this.uScreenVisible.greaterThan(0.5)) : tFar.greaterThan(tNear);
      If(hit, () => {
        // Step by length (about `uStepTexels` density texels), capped by `uMarchSteps`, so a ray that only clips a corner
        // takes a few steps instead of the full count.
        const segmentMetres = tFar.sub(tNear).mul(dirLength);
        const texelMetres = this.size.x / this.densityLayout.size;
        const count = max(float(1), min(float(steps), ceil(segmentMetres.div(this.uStepTexels.mul(texelMetres)))));
        const dt = tFar.sub(tNear).div(count);
        const dtMetres = dt.mul(dirLength);
        const jitter = fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))));
        // The volume frame is the world frame without the box's rotation, and `uSunLocal` is the sun in that frame.
        const cosine = dot(normalize(dirVolume), normalize(this.uSunLocal));
        // Two-lobe Henyey-Greenstein, mild forward and back scattering.
        const hg = (g: number) => {
          const g2 = g * g;
          return float(1 - g2).div(pow(float(1 + g2).sub(cosine.mul(2 * g)), 1.5).mul(4 * Math.PI));
        };
        const phase = max(hg(0.5).mul(0.6).add(hg(-0.3).mul(0.4)), this.uPhaseFloor);
        Loop(int(count), ({ i }: { i: any }) => {
          const t = tNear.add(float(i).add(jitter.mul(this.uJitter)).mul(dt));
          const q = origin.add(dir.mul(t)).add(0.5);
          const d = q.sub(0.5);
          const blobDensity = exp(dot(d, d).div(-2 * CLOUD_BLOB_SIGMA * CLOUD_BLOB_SIGMA));
          const density = fetch ? this.densityLayout.sample(this.densityTarget.texture, q) : blobDensity;
          If(density.greaterThan(0.002), () => {
            const sigma = density.mul(this.uExtinction);
            const stepT = exp(sigma.mul(dtMetres).negate());
            const od = fetch ? this.lightLayout.sample(this.lightTarget.texture, q) : density.mul(0.5);
            const sun = this.uSunColor.mul(exp(od.negate())).mul(phase.mul(4 * Math.PI * 0.25));
            const ambient = this.uAmbient.mul(q.y.mul(0.5).add(0.5));
            color.addAssign(transmittance.mul(float(1).sub(stepT)).mul(sun.add(ambient)));
            transmittance.mulAssign(stepT);
            If(transmittance.lessThan(0.01), () => {
              Break();
            });
          });
        });
        // Only rays that met cloud pay for the table lookup.
        if (this.haze) {
          const haze = this.haze;
          If(transmittance.lessThan(0.999), () => {
            color.assign(haze(color, float(1).sub(transmittance), tNear.add(tFar).mul(0.5).mul(dirLength)));
          });
        }
      });
      return vec4(color, float(1).sub(transmittance));
    })();
  }
}
