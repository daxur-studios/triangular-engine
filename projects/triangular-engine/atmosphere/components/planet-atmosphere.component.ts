import { Component, DestroyRef, effect, inject, input, OnInit, signal, untracked } from '@angular/core';
import type { IUniform, Object3D, Vector3 } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { EngineService } from 'triangular-engine';
import type { PhysicalAtmosphereProfile } from '../atmosphere-profile';
import {
  PlanetAtmosphere,
  type IAtmosphereSurface,
  type PlanetAtmosphereOptions,
  type PlanetAtmospherePresetId,
} from '../planet-atmosphere';

/**
 * The Plan 049 atmosphere on a planet, declaratively: a thin wrapper around {@link PlanetAtmosphere}.
 *
 * ```html
 * <planetAtmosphere preset="earth" [radius]="600_000" [planet]="planet" [surfaces]="[surface, ocean.material]"
 *   [sunDirection]="sunBody" [morph]="surface.morph.uMorph" />
 * ```
 *
 * It adds the sky to the scene, puts the lighting and haze stages on `surfaces`, and updates once per frame in the
 * engine's `beforeRender$`, after the camera controls have settled in `lateUpdate$`. Inputs are read there, at call
 * time, so the frame always sees the camera and the morph it is drawn with. Write the morph and the planet's
 * transform by `lateUpdate$`; don't move the camera in `beforeRender$`.
 *
 * Changing `preset`, `profile`, `radius` or `thickness` rebakes the tables (about 1-2 s at default sizes). Needs
 * `preferredRenderer: 'webgpu'`; on the classic WebGL renderer it does nothing.
 */
@Component({
  standalone: true,
  selector: 'planetAtmosphere',
  template: '',
})
export class PlanetAtmosphereComponent implements OnInit {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  /** Air preset; ignored when `profile` is set. */
  readonly preset = input<PlanetAtmospherePresetId>('earth');
  /** A custom profile, scaled to `radius` like a preset. */
  readonly profile = input<PhysicalAtmosphereProfile | undefined>(undefined);
  /** The planet's radius in metres. */
  readonly radius = input.required<number>();
  /** The planet mesh's radius in world units. Default `radius` (one world unit is a metre). */
  readonly radiusUnits = input<number | undefined>(undefined);
  /** Air height divided by the radius. Default: the preset's own. */
  readonly thickness = input<number | undefined>(undefined);
  /** The planet's root object (its transform is the body frame). Default: the scene, with the planet at its origin. */
  readonly planet = input<Object3D | undefined>(undefined);
  /** Surfaces to light and haze, usually `PlanetSurfaceMaterial`s (planet and ocean). */
  readonly surfaces = input<readonly IAtmosphereSurface[]>([]);
  /** Relight the surfaces from the atmosphere (stage 4). */
  readonly lighting = input(true);
  /** Aerial perspective on the surfaces (stage 6). */
  readonly haze = input(true);
  /** Direction to the sun in the planet's body frame. */
  readonly sunDirection = input<Vector3 | readonly [number, number, number]>([0, 0, 1]);
  /**
   * 0 (globe) to 1 (flat map). Pass the material's `morph.uMorph` to share it (read when the component starts), or a
   * number to set it each frame.
   */
  readonly morph = input<number | IUniform<number>>(0);
  readonly exposure = input(8);
  /** Off skips the atmosphere on the surfaces (no recompile) and hides the sky. */
  readonly enabled = input(true);
  /** Draw the sky and limb glow behind the planet. */
  readonly sky = input(true);
  /** Star brightness, 0 for none (see `PlanetAtmosphere.stars`). Add moons with `atmosphere().addSkyBody()`. */
  readonly stars = input(0);
  /** Read the surface haze from a froxel table. Read when the component starts. */
  readonly aerialPerspective = input<PlanetAtmosphereOptions['aerialPerspective']>(true);

  /** The atmosphere, once the component has started: its binding and model for anything this wrapper doesn't cover. */
  readonly atmosphere = signal<PlanetAtmosphere | undefined>(undefined);

  private readonly attached = new Set<IAtmosphereSurface>();

  constructor() {
    effect(() => {
      const shape = {
        preset: this.preset(),
        profile: this.profile(),
        radiusM: this.radius(),
        radiusUnits: this.radiusUnits(),
        thickness: this.thickness(),
      };
      const atmosphere = this.atmosphere();
      if (atmosphere) untracked(() => atmosphere.configure(shape));
    });

    effect(() => {
      const atmosphere = this.atmosphere();
      const surfaces = this.surfaces();
      const options = { lighting: this.lighting(), haze: this.haze() };
      if (!atmosphere) return;
      untracked(() => {
        for (const surface of this.attached) {
          if (!surfaces.includes(surface)) atmosphere.withoutAtmosphere(surface);
        }
        this.attached.clear();
        for (const surface of surfaces) {
          atmosphere.withAtmosphere(surface, options);
          this.attached.add(surface);
        }
      });
    });
  }

  ngOnInit(): void {
    const morph = this.morph();
    const atmosphere = new PlanetAtmosphere({
      preset: this.preset(),
      profile: this.profile(),
      radiusM: this.radius(),
      radiusUnits: this.radiusUnits(),
      thickness: this.thickness(),
      planet: this.planet() ?? this.engine.scene,
      aerialPerspective: this.aerialPerspective(),
      morph: typeof morph === 'number' ? undefined : morph,
    });
    this.engine.scene.add(atmosphere.object);
    this.atmosphere.set(atmosphere);

    const frame = this.engine.beforeRender$.subscribe(() => this.update(atmosphere));
    this.destroyRef.onDestroy(() => {
      frame.unsubscribe();
      this.attached.clear();
      atmosphere.dispose();
    });
  }

  private update(atmosphere: PlanetAtmosphere): void {
    const renderer = this.engine.renderer as WebGPURenderer;
    if (!renderer?.isWebGPURenderer) return;
    atmosphere.planet = this.planet() ?? this.engine.scene;
    atmosphere.enabled = this.enabled();
    atmosphere.sky = this.sky();
    atmosphere.stars = this.stars();
    atmosphere.exposure = this.exposure();
    const sun = this.sunDirection();
    if (Array.isArray(sun)) atmosphere.sunDirection.set(sun[0], sun[1], sun[2]);
    else atmosphere.sunDirection.copy(sun as Vector3);
    const morph = this.morph();
    if (typeof morph === 'number') atmosphere.morph = morph;
    atmosphere.update(renderer, this.engine.camera);
  }
}
