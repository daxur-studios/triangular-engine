import {
  BackSide,
  BoxGeometry,
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  Mesh,
  NormalBlending,
  Quaternion,
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

/* eslint-disable @typescript-eslint/no-explicit-any */

export type CloudVolumeShape = 'noise' | 'box' | 'blob';

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

const SHAPE_ID: Record<CloudVolumeShape, number> = { noise: 0, box: 1, blob: 2 };

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
  /** Noise controls; changing them needs {@link invalidateDensity}. */
  readonly uNoiseFrequency = uniform(3);
  readonly uNoiseThreshold = uniform(0.38);
  readonly uNoiseGain = uniform(3);
  readonly uNoiseSeed = uniform(0);
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

  private shape: CloudVolumeShape;
  private densityDirty = true;
  private lightDirty = true;
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

  /** Marks the density, and so the light, for rebake on the next {@link update}. */
  invalidateDensity(): void {
    this.densityDirty = true;
    this.lightDirty = true;
  }

  /** Direction toward the sun in world space. The light rebakes once it has turned past the tolerance. */
  setSunDirection(x: number, y: number, z: number): void {
    this.sunWorld.set(x, y, z).normalize();
  }

  /** Rebakes what is stale and refreshes the march's per-frame uniforms. Call outside any render pass. */
  update(renderer: WebGPURenderer): void {
    this.mesh.updateWorldMatrix(true, false);
    this.mesh.matrixWorld.decompose(this.scratchPosition, this.quaternion, this.scratchScale);
    this.sunLocal.copy(this.sunWorld).applyQuaternion(this.quaternion.invert());
    this.uSunLocal.value.copy(this.sunLocal);

    if (this.densityDirty) {
      this.bake(renderer, this.densityQuad, this.densityTarget);
      this.densityBakes++;
      this.densityDirty = false;
    }
    if (this.lightDirty || this.alwaysRebakeLight || this.sunLocal.dot(this.bakedSunLocal) < this.cosTolerance) {
      this.bake(renderer, this.lightQuad, this.lightTarget);
      this.bakedSunLocal.copy(this.sunLocal);
      this.lightBakes++;
      this.lightDirty = false;
    }
  }

  dispose(): void {
    this.densityTarget.dispose();
    this.lightTarget.dispose();
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

  private bake(renderer: WebGPURenderer, quad: QuadMesh, target: RenderTarget): void {
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    quad.render(renderer);
    renderer.setRenderTarget(previous);
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
      return select(this.uShape.lessThan(0.5), noiseDensity, select(this.uShape.lessThan(1.5), float(1), blob));
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
  setView(camera: { matrixWorld: Matrix4 }): void {
    this.mesh.updateWorldMatrix(true, false);
    this.uViewOrigin.value.copy(this.cameraInVolumeFrame(this.mesh, camera));
    this.uViewDirections.value.copy(this.mesh.matrixWorld).invert();
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
    return this.buildMarchNode(this.uCameraLocal, positionLocal.sub(this.uCameraLocal), null);
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
      If(tFar.greaterThan(tNear), () => {
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
        const phase = hg(0.5).mul(0.6).add(hg(-0.3).mul(0.4));
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
      });
      return vec4(color, float(1).sub(transmittance));
    })();
  }
}
