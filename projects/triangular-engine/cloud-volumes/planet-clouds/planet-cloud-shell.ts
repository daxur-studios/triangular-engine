/* eslint-disable @typescript-eslint/no-explicit-any */
import { Camera, FrontSide, Mesh, Object3D, SphereGeometry, Vector3 } from 'three';
import { NodeMaterial } from 'three/webgpu';
import { clamp, dot, float, int, max, mix, mx_fractal_noise_float, normalize, normalWorld, positionLocal, smoothstep, uniform, varying, vec3, vec4 } from 'three/tsl';

/**
 * The morph fade of the cloud shell: 0 on the globe, 1 once the planet has unrolled into its flat map. Same curve as the
 * atmosphere's sky, without its altitude factor.
 * @param morph The planet's morph, 0 (globe) to 1 (flat map).
 * @returns The fade, 0 to 1.
 */
export function cloudShellMorphFade(morph: number): number {
  const u = Math.min(1, Math.max(0, (morph - 0.2) / 0.6));
  return u * u * (3 - 2 * u);
}

/**
 * The camera fade of the cloud shell: 0 while the camera passes through the shell's layer, 1 once it is at least one
 * `altitude` away from the shell's surface. The shell never pops; it fades out only as the camera crosses it.
 * @param distanceFromCentre The camera's distance from the planet's centre, in world units.
 * @param shellRadius The shell's outer radius, in world units.
 * @param altitude The shell's thickness band, in world units.
 * @returns The fade, 0 to 1.
 */
export function cloudShellCameraFade(distanceFromCentre: number, shellRadius: number, altitude: number): number {
  const t = Math.min(1, Math.max(0, Math.abs(distanceFromCentre - shellRadius) / altitude));
  return t * t * (3 - 2 * t);
}

/** Options for {@link PlanetCloudShell}. Every field has a default except `radiusUnits`. */
export interface PlanetCloudShellOptions {
  /** The planet's radius in world units (one world unit is a metre in a `<planet>`). */
  readonly radiusUnits: number;
  /** Thickness of the cloud band in world units. Default: `radiusUnits * 0.0015`. */
  readonly altitude?: number;
  /** Share of the planet covered by cloud, 0 (clear) to 1 (overcast). Default 0.45. */
  readonly coverage?: number;
  /** Width of the soft edge between cloud and sky, in density units. Default 0.12. */
  readonly softness?: number;
  /** Noise frequency over the unit sphere: higher gives smaller cloud systems. Default 3. */
  readonly scale?: number;
  /** How fast the clouds drift, in noise units per second. Default 0.002. Set 0 to hold them still. */
  readonly drift?: number;
}

const DEFAULT_ALTITUDE_RATIO = 0.0015;
const DEFAULT_COVERAGE = 0.45;
const DEFAULT_SOFTNESS = 0.12;
const DEFAULT_SCALE = 3;
const DEFAULT_DRIFT = 0.002;
const SUN_TAP_OFFSET = 0.04;

/**
 * A planet-wide 2D cloud layer: a sphere just above the surface, shaded with procedural noise and the same analytic
 * sun colour that a `PlanetAtmosphere` uses at the surface. It is a far shell, not a volume: there is no flying through
 * it, and it does not bend into a flat map yet, so it fades out with the morph.
 *
 * Add {@link PlanetCloudShell.object} to the scene and call {@link PlanetCloudShell.update} once a frame. It needs a
 * `WebGPURenderer` (the shader is TSL). Use {@link PlanetCloudShell.dispose} when you are done with it.
 */
export class PlanetCloudShell {
  /** The mesh to add to the scene. It is hidden when the layer is faded out, disabled, or not drawn yet. */
  readonly object: Object3D;
  /**
   * The sun direction in the planet's frame (the scene frame when the planet is at the origin). Write it with `.set`
   * or `.copy`; it is normalised when the layer is updated. Default: `(0, 0, 1)`.
   */
  readonly sunDirection = new Vector3(0, 0, 1);

  private readonly geometry: SphereGeometry;
  private readonly material: NodeMaterial;
  private readonly uCoverage = uniform(DEFAULT_COVERAGE);
  private readonly uSoftness = uniform(DEFAULT_SOFTNESS);
  private readonly uScale = uniform(DEFAULT_SCALE);
  private readonly uDrift = uniform(DEFAULT_DRIFT);
  private readonly uTime = uniform(0);
  private readonly uSun = uniform(new Vector3(0, 0, 1));
  private readonly uOpacity = uniform(1);

  private radiusUnitsValue: number;
  private altitudeOverride: number | undefined;
  private coverageValue = DEFAULT_COVERAGE;
  private softnessValue = DEFAULT_SOFTNESS;
  private scaleValue = DEFAULT_SCALE;
  private driftValue = DEFAULT_DRIFT;
  private morphValue = 0;
  private enabledValue = true;

  private readonly centre = new Vector3();
  private readonly eye = new Vector3();

  /**
   * @param options The planet's radius and the layer's look. `radiusUnits` is required; the rest have defaults.
   */
  constructor(options: PlanetCloudShellOptions) {
    this.radiusUnitsValue = options.radiusUnits;
    this.altitudeOverride = options.altitude;
    this.coverage = options.coverage ?? DEFAULT_COVERAGE;
    this.softness = options.softness ?? DEFAULT_SOFTNESS;
    this.scale = options.scale ?? DEFAULT_SCALE;
    this.drift = options.drift ?? DEFAULT_DRIFT;

    this.geometry = new SphereGeometry(1, 128, 64);
    this.material = new NodeMaterial();
    this.material.transparent = true;
    this.material.depthWrite = false;
    this.material.side = FrontSide;
    this.material.fragmentNode = this.buildFragmentNode();

    const mesh = new Mesh(this.geometry, this.material);
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    this.object = mesh;
    this.applyScale();
  }

  /** Coverage: the share of the sky under cloud, 0 (clear) to 1 (overcast). Default 0.45. */
  get coverage(): number {
    return this.coverageValue;
  }
  set coverage(value: number) {
    this.coverageValue = value;
    this.uCoverage.value = value;
  }

  /** Softness: the width of the soft edge between cloud and sky, in density units. Default 0.12. */
  get softness(): number {
    return this.softnessValue;
  }
  set softness(value: number) {
    this.softnessValue = value;
    this.uSoftness.value = value;
  }

  /** Noise frequency over the unit sphere: higher gives smaller cloud systems. Default 3. */
  get scale(): number {
    return this.scaleValue;
  }
  set scale(value: number) {
    this.scaleValue = value;
    this.uScale.value = value;
  }

  /** Drift speed in noise units per second. Default 0.002. */
  get drift(): number {
    return this.driftValue;
  }
  set drift(value: number) {
    this.driftValue = value;
    this.uDrift.value = value;
  }

  /** Off hides the layer and skips its update. Default on. */
  get enabled(): boolean {
    return this.enabledValue;
  }
  set enabled(value: boolean) {
    this.enabledValue = value;
  }

  /**
   * The planet's morph, 0 (globe) to 1 (flat map). The layer fades out as it rises, and is hidden at 1. Set it each
   * frame, or read it from the planet's shared morph uniform before calling {@link PlanetCloudShell.update}.
   */
  get morph(): number {
    return this.morphValue;
  }
  set morph(value: number) {
    this.morphValue = value;
  }

  /**
   * Changes the planet's radius or the cloud band's thickness. The mesh is rescaled; the geometry is not rebuilt.
   * @param options Only the fields you pass change. `altitude` left out keeps the default (a fraction of the radius)
   *   or the last value you gave.
   */
  configure(options: { radiusUnits?: number; altitude?: number }): void {
    if (options.radiusUnits !== undefined) this.radiusUnitsValue = options.radiusUnits;
    if (options.altitude !== undefined) this.altitudeOverride = options.altitude;
    this.applyScale();
  }

  /**
   * Per-frame update: writes the uniforms from the morph, the camera position and the time, and shows or hides the mesh.
   * Allocates nothing.
   * @param camera The camera that draws the scene. Its world position sets the camera fade.
   * @param timeSeconds The time in seconds. Drives the drift; any steadily increasing clock works.
   */
  update(camera: Camera, timeSeconds: number): void {
    this.uTime.value = timeSeconds;
    this.uSun.value.copy(this.sunDirection);
    if (this.uSun.value.lengthSq() > 0) this.uSun.value.normalize();
    else this.uSun.value.set(0, 0, 1);

    const altitude = this.altitude;
    const shellRadius = this.radiusUnitsValue + altitude;
    this.object.getWorldPosition(this.centre);
    camera.getWorldPosition(this.eye);
    const cameraFade = cloudShellCameraFade(this.eye.distanceTo(this.centre), shellRadius, altitude);
    const morphOpacity = 1 - cloudShellMorphFade(this.morphValue);

    const opacity = this.enabledValue ? morphOpacity * cameraFade : 0;
    this.uOpacity.value = opacity;
    this.object.visible = opacity > 0;
  }

  /** Frees the geometry and the material. Remove {@link PlanetCloudShell.object} from its parent first, or do it after. */
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  private get altitude(): number {
    return this.altitudeOverride ?? this.radiusUnitsValue * DEFAULT_ALTITUDE_RATIO;
  }

  private applyScale(): void {
    this.object.scale.setScalar(this.radiusUnitsValue + this.altitude);
  }

  private buildFragmentNode() {
    // Unit direction from the planet's centre, interpolated from the sphere's vertices.
    const dir = varying(normalize(positionLocal));
    const drift = vec3(this.uTime.mul(this.uDrift), 0, 0);
    const fractal = (p: any) =>
      clamp(mx_fractal_noise_float(p, int(5), float(2.0), float(0.5)).mul(0.5).add(0.5), 0, 1);

    const density = fractal(normalize(dir).mul(this.uScale).add(drift));
    // One extra tap toward the sun gives fake thickness: a cloud between the sun and this point darkens it.
    const densitySun = fractal(normalize(dir).add(this.uSun.mul(SUN_TAP_OFFSET)).mul(this.uScale).add(drift));
    const threshold = float(1).sub(this.uCoverage);
    const alpha = smoothstep(threshold, threshold.add(this.uSoftness), density);
    const shade = clamp(float(1).sub(densitySun.sub(density).mul(2.0)), 0.35, 1);

    // Analytic sun on the shell point (the same shape as the surface lighting): orange near the terminator, dark at night.
    const n = normalize(normalWorld);
    const sunDot = dot(n, this.uSun);
    const day = smoothstep(-0.12, 0.25, sunDot);
    const sunColour = mix(vec3(1.0, 0.55, 0.3), vec3(1.0, 0.97, 0.92), smoothstep(0.0, 0.35, sunDot));
    const lit = sunColour.mul(day).mul(shade);
    const ambient = vec3(0.06, 0.08, 0.12).mul(float(0.25).add(day.mul(0.75)));
    const colour = max(lit.add(ambient), vec3(0, 0, 0));

    return vec4(colour, alpha.mul(this.uOpacity));
  }
}
