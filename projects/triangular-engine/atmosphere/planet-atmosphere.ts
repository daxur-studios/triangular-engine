import { Group, Matrix4, Quaternion, Vector3, type Camera, type IUniform, type Object3D } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { Fn, If, cameraPosition, float, length, mix, normalize, positionWorld, smoothstep, uniform, vec3 } from 'three/tsl';
import type { AtmosphereAerialPerspectiveOptions } from './atmosphere-aerial-perspective';
import { AtmosphereBackdrop, type AtmosphereBackdropOptions } from './atmosphere-backdrop';
import { AtmosphereGpuModel } from './atmosphere-gpu-model';
import type { AtmosphereLutOptions } from './atmosphere-luts';
import {
  PlanetAtmosphereBinding,
  type IAtmosphereLightingInput,
  type IAtmospherePlanetContext,
} from './atmosphere-planet-stages';
import { createAtmospherePreset, type AtmospherePresetId } from './atmosphere-presets';
import type { PhysicalAtmosphereProfile } from './atmosphere-profile';
import { scaleAtmosphereProfile } from './atmosphere-scaling';
import { AtmosphereSkyBody, type AtmosphereSkyBodyOptions } from './atmosphere-sky-body';
import { AtmosphereSkyViewLut, type AtmosphereSkyViewOptions } from './atmosphere-sky-view';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * How much of the sky shell is gone, 0 (all there) to 1 (hidden), for a planet unrolled to `morph` and a camera `skyAltitude` metres
 * up, with the air `topAltitude` thick. The shell is a sphere's: it does not bend with the planet, so seen from above the air it
 * would hang as a dark ghost globe behind the bending map. It dissolves over the first 6% of the morph there (from one to four
 * air heights up). Close to the ground it stays whatever the morph, because the hazed horizon needs a sky behind it.
 */
export function skyShellFade(morph: number, skyAltitude: number, topAltitude: number): number {
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
  const high = clamp01((skyAltitude / topAltitude - 1) / 3);
  // Dissolve the globe-sized shell while the terrain still looks like a globe (by morph 0.06 it has barely moved); a slower
  // fade left a round rim hanging around the peeling terrain. The bent sky (BentAtmosphere) is the clean fix, not yet wired.
  const unrolled = clamp01(morph / 0.06);
  return unrolled * unrolled * (3 - 2 * unrolled) * high * high * (3 - 2 * high);
}

/** Presets that have air. A planet without one (`'none'`) needs no `PlanetAtmosphere`. */
export type PlanetAtmospherePresetId = Exclude<AtmospherePresetId, 'none'>;

/** Stage 4 of the planet material, as the atmosphere supplies it. */
export type AtmosphereLightingStage = (context: IAtmospherePlanetContext, input: IAtmosphereLightingInput) => any;
/** Stage 6 of the planet material, as the atmosphere supplies it. */
export type AtmosphereHazeStage = (context: IAtmospherePlanetContext, color: any) => any;

/**
 * A surface the atmosphere can light and haze: the planet material's two stage setters. Structural, so this entry
 * point does not import `triangular-engine/planet-material`; `PlanetSurfaceMaterial` (planet and ocean) satisfies it.
 */
export interface IAtmosphereSurface {
  setLightingStage(entry: { id: string; stage: AtmosphereLightingStage } | null): unknown;
  setAtmosphereStage(entry: { id: string; stage: AtmosphereHazeStage } | null): unknown;
}

/** Which stages {@link PlanetAtmosphere.withAtmosphere} puts on a surface. Both default to true. */
export interface AtmosphereSurfaceOptions {
  /** Relight the surface from the atmosphere (stage 4): orange ground at dusk, sky light in shadow. */
  lighting?: boolean;
  /** Aerial perspective (stage 6): distant ground fades into the air. */
  haze?: boolean;
  /**
   * Beyond the froxel range (a moon or a planet seen through the air), fade to the air along the view ray instead of
   * taking the haze of the range's far edge. Use it on a whole body seen from inside its atmosphere; terrain leaves it
   * off. Default false.
   */
  beyondRange?: boolean;
}

/** What the air is and how big the planet is. Changing any of it rebakes the tables (about 1-2 s at default sizes). */
export interface PlanetAtmosphereShape {
  /** Default `'earth'`. Ignored when {@link profile} is set. */
  preset?: PlanetAtmospherePresetId;
  /** A custom profile, authored at its own radius; it is scaled to {@link radiusM} like a preset. */
  profile?: PhysicalAtmosphereProfile;
  /** The planet's radius in metres. */
  radiusM: number;
  /** Air height divided by the radius (Earth ~0.0094, a Kerbin-style halo ~0.12). Default: the preset's own. */
  thickness?: number;
  /** The planet mesh's radius in world units. Default {@link radiusM} (one world unit is a metre). */
  radiusUnits?: number;
}

export interface PlanetAtmosphereOptions extends PlanetAtmosphereShape {
  /** The planet's root object: its world transform is the atmosphere's body frame. */
  planet: Object3D;
  /** Read the surface haze from a froxel table (default true) instead of marching each fragment. */
  aerialPerspective?: boolean | AtmosphereAerialPerspectiveOptions;
  /**
   * Share the planet material's morph uniform (`material.morph.uMorph`), so the atmosphere reads the same value the
   * material does. Without it, set {@link PlanetAtmosphere.morph}.
   */
  morph?: IUniform<number>;
  /** Baked table sizes. Fixed for the atmosphere's lifetime. */
  tables?: AtmosphereLutOptions;
  /** Sky-view table size. */
  skyView?: AtmosphereSkyViewOptions;
  /**
   * Sky march steps, the from-space pass resolution, and the multi-atmosphere rules: `ownsSky` and `minAngularRadius` (see
   * {@link AtmosphereBackdrop.ownsSky}).
   */
  backdrop?: Pick<AtmosphereBackdropOptions, 'steps' | 'spaceScale' | 'minAngularRadius' | 'ownsSky'>;
}

interface SurfaceEntry {
  lighting: boolean;
  haze: boolean;
  beyondRange: boolean;
}

export interface PlanetSkyBodyOptions extends AtmosphereSkyBodyOptions {
  /** Direction to the body in the planet's body frame, like {@link PlanetAtmosphere.sunDirection}. Default +z. */
  direction?: Vector3 | readonly [number, number, number];
}

/** A body in the sky of a {@link PlanetAtmosphere}: move it by writing {@link direction}. */
export interface PlanetSkyBody {
  readonly body: AtmosphereSkyBody;
  /** Direction to the body in the planet's body frame; read (and normalised) in {@link PlanetAtmosphere.update}. */
  readonly direction: Vector3;
}

/**
 * The Plan 049 atmosphere for one planet, in one object: it owns the model, the sky-view table, the sky behind the
 * planet and the binding, and puts the lighting and haze stages on the surfaces that opt in.
 *
 * ```ts
 * const atmosphere = new PlanetAtmosphere({ preset: 'earth', radiusM: 600_000, planet });
 * atmosphere.withAtmosphere(surface).withAtmosphere(ocean.material);
 * scene.add(atmosphere.object);
 * engine.beforeRender$.subscribe(() => atmosphere.update(renderer, engine.camera));
 * ```
 *
 * Call {@link update} once per frame after the camera has settled and before rendering (the engine's
 * `beforeRender$`), so the sky and the haze see the camera the frame is drawn with. Write the morph and the planet's
 * transform before that (by `lateUpdate$`). `<planetAtmosphere>` does all of this for an Angular scene.
 *
 * Needs `WebGPURenderer` (WebGPU or its WebGL2 fallback).
 */
export class PlanetAtmosphere {
  readonly model: AtmosphereGpuModel;
  readonly skyView: AtmosphereSkyViewLut;
  readonly backdrop: AtmosphereBackdrop;
  readonly binding: PlanetAtmosphereBinding;

  /** The planet's root object. */
  planet: Object3D;
  /** Unit direction to the sun in the planet's body frame (normalised in {@link update}). */
  readonly sunDirection = new Vector3(0, 0, 1);
  /** Linear scale on radiance before tone mapping. */
  exposure = 8;
  /** Off skips every sky lookup on the surfaces (a uniform branch, no recompile) and hides the sky. */
  enabled = true;
  /** Draw the sky and limb glow behind the planet. */
  sky = true;
  /**
   * Dissolve the sky shell as the planet unrolls ({@link skyShellFade}). Off keeps the shell at full strength at any morph, for
   * test stills that must show where the unbent shell sits. Default: on.
   */
  shellFade = true;
  /**
   * Star brightness, 0 (default) for none. The stars are part of the sky: they fade as the sky behind them brightens
   * and show through the air's transmittance, and they go when {@link sky} is off.
   */
  stars = 0;
  /**
   * Orientation of the stars in the planet's body frame. The stars are fixed in space, so a planet whose sun turns
   * around it (a day) turns them the same way.
   */
  readonly starRotation = new Quaternion();
  /** How long the last table bake took, ms. */
  lastBakeMs = 0;

  private readonly root = new Group();
  private readonly bodies: PlanetSkyBody[] = [];
  private readonly planetQuaternion = new Quaternion();
  private readonly starQuaternion = new Quaternion();
  private readonly starMatrix = new Matrix4();
  private readonly bodyWorld = new Vector3();
  private readonly sunWorld = new Vector3();
  private readonly shellCentre = new Vector3();
  private readonly planetScale = new Vector3();
  private readonly amount = uniform(1);
  private readonly lightingStage: AtmosphereLightingStage;
  private readonly hazeStage: AtmosphereHazeStage;
  private readonly distantHazeStage: AtmosphereHazeStage;
  private readonly surfaces = new Map<IAtmosphereSurface, SurfaceEntry>();
  private shape: PlanetAtmosphereShape;

  constructor(options: PlanetAtmosphereOptions) {
    this.planet = options.planet;
    this.shape = {
      preset: options.preset,
      profile: options.profile,
      radiusM: options.radiusM,
      thickness: options.thickness,
      radiusUnits: options.radiusUnits,
    };
    const started = performance.now();
    this.model = new AtmosphereGpuModel(this.buildProfile(), options.tables);
    this.lastBakeMs = performance.now() - started;
    this.skyView = new AtmosphereSkyViewLut(this.model, options.skyView);
    this.backdrop = new AtmosphereBackdrop(this.model, { ...options.backdrop, skyView: this.skyView });
    this.backdrop.groundEnabled.value = 0;
    this.backdrop.sunDiscStrength.value = 1;
    this.root.name = 'PlanetAtmosphere';
    this.root.add(this.backdrop.mesh);
    this.binding = new PlanetAtmosphereBinding(this.model, {
      radiusUnits: this.radiusUnits,
      aerialPerspective: options.aerialPerspective ?? true,
      morph: options.morph,
    });

    const lighting = this.binding.lighting();
    const haze = this.binding.perspective();
    const amount = this.amount;
    // Uniform branches: with the atmosphere off the shader skips the sky lookups entirely.
    this.lightingStage = (context, input) => {
      const out = input.color.toVar();
      If(amount.greaterThan(0), () => {
        out.assign(mix(input.color, lighting(context, input), float(amount)));
      });
      return out;
    };
    this.hazeStage = (context, color) => {
      const out = color.toVar();
      If(amount.greaterThan(0), () => {
        out.assign(mix(color, haze(context, color), float(amount)));
      });
      return out;
    };
    // Past the froxel range the table clamps to its far edge, so a far body would take that edge's haze. This stage
    // fades to the air along the fragment's view ray (the sky bodies' term) over the last quarter beyond the range.
    const table = this.binding.aerialPerspective;
    this.distantHazeStage = (context, color) => {
      const near = this.hazeStage(context, color);
      if (!table) return near;
      const metres = context.cameraDistance.mul(this.binding.metersPerUnit);
      const rangeMax = table.rangeMax;
      const { inscatter, transmittance } = this.backdrop.atmosphereSky(normalize(positionWorld.sub(cameraPosition)));
      const far = color.mul(transmittance).add(inscatter);
      const beyond = smoothstep(rangeMax, rangeMax.mul(1.25), metres);
      return mix(near, far, beyond.mul(amount));
    };
  }

  /** The sky behind the planet and the bodies in it (a group holding {@link backdrop}'s mesh); add it to the scene. */
  get object(): Object3D {
    return this.root;
  }

  /**
   * Air between the camera and a finite point, in world direction `worldDir` and world-unit distance `distance`.
   * Returns display-referred in-scattering and per-channel transmittance. Call inside a TSL `Fn` after `update`.
   * Only spherical atmospheres with an unscaled planet root are supported; the march costs per affected fragment.
   */
  foregroundAir(worldDir: any, distance: any): { inscatter: any; transmittance: any } {
    const backdrop = this.backdrop;
    const dir = normalize(backdrop.frame.mul(normalize(worldDir)));
    const air = this.model.march({
      altitude: backdrop.altitude,
      dir,
      sunDir: this.model.sunDirection,
      maxDistance: distance.mul(this.binding.metersPerUnit),
    });
    const amount = this.amount.mul(backdrop.opacity).mul(backdrop.objectAir);
    return {
      inscatter: air.radiance.mul(backdrop.exposure).mul(backdrop.sunVisibility).mul(amount),
      transmittance: mix(vec3(1), air.transmittance, amount),
    };
  }

  /** A planet-material overlay for an opaque surface seen through this planet's foreground air. */
  foregroundPerspective(): AtmosphereHazeStage {
    return (_context, color) => Fn(() => {
      const ray = positionWorld.sub(cameraPosition);
      const air = this.foregroundAir(ray, length(ray));
      return color.mul(air.transmittance).add(air.inscatter);
    })();
  }

  /** The bodies added with {@link addSkyBody}. */
  get skyBodies(): readonly PlanetSkyBody[] {
    return this.bodies;
  }

  /**
   * Adds a moon, planet or other body to the sky, seen through this atmosphere and lit by its sun. Returns a handle
   * whose `direction` (body frame) moves it.
   */
  addSkyBody(options: PlanetSkyBodyOptions = {}): PlanetSkyBody {
    const body = new AtmosphereSkyBody(this.backdrop, options);
    const direction = new Vector3(0, 0, 1);
    if (options.direction) direction.fromArray(Array.from(options.direction as ArrayLike<number>));
    const handle: PlanetSkyBody = { body, direction };
    this.bodies.push(handle);
    this.root.add(body.mesh);
    return handle;
  }

  /** Removes a body added with {@link addSkyBody} and frees it. */
  removeSkyBody(handle: PlanetSkyBody): void {
    const index = this.bodies.indexOf(handle);
    if (index < 0) return;
    this.bodies.splice(index, 1);
    handle.body.dispose();
  }

  /** How far the planet has unrolled into its flat map, 0..1. Writes the shared uniform when one was given. */
  get morph(): number {
    return this.binding.morph.value as number;
  }

  set morph(value: number) {
    this.binding.morph.value = value;
  }

  /** The planet mesh's radius in world units. */
  get radiusUnits(): number {
    return this.shape.radiusUnits ?? this.shape.radiusM;
  }

  /** The current shape (preset, profile, radius, thickness, radius in world units). */
  get currentShape(): Readonly<PlanetAtmosphereShape> {
    return this.shape;
  }

  /**
   * Changes the air or the planet's size. Rebakes the tables only when the preset, the profile, the radius or the
   * thickness changed; a new `radiusUnits` alone just rescales. Keys left out keep their value; a key passed as
   * `undefined` goes back to its default. Returns true when it rebaked.
   */
  configure(shape: Partial<PlanetAtmosphereShape>): boolean {
    const next = { ...this.shape, ...shape };
    if (next.radiusM === undefined) next.radiusM = this.shape.radiusM;
    const previousUnits = this.radiusUnits;
    const rebake =
      next.preset !== this.shape.preset ||
      next.profile !== this.shape.profile ||
      next.radiusM !== this.shape.radiusM ||
      next.thickness !== this.shape.thickness;
    this.shape = next;
    const rescale = rebake || this.radiusUnits !== previousUnits;
    if (rebake) {
      const started = performance.now();
      this.model.setProfile(this.buildProfile());
      this.lastBakeMs = performance.now() - started;
    }
    if (rescale) this.binding.refreshScale(this.radiusUnits);
    return rebake;
  }

  /**
   * Lights and hazes a surface with this atmosphere: sets its lighting stage (4) and atmosphere stage (6), with id
   * `'atmosphere'`. Calling it again with other options swaps the stages; the same options do nothing. Returns `this`.
   */
  withAtmosphere(surface: IAtmosphereSurface, options: AtmosphereSurfaceOptions = {}): this {
    const next: SurfaceEntry = {
      lighting: options.lighting ?? true,
      haze: options.haze ?? true,
      beyondRange: options.beyondRange ?? false,
    };
    const previous = this.surfaces.get(surface);
    if (previous?.lighting !== next.lighting) {
      surface.setLightingStage(next.lighting ? { id: 'atmosphere', stage: this.lightingStage } : null);
    }
    if (previous?.haze !== next.haze || previous?.beyondRange !== next.beyondRange) {
      const stage = next.beyondRange ? this.distantHazeStage : this.hazeStage;
      surface.setAtmosphereStage(next.haze ? { id: 'atmosphere', stage } : null);
    }
    this.surfaces.set(surface, next);
    return this;
  }

  /** Removes this atmosphere's stages from a surface, back to the material's defaults. Returns `this`. */
  withoutAtmosphere(surface: IAtmosphereSurface): this {
    const entry = this.surfaces.get(surface);
    if (!entry) return this;
    if (entry.lighting) surface.setLightingStage(null);
    if (entry.haze) surface.setAtmosphereStage(null);
    this.surfaces.delete(surface);
    return this;
  }

  /** True when {@link withAtmosphere} has put this atmosphere on the surface. */
  hasSurface(surface: IAtmosphereSurface): boolean {
    return this.surfaces.has(surface);
  }

  /**
   * Per-frame work: reads the camera and the planet's transform, fades the sky as the planet unrolls, and renders
   * the sky-view and froxel tables if anything moved. Call after the camera has settled, before rendering, outside a
   * render pass.
   */
  update(renderer: WebGPURenderer, camera: Camera): void {
    if (!renderer.initialized) return;
    const { binding, backdrop } = this;
    const on = this.enabled;
    this.amount.value = on ? 1 : 0;
    binding.exposure.value = this.exposure;
    const sun = this.sunDirection;
    binding.setSunBody(sun.x, sun.y, sun.z);
    binding.sync(camera, this.planet, backdrop);
    const fade = this.shellFade
      ? skyShellFade(this.morph, binding.skyAltitude.value as number, this.model.uTopAltitude.value as number)
      : 0;
    backdrop.opacity.value = 1 - fade;
    const wantSky = on && this.sky && fade < 1;
    backdrop.mesh.visible = wantSky;
    backdrop.stars.value = Math.max(0, this.stars);
    this.planet.getWorldQuaternion(this.planetQuaternion);
    // World directions to the star frame: undo the planet's rotation, then the stars' own.
    this.starQuaternion.copy(this.planetQuaternion).multiply(this.starRotation).invert();
    backdrop.starFrame.value.setFromMatrix4(this.starMatrix.makeRotationFromQuaternion(this.starQuaternion));
    this.sunWorld.copy(this.sunDirection).normalize().applyQuaternion(this.planetQuaternion);
    for (const { body, direction } of this.bodies) {
      this.bodyWorld.copy(direction).normalize().applyQuaternion(this.planetQuaternion);
      body.setDirections(this.bodyWorld, this.sunWorld);
    }
    if (on && this.anyHaze()) binding.update(renderer);
    if (wantSky) {
      // The air's outer shell, for the backdrop's screen bounds (a non-owner outside its air) and its apparent size.
      const { planetRadiusM } = this.model.profile;
      const top = this.model.uTopAltitude.value as number;
      this.planet.getWorldScale(this.planetScale);
      const worldScale = Math.max(this.planetScale.x, this.planetScale.y, this.planetScale.z);
      backdrop.setShell(
        this.planet.getWorldPosition(this.shellCentre),
        (this.radiusUnits * (planetRadiusM + top) * worldScale) / planetRadiusM,
      );
      backdrop.update(renderer, camera);
    }
    // Bodies stay in the sky without it, and when the backdrop is culled; then nothing in front of them is air.
    backdrop.objectAir.value = backdrop.mesh.visible ? 1 : 0;
  }

  /** Takes the stages off every surface, removes the sky and its bodies from the scene and frees the GPU resources. */
  dispose(): void {
    for (const surface of [...this.surfaces.keys()]) this.withoutAtmosphere(surface);
    for (const handle of [...this.bodies]) this.removeSkyBody(handle);
    this.root.removeFromParent();
    this.backdrop.mesh.removeFromParent();
    this.backdrop.dispose();
    this.binding.dispose();
    this.skyView.dispose();
    this.model.dispose();
  }

  private anyHaze(): boolean {
    for (const entry of this.surfaces.values()) if (entry.haze) return true;
    return false;
  }

  private buildProfile(): PhysicalAtmosphereProfile {
    const { preset, profile, radiusM, thickness } = this.shape;
    const scaling = { radiusM, thickness };
    const result = profile ? scaleAtmosphereProfile(profile, scaling) : createAtmospherePreset(preset ?? 'earth', scaling);
    if (result.kind !== 'physical') throw new Error('PlanetAtmosphere needs a physical atmosphere profile');
    return result;
  }
}
