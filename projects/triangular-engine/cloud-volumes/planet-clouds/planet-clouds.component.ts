import { Component, DestroyRef, computed, effect, inject, input, OnInit, signal, untracked } from '@angular/core';
import type { IUniform, Vector3 } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { EngineService, PLANET_CONTEXT, type PlanetContext } from 'triangular-engine';
import type { IPlanetMorphUniforms } from 'triangular-engine/planet-material';
import { PlanetCloudShell } from './planet-cloud-shell';

/** The sun direction used when neither the component nor a `<planet>` gives one. */
const DEFAULT_SUN: readonly [number, number, number] = [0, 0, 1];

/**
 * The part of a `<planet>`'s context that carries its morph uniforms. `<planet>` provides them (`morphUniforms`), but the
 * root `PlanetContext` type does not declare them yet, so the component reads them through this shape.
 */
type PlanetMorphContext = PlanetContext & { readonly morphUniforms?: IPlanetMorphUniforms };

/**
 * A planet-wide cloud layer, declaratively: a thin wrapper around {@link PlanetCloudShell}. Put it inside `<planet>`
 * beside `<planetTerrain>` and `<planetAtmosphere>`:
 *
 * ```html
 * <planet [radius]="600_000" [sun]="..." [morph]="m">
 *   <planetTerrain /> <planetAtmosphere preset="earth" /> <planetClouds [coverage]="0.45" />
 * </planet>
 * ```
 *
 * The clouds are a v1 far shell: a 2D noise layer just above the surface, lit with the same analytic sun as the
 * atmosphere's surface, with no volumes to fly through. The sun is in the planet's body frame, which is the scene frame
 * when the planet is at the origin.
 *
 * **Morph.** Inside a `<planet>` the layer bends into the flat map with the planet's morph, as the terrain does, so it stays
 * a thin layer above the ground at every morph. Its shading uses the unbent globe direction (a known simplification). Given
 * its own `morph` input instead, it does not bend: it fades out as the morph rises, as the sky does, and is hidden at 1.
 *
 * **Inside `<planet>`** the planet's values stand in for inputs you leave out, and an input you set always wins: `radius`
 * (required from one of the two; without either, `ngOnInit` throws), `sunDirection`, and `morph`. Without an own `morph`
 * the planet's shared morph uniforms drive the bend every frame.
 *
 * WebGPU only: on the classic WebGL renderer the layer stays hidden and does nothing.
 */
@Component({
  standalone: true,
  selector: 'planetClouds',
  template: '',
})
export class PlanetCloudsComponent implements OnInit {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly context = inject(PLANET_CONTEXT, { optional: true }) as PlanetMorphContext | null;

  /** The planet's radius in metres. Default: the enclosing `<planet>`'s; one of the two is required. */
  readonly radius = input<number | undefined>(undefined);
  /** The planet mesh's radius in world units. Default `radius` (one world unit is a metre). */
  readonly radiusUnits = input<number | undefined>(undefined);
  /** Thickness of the cloud band in world units. Default: a fraction of the radius, see {@link PlanetCloudShell}. */
  readonly altitude = input<number | undefined>(undefined);
  /** Share of the sky under cloud, 0 (clear) to 1 (overcast). Default 0.45. */
  readonly coverage = input(0.45);
  /** Width of the soft cloud edge, in density units. Default 0.12. */
  readonly softness = input(0.12);
  /** Noise frequency over the planet: higher gives smaller cloud systems. Default 3. */
  readonly scale = input(3);
  /** Drift speed in noise units per second. Default 0.002. */
  readonly drift = input(0.002);
  /**
   * Direction to the sun in the planet's body frame. Default: the enclosing `<planet>`'s (the same as the scene frame when
   * the planet is at the origin), else `[0, 0, 1]`.
   */
  readonly sunDirection = input<Vector3 | readonly [number, number, number] | undefined>(undefined);
  /**
   * 0 (globe) to 1 (flat map). Pass the material's `morph.uMorph` to share it, or a number to set it each frame.
   * Default: the enclosing `<planet>`'s morph uniform, else 0. Given an own value, the layer fades out as the morph rises
   * and is hidden at 1. Left out inside a `<planet>`, the layer bends with the planet's morph and is not faded or hidden.
   */
  readonly morph = input<number | IUniform<number> | undefined>(undefined);
  /** Off hides the clouds and skips their update. */
  readonly enabled = input(true);

  /** The cloud layer, once the component has started: its binding for anything this wrapper doesn't cover. */
  readonly shell = signal<PlanetCloudShell | undefined>(undefined);

  private readonly effectiveRadius = computed(() => this.radius() ?? this.context?.radius());

  constructor() {
    effect(() => {
      const radiusM = this.effectiveRadius();
      const shape = { radiusUnits: this.radiusUnits() ?? radiusM, altitude: this.altitude() };
      const shell = this.shell();
      if (shell && shape.radiusUnits !== undefined) untracked(() => shell.configure({ radiusUnits: shape.radiusUnits, altitude: shape.altitude }));
    });
  }

  ngOnInit(): void {
    const radiusM = this.effectiveRadius();
    if (radiusM === undefined) {
      throw new Error('<planetClouds> has no radius: set [radius] or put it inside a <planet [radius]>.');
    }
    // An own `morph` input keeps the morph fade; otherwise a planet's morph uniforms make the layer bend instead.
    const morphUniforms = this.morph() === undefined ? this.context?.morphUniforms : undefined;
    const shell = new PlanetCloudShell({
      radiusUnits: this.radiusUnits() ?? radiusM,
      altitude: this.altitude(),
      coverage: this.coverage(),
      softness: this.softness(),
      scale: this.scale(),
      drift: this.drift(),
      morphUniforms,
    });
    shell.object.visible = false;
    this.engine.scene.add(shell.object);
    this.shell.set(shell);

    const frame = this.engine.beforeRender$.subscribe(() => this.update(shell));
    this.destroyRef.onDestroy(() => {
      frame.unsubscribe();
      this.engine.scene.remove(shell.object);
      shell.dispose();
    });
  }

  private update(shell: PlanetCloudShell): void {
    const renderer = this.engine.renderer as WebGPURenderer;
    if (!renderer?.isWebGPURenderer) {
      shell.object.visible = false;
      return;
    }
    shell.coverage = this.coverage();
    shell.softness = this.softness();
    shell.scale = this.scale();
    shell.drift = this.drift();
    shell.enabled = this.enabled();

    const sun = this.sunDirection() ?? this.context?.sunDirection() ?? DEFAULT_SUN;
    if (Array.isArray(sun)) shell.sunDirection.set(sun[0], sun[1], sun[2]);
    else shell.sunDirection.copy(sun as Vector3);

    const morph = this.morph() ?? this.context?.morphUniform;
    shell.morph = typeof morph === 'number' ? morph : (morph?.value ?? 0);

    shell.update(this.engine.camera, performance.now() / 1000);
  }
}
