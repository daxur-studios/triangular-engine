import { Component, DestroyRef, OnInit, computed, effect, inject, input, signal, untracked, type Signal } from '@angular/core';
import { EngineService, PLANET_CONTEXT } from 'triangular-engine';
import {
  SURFACE_LAYER_ORDER, flatFeatureLayer, type IFlatFeatureLayer, type PlanetSurfaceMaterial, type SurfaceLayer,
} from 'triangular-engine/planet-material';
import { FlatFeaturePageWindow, FlatFeatureSet, type FlatFeature } from 'triangular-engine/worldgen/render/core';

/** One surface layer a game adds to the planet's ground. The `id` is the layer's name on the material: the game owns it. */
export interface PlanetSurfaceDetailLayer {
  /** The layer's name on the material. Adding a second layer with the same name on one material throws. */
  readonly id: string;
  /** The layer itself, e.g. a `checkerDebugLayer(...).layer` or a game's own `SurfaceLayer`. */
  readonly layer: SurfaceLayer;
  /** Stack position: higher draws over lower. Default `SURFACE_LAYER_ORDER.game` plus the entry's index in `layers`. */
  readonly order?: number;
}

/** The layer id the flat features are added under, when `flatFeatures` is set. */
const FLAT_FEATURES_ID = 'flatFeatures';

/** A flat-feature set, its page window and its surface layer, built together for one `flatFeatures` and `radius`. */
interface IFlatFeatureState {
  readonly radiusM: number;
  readonly window: FlatFeaturePageWindow;
  readonly layer: IFlatFeatureLayer;
}

/**
 * Generic surface detail on a planet's ground: a list of surface layers (and optionally flat features such as runways and
 * roads) added to a `PlanetSurfaceMaterial`, usually the one `<planetTerrain>` draws with. The library draws no content of
 * its own here: the game passes the layers it wants.
 *
 * ```html
 * <planet [radius]="600_000" [sunDirection]="sun" [world]="world">
 *   <planetTerrain #terrain />
 *   <planetSurfaceDetail [surface]="groundMaterial" [layers]="detail" [flatFeatures]="runways" />
 * </planet>
 * ```
 *
 * Each entry of `layers` is added to `surface` under its `id`, in the order `order` gives (default `SURFACE_LAYER_ORDER.game`
 * plus its index, so later entries draw over earlier ones). When `layers`, `surface` or `enabled` change, the component removes
 * the layers it added and adds the new ones. A duplicate `id` in `layers` keeps the later entry. With `enabled` off, all its
 * layers come off the material; `surface` undefined means nothing is added and nothing throws.
 *
 * `flatFeatures` is optional: when set, the component resolves them against the planet radius, streams them into a page
 * window that follows the camera every frame, and adds that as the layer `flatFeatures` under the game's layers. It needs a
 * radius, from `[radius]` or the enclosing `<planet>`; without one it throws on init.
 *
 * The height stamp (flattening terrain under features) is not done here. Paint stays on the ground only if the heights were
 * stamped with the same features (`new FlatFeatureSet(features, radius).heightStamp()` in the bake's `modifyElevation`); without
 * it the paint follows the unflattened terrain.
 *
 * Layers read the planet's shared morph from the material, so they follow the morph with no extra input. Needs
 * `preferredRenderer: 'webgpu'` like the terrain it decorates.
 */
@Component({
  standalone: true,
  selector: 'planetSurfaceDetail',
  template: '',
})
export class PlanetSurfaceDetailComponent implements OnInit {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly context = inject(PLANET_CONTEXT, { optional: true });

  /** The material to add the layers to, e.g. a terrain's `surface()`. Undefined adds nothing. */
  readonly surface = input<PlanetSurfaceMaterial | undefined>(undefined);
  /** The surface layers to add. Default none. */
  readonly layers = input<readonly PlanetSurfaceDetailLayer[]>([]);
  /**
   * Flat features (runways, aprons, roads, taxiways) to paint on the ground, sharp at any distance. They are resolved against
   * `radius`. Default: none.
   */
  readonly flatFeatures = input<readonly FlatFeature[] | undefined>(undefined);
  /** The planet's radius in metres. Default the enclosing `<planet>`'s. Needed only with `flatFeatures`. */
  readonly radius = input<number | undefined>(undefined);
  /** Off removes every layer this component added; on adds them again. */
  readonly enabled = input(true);

  private readonly effectiveRadius: Signal<number | undefined> = computed(() => this.radius() ?? this.context?.radius());
  private readonly flatState = signal<IFlatFeatureState | undefined>(undefined);
  /** The layers the component has added, and the material they are on. Removed again before any change. */
  private applied: { readonly surface: PlanetSurfaceMaterial; readonly ids: string[] } | undefined;

  /** The layers the material should carry now: the game's (duplicate ids keep the later one), then the flat features. */
  private readonly wanted = computed<readonly { readonly id: string; readonly order: number; readonly layer: SurfaceLayer }[]>(() => {
    if (!this.enabled()) return [];
    const byId = new Map<string, { id: string; order: number; layer: SurfaceLayer }>();
    this.layers().forEach((entry, index) => {
      byId.set(entry.id, { id: entry.id, order: entry.order ?? SURFACE_LAYER_ORDER.game + index, layer: entry.layer });
    });
    const flat = this.flatState();
    const entries = [...byId.values()];
    if (flat) entries.push({ id: FLAT_FEATURES_ID, order: SURFACE_LAYER_ORDER.game - 1, layer: flat.layer.layer });
    return entries;
  });

  constructor() {
    effect(() => {
      const features = this.flatFeatures();
      const radiusM = this.effectiveRadius();
      untracked(() => {
        this.flatState()?.window.dispose();
        this.flatState.set(undefined);
        if (!features || radiusM === undefined) return;
        const window = new FlatFeaturePageWindow(new FlatFeatureSet(features, radiusM), { pageAltitudeRatio: 0.5 });
        this.flatState.set({ radiusM, window, layer: flatFeatureLayer(window) });
      });
    });

    effect(() => {
      const surface = this.surface();
      const entries = this.wanted();
      untracked(() => this.apply(surface, entries));
    });
  }

  ngOnInit(): void {
    if (this.flatFeatures() && this.effectiveRadius() === undefined) {
      throw new Error('<planetSurfaceDetail> has flatFeatures but no radius: set [radius] or put it inside a <planet [radius]>.');
    }
    const frame = this.engine.beforeRender$.subscribe(() => this.update());
    this.destroyRef.onDestroy(() => {
      frame.unsubscribe();
      this.apply(undefined, []);
      this.flatState()?.window.dispose();
      this.flatState.set(undefined);
    });
  }

  /** Removes the layers added before, then adds `entries` to `surface`. Adding throws on a name the material already has. */
  private apply(surface: PlanetSurfaceMaterial | undefined, entries: readonly { id: string; order: number; layer: SurfaceLayer }[]): void {
    const previous = this.applied;
    this.applied = undefined;
    if (previous) for (const id of previous.ids) previous.surface.removeSurfaceLayer(id);
    if (!surface) return;
    const ids: string[] = [];
    this.applied = { surface, ids };
    for (const entry of entries) {
      surface.addSurfaceLayer(entry);
      ids.push(entry.id);
    }
  }

  /** Every frame: move the flat-feature window with the camera. The planet centre is the scene origin. */
  private update(): void {
    const flat = this.flatState();
    if (!flat) return;
    const { x, y, z } = this.engine.camera.position;
    const distance = Math.hypot(x, y, z);
    if (distance === 0) return;
    flat.window.update([x / distance, y / distance, z / distance], distance - flat.radiusM);
  }
}
