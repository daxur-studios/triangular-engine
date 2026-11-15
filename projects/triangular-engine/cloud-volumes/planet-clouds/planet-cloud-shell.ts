/* eslint-disable @typescript-eslint/no-explicit-any */
import { Camera, FrontSide, Mesh, Object3D, SphereGeometry, Vector3 } from 'three';
import { NodeMaterial } from 'three/webgpu';
import { clamp, dot, float, int, max, mix, mx_fractal_noise_float, normalize, positionGeometry, smoothstep, uniform, varying, vec3, vec4 } from 'three/tsl';
import type { IPlanetMorphUniforms } from 'triangular-engine/planet-material';
import { cloudShellBendPosition } from './planet-cloud-bend';

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
  /**
   * The enclosing planet's shared morph uniforms (`<planet>`'s `morphUniforms`). With them the vertex stage bends the layer
   * into the same flat map as the terrain, so it stays a thin band above the bent ground at every morph, and the morph fade
   * is off (see {@link PlanetCloudShell.morph}). Without them the layer does not bend: it fades out as the morph rises.
   */
  readonly morphUniforms?: IPlanetMorphUniforms;
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
 * it.
 *
 * With `morphUniforms` (a `<planet>`'s) the vertices bend into the flat map with the planet's morph, as the terrain does,
 * and the layer stays a thin band above the ground at every morph. Without them it does not bend and fades out as the
 * morph rises. The shading uses the unbent globe direction as its normal, not the bent ground's: a known simplification
 * (the terrain's shading follows the bent ground; the clouds are lit as on the globe at every morph).
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
  /** The shell's radius in world units (radius plus altitude), for the bend. Written by `applyScale`. */
  private readonly uShellRadius = uniform(0);
  private readonly bendUniforms: IPlanetMorphUniforms | undefined;

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
    this.bendUniforms = options.morphUniforms;

    this.geometry = new SphereGeometry(1, 128, 64);
    this.material = new NodeMaterial();
    this.material.transparent = true;
    this.material.depthWrite = false;
    this.material.side = FrontSide;
    this.material.fragmentNode = this.buildFragmentNode();
    if (this.bendUniforms) {
      this.material.positionNode = cloudShellBendPosition(this.bendUniforms, normalize(positionGeometry), this.uShellRadius);
    }

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
   * The planet's morph, 0 (globe) to 1 (flat map). Without `morphUniforms` the layer fades out as it rises, and is hidden
   * at 1. With `morphUniforms` the layer bends with the morph instead: it is never faded or hidden by it. Set it each
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
    const morphOpacity = this.bendUniforms ? 1 : 1 - cloudShellMorphFade(this.morphValue);

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
    const shellRadius = this.radiusUnitsValue + this.altitude;
    this.uShellRadius.value = shellRadius;
    // A bent shell is placed in world units by its vertex stage, so its mesh is not scaled.
    this.object.scale.setScalar(this.bendUniforms ? 1 : shellRadius);
  }

  /**
   * The cloud cover the shell draws at a direction, as a TSL node, so something other than the shell can read the same
   * clouds (a ground shadow, for one). It is the exact function the fragment stage uses for its alpha: the same noise,
   * scale, drift, coverage and softness, read live from the shell's uniforms.
   * @param direction A `vec3` node: the direction from the planet's centre (it is normalised for you), in the planet's
   *   frame, unbent.
   * @returns A `float` node, 0 (clear sky) to 1 (full cloud).
   */
  coverageAt(direction: any): any {
    const density = this.densityAt(normalize(direction));
    const threshold = float(1).sub(this.uCoverage);
    return smoothstep(threshold, threshold.add(this.uSoftness), density);
  }

  /** The noise density at a point on or near the unit sphere (not normalised here: the sun tap is a small offset). */
  private densityAt(point: any): any {
    const drift = vec3(this.uTime.mul(this.uDrift), 0, 0);
    const p = point.mul(this.uScale).add(drift);
    return clamp(mx_fractal_noise_float(p, int(5), float(2.0), float(0.5)).mul(0.5).add(0.5), 0, 1);
  }

  private buildFragmentNode() {
    // Unit direction from the planet's centre, interpolated from the sphere's vertices. It is the unbent geometry
    // direction, so the cloud pattern stays on the globe's geography while the vertices bend.
    const dir = varying(normalize(positionGeometry));
    const density = this.densityAt(normalize(dir));
    // One extra tap toward the sun gives fake thickness: a cloud between the sun and this point darkens it.
    const densitySun = this.densityAt(normalize(dir).add(this.uSun.mul(SUN_TAP_OFFSET)));
    const alpha = this.coverageAt(dir);
    const shade = clamp(float(1).sub(densitySun.sub(density).mul(2.0)), 0.35, 1);

    // Analytic sun on the shell point (the same shape as the surface lighting): orange near the terminator, dark at night.
    // The normal is the unbent direction (see `dir`), so the lighting does not follow the bend.
    const n = normalize(dir);
    const sunDot = dot(n, this.uSun);
    const day = smoothstep(-0.12, 0.25, sunDot);
    const sunColour = mix(vec3(1.0, 0.55, 0.3), vec3(1.0, 0.97, 0.92), smoothstep(0.0, 0.35, sunDot));
    const lit = sunColour.mul(day).mul(shade);
    const ambient = vec3(0.06, 0.08, 0.12).mul(float(0.25).add(day.mul(0.75)));
    const colour = max(lit.add(ambient), vec3(0, 0, 0));

    return vec4(colour, alpha.mul(this.uOpacity));
  }
}
