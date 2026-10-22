import { Vector3, type Camera, type IUniform, type Object3D } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { If, float, mix, uniform } from 'three/tsl';
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
import { AtmosphereSkyViewLut, type AtmosphereSkyViewOptions } from './atmosphere-sky-view';

/* eslint-disable @typescript-eslint/no-explicit-any */

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
  /** Sky march steps and the from-space pass resolution. */
  backdrop?: Pick<AtmosphereBackdropOptions, 'steps' | 'spaceScale'>;
}

interface SurfaceEntry {
  lighting: boolean;
  haze: boolean;
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
  /** How long the last table bake took, ms. */
  lastBakeMs = 0;

  private readonly amount = uniform(1);
  private readonly lightingStage: AtmosphereLightingStage;
  private readonly hazeStage: AtmosphereHazeStage;
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
  }

  /** The sky behind the planet; add it to the scene. */
  get object(): Object3D {
    return this.backdrop.mesh;
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
    const next: SurfaceEntry = { lighting: options.lighting ?? true, haze: options.haze ?? true };
    const previous = this.surfaces.get(surface);
    if (previous?.lighting !== next.lighting) {
      surface.setLightingStage(next.lighting ? { id: 'atmosphere', stage: this.lightingStage } : null);
    }
    if (previous?.haze !== next.haze) {
      surface.setAtmosphereStage(next.haze ? { id: 'atmosphere', stage: this.hazeStage } : null);
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
    // The sky is a sphere's. Close to the ground it stays (the hazed horizon needs a sky behind it, whatever the morph);
    // it dissolves as the planet unrolls only once the camera is well above the air, from one to four air heights.
    const aboveAir = (binding.skyAltitude.value as number) / (this.model.uTopAltitude.value as number);
    const high = Math.min(1, Math.max(0, (aboveAir - 1) / 3));
    const unrolled = Math.min(1, Math.max(0, (this.morph - 0.2) / 0.6));
    const fade = unrolled * unrolled * (3 - 2 * unrolled) * high * high * (3 - 2 * high);
    backdrop.opacity.value = 1 - fade;
    backdrop.mesh.visible = on && this.sky && fade < 1;
    if (on && this.anyHaze()) binding.update(renderer);
    if (backdrop.mesh.visible) backdrop.update(renderer, camera);
  }

  /** Takes the stages off every surface, removes the sky from the scene and frees the GPU resources. */
  dispose(): void {
    for (const surface of [...this.surfaces.keys()]) this.withoutAtmosphere(surface);
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
