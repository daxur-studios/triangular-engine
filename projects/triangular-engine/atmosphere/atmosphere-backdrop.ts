import {
  ClampToEdgeWrapping,
  CustomBlending,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Matrix4,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  RGBAFormat,
  RenderTarget,
  Vector2,
  Vector3,
  Vector4,
  type Camera,
  type PerspectiveCamera,
} from 'three';
import { NodeMaterial, QuadMesh, type WebGPURenderer } from 'three/webgpu';
import {
  Fn,
  If,
  atan,
  cameraProjectionMatrix,
  cameraProjectionMatrixInverse,
  cameraViewMatrix,
  cameraWorldMatrix,
  cos,
  dot,
  float,
  floor,
  length,
  luminance,
  mat3,
  max,
  mix,
  mod,
  normalize,
  outputStruct,
  positionLocal,
  select,
  smoothstep,
  texture,
  uniform,
  uv,
  varying,
  vec3,
  vec4,
} from 'three/tsl';
import { AtmosphereGpuModel } from './atmosphere-gpu-model';
import { AtmosphereSkyViewLut } from './atmosphere-sky-view';
import {
  angularRadiusFade,
  apparentAngularRadius,
  DEFAULT_MIN_ANGULAR_RADIUS,
  screenRectToPixels,
  shellScreenBounds,
  type ScreenRect,
} from './atmosphere-backdrop-bounds';
import { starField } from './atmosphere-stars';

/**
 * Stars fade out as the exposed sky behind them brightens from this linear luminance to {@link STAR_FADE_LUMA_END}: gone
 * well before a day sky (about 0.2), still there in late twilight.
 */
export const STAR_FADE_LUMA_START = 0.003;
export const STAR_FADE_LUMA_END = 0.04;

/** Full-screen (sky owner) backdrops draw first; bounded ones after them and after the owner's sky bodies (-999). */
const FULL_RENDER_ORDER = -1000;
const BOUNDED_RENDER_ORDER = -998;

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AtmosphereBackdropOptions {
  /** Samples along each view ray. Default {@link AtmosphereGpuModel.defaultSteps}. */
  steps?: number;
  /** A sky-view table to read the sky from (Plan 049, Phase 2c). Call {@link AtmosphereBackdrop.update} each frame. */
  skyView?: AtmosphereSkyViewLut;
  /**
   * Resolution of the from-space march as a fraction of the drawing buffer (Plan 049, Phase 2c follow-up). Above the
   * atmosphere the planet's disc is marched per pixel; at 0.5 it is marched at a quarter of the pixels and
   * upsampled. Needs the camera passed to {@link AtmosphereBackdrop.update}. Default 0.5; 0 turns the pass off.
   */
  spaceScale?: number;
  /**
   * Smallest apparent size, as the angular radius of the atmosphere shell seen from the camera in radians, at which a
   * backdrop that does not own the sky ({@link AtmosphereBackdrop.ownsSky} false) is still drawn. Smaller than this it is
   * skipped entirely (no draw, no space march), and it fades in over the next doubling so it never pops. Default
   * {@link DEFAULT_MIN_ANGULAR_RADIUS} (0.25 degrees); 0 draws it at any size. Needs {@link AtmosphereBackdrop.setShell}.
   */
  minAngularRadius?: number;
  /** Initial value of {@link AtmosphereBackdrop.ownsSky}. Default true. */
  ownsSky?: boolean;
}

/**
 * How a backdrop covered the screen at its last {@link AtmosphereBackdrop.update}: `'full'` the whole screen, opaque
 * (the sky owner, or any backdrop with the camera inside its air); `'bounded'` only the atmosphere's screen bounds,
 * blended over what is already drawn; `'culled'` not drawn (off screen, or below the minimum apparent size).
 */
export type AtmosphereBackdropCoverage = 'full' | 'bounded' | 'culled';

/**
 * A sky plus an analytic ground sphere, drawn from the atmosphere model (Plan 049, Phase 2a).
 *
 * By default it is a full-screen opaque quad. With several atmospheres in one scene (Plan 078) only one may be: set
 * {@link ownsSky} false on the others and give each its shell with {@link setShell}. While the camera is outside such a
 * backdrop's air it then draws a quad around the atmosphere's screen bounds only, with premultiplied alpha (rays that miss
 * the planet stay transparent), and nothing at all when the atmosphere is off screen or smaller than
 * {@link minAngularRadius}. A camera inside the air always gets the full-screen opaque sky.
 *
 * It does not use scene depth or any planet geometry: every pixel casts a ray from a camera that sits
 * `altitude` metres above the ground at the origin (the scene camera supplies only orientation and field
 * of view), then
 *
 * - marches the atmosphere (`AtmosphereGpuModel.march`),
 * - if the ray reaches the ground, shades an exact-sphere ground (a distance-faded checker, so haze with
 *   distance is easy to read) lit by the sun's transmittance and the sky irradiance, seen through the
 *   air in between,
 * - otherwise draws the sun disc, attenuated by the whole atmosphere.
 *
 * Going analytic avoids the two things a mesh cannot do at planet scale: a polyhedron sags hundreds of
 * metres below a true sphere at Earth size, and float32 vertex transforms jitter at 6,000 km.
 */
export class AtmosphereBackdrop {
  readonly mesh: Mesh;
  readonly material: NodeMaterial;
  /** Camera altitude above the ground, metres. */
  readonly altitude = uniform(2);
  /** Linear scale applied before tone mapping. Radiance is relative to the sun irradiance, so this is large. */
  readonly exposure = uniform(8);
  /** 1 draws the ground sphere, 0 draws sky only (rays that would hit the ground just show the air). */
  readonly groundEnabled = uniform(1);
  /** 0..1, how strongly the ground checker shows. */
  readonly checkerStrength = uniform(1);
  /** 0..1, how much of the sun reaches the planet; scales the whole sky and the sun disc (an eclipse). */
  readonly sunVisibility = uniform(1);
  /** 0..1, fades the sky to black (space); the sky stays opaque so it draws first, behind the planet. The morph fades it out. */
  readonly opacity = uniform(1);
  /**
   * 0..1, how much of the sky below the horizon fades to the dark void (over about 10 degrees). A flat map sets it, since
   * what lies below its plane is not a sphere's ground; 0 leaves the sky as the table gives it.
   */
  readonly voidFade = uniform(0);
  /**
   * True (default) for the one atmosphere that owns the whole sky: it draws full-screen and opaque, with the stars and the
   * sun disc, whatever the camera's distance. Set it false on every other atmosphere in the scene (the consumer decides
   * which one is the owner, for example the gravity primary or the one the camera is nearest to). A non-owner draws only
   * its own bounded air from space, without stars or a sun disc of its own (it still dims the owner's by its transmittance),
   * and falls back to the full-screen opaque quad when the camera is inside its air, since the camera's sky is then its own.
   */
  ownsSky = true;
  /**
   * Angular radius (radians) of the atmosphere shell below which a non-owner is not drawn. See
   * {@link AtmosphereBackdropOptions.minAngularRadius}. Writable.
   */
  minAngularRadius: number;
  /** Multiplies the sun disc brightness; 0 hides it. */
  readonly sunDiscStrength = uniform(1);

  /** Star brightness (display-referred, added after exposure); 0 draws no stars and skips their cost. */
  readonly stars = uniform(0);
  /** Rotation from world directions to the star field's frame. Identity fixes the stars to the world axes. */
  readonly starFrame = uniform(new Matrix3());
  /** Radians per pixel at the centre of the view; {@link update} sets it from the camera. Sizes the stars. */
  readonly pixelAngle = uniform(0.001);
  /**
   * 0..1, how much air sky objects ({@link skyObject}) are seen through. The owner sets 0 while the sky is off, so
   * bodies drawn without it are not tinted by a table that is no longer updated.
   */
  readonly objectAir = uniform(1);

  /** 1 reads the sky from the sky-view table (when one was given and the camera is inside the air), 0 marches every pixel. */
  readonly skyViewEnabled = uniform(1);
  readonly skyView?: AtmosphereSkyViewLut;

  /** 1 marches the view from space at reduced resolution (see {@link AtmosphereBackdropOptions.spaceScale}), 0 marches every pixel. */
  readonly spaceLowResEnabled = uniform(1);
  /** Number of times the reduced-resolution space pass was rendered. */
  spaceRenderCount = 0;
  /** Size in pixels of the reduced-resolution pass (two colour attachments: radiance and transmittance), 0 x 0 until rendered. */
  readonly spaceSize = new Vector2();

  /**
   * Rotation from world directions to the backdrop's local frame (y up). Identity keeps the lab's convention, where
   * the world is the local frame. A planet seen from outside sets it so local y is the camera's radial direction
   * (see `PlanetAtmosphereBinding`).
   */
  readonly frame = uniform(new Matrix3());

  /** 1 while drawn bounded: alpha output, no stars or sun disc of its own. */
  private readonly alphaMode = uniform(0);
  /** 0..1 fade-in near {@link minAngularRadius}; 1 when not bounded. */
  private readonly boundedFade = uniform(1);
  /** Clip-space rectangle the quad covers: minX, minY, maxX, maxY. The whole screen unless bounded. */
  private readonly boundsRect = uniform(new Vector4(-1, -1, 1, 1));
  private shellRadius = 0;
  private readonly shellCentre = new Vector3();
  private readonly shellView = new Vector3();
  private coverageState: AtmosphereBackdropCoverage = 'full';
  private apparentRadius = Number.NaN;
  private readonly boundsNdc: ScreenRect = { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  private culledHidden = false;
  private readonly spaceScale: number;
  private readonly stepsOption?: number;
  private readonly spaceReady = uniform(0);
  private readonly spaceInvProjection = uniform(new Matrix4());
  private readonly spaceCameraWorld = uniform(new Matrix4());
  private spaceTarget?: RenderTarget;
  private spaceQuad?: QuadMesh;
  private spaceMaterial?: NodeMaterial;
  private readonly drawingSize = new Vector2();
  /** What the last space pass was rendered with; an identical frame skips the render. */
  private readonly spaceSignature: number[] = [];
  private spaceProfileVersion = -1;

  constructor(
    readonly model: AtmosphereGpuModel,
    options: AtmosphereBackdropOptions = {},
  ) {
    const skyView = options.skyView;
    this.skyView = skyView;
    this.spaceScale = options.spaceScale ?? 0.5;
    this.minAngularRadius = options.minAngularRadius ?? DEFAULT_MIN_ANGULAR_RADIUS;
    this.ownsSky = options.ownsSky ?? true;
    this.stepsOption = options.steps;
    const material = new NodeMaterial();
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = false;
    // Premultiplied alpha, still drawn in the opaque pass (before the scene, by render order): a full-screen draw outputs
    // alpha 1 and so replaces what is behind it; a bounded draw outputs 1 - transmittance and blends over it.
    material.blending = CustomBlending;
    material.blendSrc = OneFactor;
    material.blendDst = OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = OneFactor;
    material.blendDstAlpha = OneMinusSrcAlphaFactor;

    // Clip-space quad over `boundsRect` (the whole screen unless bounded); each corner's view-space ray is interpolated
    // (linear in screen space, so exact).
    const corner = positionLocal.xy.mul(0.5).add(0.5);
    const ndc: any = mix(this.boundsRect.xy, this.boundsRect.zw, corner);
    material.vertexNode = vec4(ndc, 0, 1);
    const farPoint = cameraProjectionMatrixInverse.mul(vec4(ndc, 1, 1));
    const rayWorld = cameraWorldMatrix.mul(vec4(farPoint.xyz.div(farPoint.w), 0)).xyz;
    const rayVarying = varying(rayWorld, 'vAtmosphereRay');
    const screenVarying = varying(ndc.mul(0.5).add(0.5), 'vAtmosphereUv');

    material.fragmentNode = Fn(() => {
      const dir = normalize(this.frame.mul(rayVarying));
      const sunDir = model.sunDirection;
      const maxDistance = float(1e30);
      const trace = model.traceRay({ altitude: this.altitude, dir, maxDistance });
      const { radiance, transmittance } = this.skyAlong(dir, screenVarying);
      const march = { transmittance, groundDistance: trace.groundDistance };
      const colour = radiance.toVar();

      const hitGround = trace.hitsGround.and(this.groundEnabled.greaterThan(0.5));
      If(hitGround, () => {
        const R = model.uRadius;
        const point = vec3(0, this.altitude, 0).add(dir.mul(march.groundDistance));
        const up = normalize(vec3(point.x, point.y.add(R), point.z));
        const albedo = this.groundAlbedo(up, march.groundDistance);
        const light = model.groundIrradiance(up);
        const ground = albedo.mul(light).mul(model.uSunIrradiance).div(Math.PI);
        colour.addAssign(march.transmittance.mul(ground));
      }).Else(() => {
        // Sun disc: radiance = irradiance / solid angle, seen through the whole atmosphere.
        const angle = model.uSunAngularRadius;
        const cosEdge = cos(angle);
        const cosInner = cos(angle.mul(0.97));
        const mask = smoothstep(cosEdge, cosInner, dot(dir, sunDir));
        const radiance = model.uSunIrradiance.div(angle.mul(angle).mul(Math.PI));
        colour.addAssign(
          march.transmittance.mul(radiance).mul(mask).mul(this.sunDiscStrength).mul(float(1).sub(this.alphaMode)),
        );
      });

      const exposed: any = max(colour.mul(this.exposure).mul(this.sunVisibility), 0);
      const voidFactor = this.voidFactor(dir);
      const sky = exposed.mul(this.opacity).mul(voidFactor).mul(this.boundedFade).toVar();
      // Stars (display-referred, after exposure) through the air in front of them, fading out as the sky behind them
      // brightens. Not on rays that end on the ground: there the planet is in front of them.
      If(this.stars.greaterThan(0).and(trace.hitsGround.not()).and(this.alphaMode.lessThan(0.5)), () => {
        const starDir = normalize(this.starFrame.mul(rayVarying));
        const through = mix(vec3(1), transmittance, this.opacity);
        const fade = float(1).sub(smoothstep(STAR_FADE_LUMA_START, STAR_FADE_LUMA_END, luminance(sky)));
        sky.addAssign(starField(starDir, this.pixelAngle).mul(through).mul(fade).mul(this.stars));
      });
      // Bounded: the air dims what is behind it (mean transmittance) and adds its in-scatter, premultiplied. A ray that ends on
      // the ground is opaque. Full-screen: alpha 1.
      const dimming = float(1)
        .sub(transmittance.x.add(transmittance.y).add(transmittance.z).div(3))
        .mul(this.opacity)
        .mul(this.boundedFade);
      const alpha = select(this.alphaMode.greaterThan(0.5), select(hitGround, float(1), dimming), float(1));
      return vec4(sky, alpha);
    })();

    this.material = material;
    const mesh = new Mesh(new PlaneGeometry(2, 2), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = FULL_RENDER_ORDER;
    mesh.name = 'AtmosphereBackdrop';
    this.mesh = mesh;
  }

  /**
   * Ground albedo at a unit direction `up` from the planet centre, and distance `dist` from the camera.
   * Azimuthal-equidistant coordinates around the spawn point keep checker cells roughly square out to
   * the horizon; each of three scales fades in and out with distance so none of them aliases.
   */
  private groundAlbedo(up: any, dist: any): any {
    const R = this.model.uRadius;
    const sinTheta = length(up.xz);
    const colatitude = atan(sinTheta, up.y);
    const flat = up.xz.mul(colatitude.div(max(sinTheta, 1e-9))).mul(R);
    const checker = (cell: any, near: any, far: any): any => {
      const q = flat.div(cell);
      const parity = mod(floor(q.x).add(floor(q.y)), 2);
      const fade = float(1).sub(smoothstep(cell.mul(near), cell.mul(far), dist));
      return parity.sub(0.5).mul(fade);
    };
    // Two cell sizes in absolute metres (near props, creatures), three relative to the planet.
    const c0 = checker(float(1), 40, 200);
    const c1 = checker(float(25), 40, 200);
    const c2 = checker(R.mul(2e-4), 40, 200);
    const c3 = checker(R.mul(1e-2), 40, 200);
    const c4 = checker(R.mul(1e-1), 40, 200);
    const pattern = c0
      .mul(0.2)
      .add(c1.mul(0.25))
      .add(c2.mul(0.25))
      .add(c3.mul(0.25))
      .add(c4.mul(0.2))
      .mul(this.checkerStrength);
    return this.model.uGroundAlbedo.mul(float(1).add(pattern));
  }

  setAltitude(metres: number): void {
    this.altitude.value = Math.max(0, metres);
  }

  /**
   * In-scattered radiance and transmittance along a unit direction `dir` in the backdrop's local frame, as the sky
   * shows them: one fetch from the sky-view table inside the air, the reduced-resolution space pass at `screenUv`
   * (0..1, y up) above it, otherwise a march. Call inside a TSL `Fn`.
   */
  private skyAlong(dir: any, screenUv: any): { radiance: any; transmittance: any } {
    const model = this.model;
    const skyView = this.skyView;
    const radiance = vec3(0).toVar();
    const transmittance = vec3(1).toVar();
    const marchInto = () => {
      const m = model.march({
        altitude: this.altitude,
        dir,
        sunDir: model.sunDirection,
        maxDistance: float(1e30),
        steps: this.stepsOption,
      });
      radiance.assign(m.radiance);
      transmittance.assign(m.transmittance);
    };
    if (skyView) {
      const useTable: any = (this.skyViewEnabled.greaterThan(0.5) as any).and(this.altitude.lessThan(model.uTopAltitude));
      const branch: any = If(useTable, () => {
        const s = skyView.lookup(dir);
        radiance.assign(s.radiance);
        transmittance.assign(s.transmittance);
      });
      if (this.spaceScale > 0) {
        branch.ElseIf(this.spaceReady.greaterThan(0.5), () => this.readSpace(screenUv, radiance, transmittance));
      }
      branch.Else(marchInto);
    } else if (this.spaceScale > 0) {
      If(this.spaceReady.greaterThan(0.5), () => this.readSpace(screenUv, radiance, transmittance)).Else(marchInto);
    } else {
      marchInto();
    }
    return { radiance, transmittance };
  }

  /** 1 above the horizon, fading to `1 - voidFade` over about 10 degrees below it. */
  private voidFactor(dir: any): any {
    const below = smoothstep(float(0), float(0.17), dir.y.negate());
    return float(1).sub(this.voidFade.mul(below));
  }

  /**
   * The air between the camera and a sky object (Plan 049 `atmosphereSky(dir)`) in world direction `worldDir`:
   * `inscatter` is display radiance (exposure, eclipse and the sky's fade already applied) to add on top of the object,
   * `transmittance` what reaches the camera of the object's own light. On a ray that ends on the backdrop's ground
   * (when it draws one) the transmittance is 0. Call inside a TSL `Fn`, from any material drawn after the backdrop.
   */
  atmosphereSky(worldDir: any): { inscatter: any; transmittance: any } {
    const model = this.model;
    const dir = (normalize(this.frame.mul(worldDir) as any) as any).toVar();
    const clip: any = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(worldDir, 0)));
    const screenUv = clip.xy.div(clip.w).mul(0.5).add(0.5);
    const sky = this.skyAlong(dir, screenUv);
    const trace = model.traceRay({ altitude: this.altitude, dir, maxDistance: float(1e30) });
    const blocked = select(trace.hitsGround.and(this.groundEnabled.greaterThan(0.5)), float(0), float(1));
    const air = this.opacity.mul(this.objectAir);
    const transmittance = mix(vec3(1), sky.transmittance.mul(blocked), air);
    const inscatter = max(sky.radiance, vec3(0))
      .mul(this.exposure)
      .mul(this.sunVisibility)
      .mul(this.voidFactor(dir))
      .mul(air);
    return { inscatter, transmittance };
  }

  /**
   * Display colour of a sky object with radiance `radiance` (relative to the sun's irradiance, like the sky) in world
   * direction `worldDir`: `radiance x exposure x transmittance + inscatter`. Opaque objects (moon, planets, a sun disc)
   * use it as their colour, so they replace the sky behind them exactly.
   */
  skyObject(radiance: any, worldDir: any): any {
    const { inscatter, transmittance } = this.atmosphereSky(worldDir);
    return radiance.mul(this.exposure).mul(transmittance).add(inscatter);
  }

  /** Bilinear fetch from the reduced-resolution space pass at screen uv `uvNode`. */
  private readSpace(uvNode: any, radiance: any, transmittance: any): void {
    const target = this.ensureSpacePass();
    radiance.assign(texture(target.textures[0], uvNode, 0).rgb);
    transmittance.assign(texture(target.textures[1], uvNode, 0).rgb);
  }

  private ensureSpacePass(): RenderTarget {
    if (this.spaceTarget) return this.spaceTarget;
    // Two colour attachments (radiance, transmittance) written by one march per texel.
    const target = new RenderTarget(1, 1, {
      count: 2,
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      depthBuffer: false,
      generateMipmaps: false,
    } as any);
    const model = this.model;
    const material = new NodeMaterial();
    const marched: any = Fn(() => {
      const ndc: any = uv().mul(2).sub(1);
      const far: any = this.spaceInvProjection.mul(vec4(ndc, 1, 1));
      const dir = normalize(this.frame.mul(this.spaceCameraWorld.mul(vec4(far.xyz.div(far.w), 0)).xyz));
      const m = model.march({
        altitude: this.altitude,
        dir,
        sunDir: model.sunDirection,
        maxDistance: float(1e30),
        steps: this.stepsOption,
      });
      return (mat3 as any)(m.radiance, m.transmittance, vec3(0));
    })().toVar();
    material.fragmentNode = (outputStruct as any)(vec4(marched[0], 1), vec4(marched[1], 1));
    this.spaceTarget = target;
    this.spaceMaterial = material;
    this.spaceQuad = new QuadMesh(material);
    return target;
  }

  /**
   * Per-frame work that must happen outside a render pass: refreshes the sky-view table if the altitude or
   * the sun moved past its tolerance, and, when the camera is above the atmosphere, renders the view of the
   * planet at reduced resolution. Call from the frame tick, after the camera has moved and before the scene
   * renders. Pass the scene camera to enable the reduced-resolution space pass. Returns true when the
   * sky-view table was re-rendered.
   */
  update(renderer: WebGPURenderer, camera?: Camera): boolean {
    if (camera && (camera as PerspectiveCamera).isPerspectiveCamera && renderer.initialized) {
      renderer.getDrawingBufferSize(this.drawingSize);
      const { fov, zoom } = camera as PerspectiveCamera;
      // The angle one pixel spans at the centre of the view: the view's height at unit distance over the pixel count.
      const height = (2 * Math.tan((fov * Math.PI) / 360)) / zoom;
      this.pixelAngle.value = height / Math.max(1, this.drawingSize.y);
    }
    this.updateCoverage(camera);
    if (this.coverageState === 'culled') {
      // Nothing is drawn, so nothing reads the space pass; forget it so a later frame renders it afresh.
      this.spaceReady.value = 0;
      return false;
    }
    this.updateSpacePass(renderer, camera);
    // A bounded backdrop is outside its air and never reads the table.
    if (!this.skyView || this.skyViewEnabled.value < 0.5 || this.coverageState === 'bounded') return false;
    return this.skyView.update(renderer, this.altitude.value);
  }

  /**
   * Gives the backdrop the atmosphere's outer shell: a sphere around `centre` (world space) of `radius` world units
   * (the planet's radius plus the air's height, scaled like the planet's mesh). It is what {@link update} projects to find
   * the screen bounds and the {@link apparentAngularRadius}. Without a shell the backdrop always covers the full screen.
   */
  setShell(centre: Vector3, radius: number): void {
    this.shellCentre.copy(centre);
    this.shellRadius = Math.max(0, radius);
  }

  /** How the backdrop covered the screen at the last {@link update}. */
  get coverage(): AtmosphereBackdropCoverage {
    return this.coverageState;
  }

  /**
   * Angular radius, in radians, of the atmosphere shell as the camera saw it at the last {@link update}: the half-angle
   * of the cone from the camera that just contains the shell, a quarter turn when the camera is inside it. NaN until a
   * shell ({@link setShell}) and a perspective camera have been given. Compare it with {@link minAngularRadius}.
   */
  get apparentAngularRadius(): number {
    return this.apparentRadius;
  }

  /** The clip-space rectangle (-1..1, y up) the quad covered at the last {@link update}; the whole screen unless bounded. */
  get screenBounds(): Readonly<ScreenRect> {
    return this.boundsNdc;
  }

  /**
   * Decides how this frame is drawn. Full screen and opaque for the sky owner and whenever the camera is inside the air (or
   * no shell is known); otherwise bounded to the shell's screen rectangle with alpha, or culled if the shell is off screen or
   * below {@link minAngularRadius}. Hides the mesh when culled and shows it again when it was hidden by culling.
   */
  private updateCoverage(camera?: Camera): void {
    const rect = this.boundsRect.value;
    const bounds = this.boundsNdc;
    let next: AtmosphereBackdropCoverage = 'full';
    let fade = 1;
    bounds.minX = bounds.minY = -1;
    bounds.maxX = bounds.maxY = 1;
    this.apparentRadius = Number.NaN;

    if (camera && (camera as PerspectiveCamera).isPerspectiveCamera && this.shellRadius > 0) {
      camera.updateMatrixWorld();
      const view = this.shellView.copy(this.shellCentre).applyMatrix4(camera.matrixWorldInverse);
      this.apparentRadius = apparentAngularRadius(view.length(), this.shellRadius);
      const insideAir = this.altitude.value < this.model.uTopAltitude.value;
      if (!this.ownsSky && !insideAir) {
        const e = camera.projectionMatrix.elements;
        const found =
          this.apparentRadius < this.minAngularRadius
            ? null
            : shellScreenBounds([view.x, view.y, view.z], this.shellRadius, e[0], e[5]);
        if (found) {
          next = 'bounded';
          fade = angularRadiusFade(this.apparentRadius, this.minAngularRadius);
          Object.assign(bounds, found);
        } else {
          next = 'culled';
        }
      }
    }

    rect.set(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
    this.alphaMode.value = next === 'bounded' ? 1 : 0;
    this.boundedFade.value = fade;
    this.mesh.renderOrder = next === 'bounded' ? BOUNDED_RENDER_ORDER : FULL_RENDER_ORDER;
    this.coverageState = next;
    if (next === 'culled') {
      this.mesh.visible = false;
      this.culledHidden = true;
    } else if (this.culledHidden) {
      this.mesh.visible = true;
      this.culledHidden = false;
    }
  }

  private updateSpacePass(renderer: WebGPURenderer, camera?: Camera): void {
    const outsideAir = this.altitude.value >= this.model.uTopAltitude.value;
    // Inside the air the sky comes from the table, or from the full-resolution march when the table is off.
    const wanted = this.spaceScale > 0 && this.spaceLowResEnabled.value > 0.5 && !!camera && renderer.initialized && outsideAir;
    if (!wanted || !camera) {
      this.spaceReady.value = 0;
      return;
    }
    const target = this.ensureSpacePass();
    renderer.getDrawingBufferSize(this.drawingSize);
    const w = Math.max(8, Math.round(this.drawingSize.x * this.spaceScale));
    const h = Math.max(8, Math.round(this.drawingSize.y * this.spaceScale));
    if (target.width !== w || target.height !== h) {
      target.setSize(w, h);
      this.spaceSize.set(w, h);
    }
    camera.updateMatrixWorld();
    // Idle in orbit: the same altitude, size, profile, sun, frame and camera give the same picture.
    const sun = this.model.sunDirection.value;
    const bounded = this.coverageState === 'bounded';
    const next = [
      this.altitude.value, w, h, sun.x, sun.y, sun.z, bounded ? 1 : 0, this.boundedFade.value as number,
      this.boundsNdc.minX, this.boundsNdc.minY, this.boundsNdc.maxX, this.boundsNdc.maxY,
      ...camera.projectionMatrixInverse.elements, ...camera.matrixWorld.elements, ...this.frame.value.elements,
    ];
    const unchanged =
      this.spaceReady.value > 0.5 &&
      this.model.profileVersion === this.spaceProfileVersion &&
      next.length === this.spaceSignature.length &&
      next.every((v, i) => v === this.spaceSignature[i]);
    if (unchanged) return;
    this.spaceSignature.length = 0;
    this.spaceSignature.push(...next);
    this.spaceProfileVersion = this.model.profileVersion;
    this.spaceInvProjection.value.copy(camera.projectionMatrixInverse);
    this.spaceCameraWorld.value.copy(camera.matrixWorld);

    // A bounded backdrop only reads the table inside its rectangle (plus a bilinear texel), so march only there.
    if (bounded) {
      const [x, y, width, height] = screenRectToPixels(this.boundsNdc, w, h, 2);
      target.scissor.set(x, y, width, height);
      target.scissorTest = true;
    } else {
      target.scissorTest = false;
    }
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    this.spaceQuad?.render(renderer);
    renderer.setRenderTarget(previous);
    this.spaceRenderCount++;
    this.spaceReady.value = 1;
  }

  dispose(): void {
    this.spaceTarget?.dispose();
    this.spaceMaterial?.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** Unit vector for a sun placed by elevation and azimuth (degrees) in the backdrop's local frame (y up). */
export function sunDirectionFromAngles(elevationDeg: number, azimuthDeg: number, out = new Vector3()): Vector3 {
  const e = (elevationDeg * Math.PI) / 180;
  const a = (azimuthDeg * Math.PI) / 180;
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
}
