import { InjectionToken, type Signal } from '@angular/core';

/**
 * What a planet shares with the layers drawn on it: its size, the sun and the globe-to-map morph. Layers such as
 * `<planetTerrain>` (`triangular-engine/lod-surface`) and `<planetAtmosphere>` (`triangular-engine/atmosphere`) inject
 * {@link PLANET_CONTEXT} optionally and use these values for any input the layer does not set itself; `<planet>` in
 * `triangular-engine/lod-surface` is the provider.
 *
 * The planet's centre is the scene origin. Every field is a signal or a fixed object, so a layer follows the planet
 * without being told about changes.
 */
export interface PlanetContext {
  /** The planet's radius in metres (sea level). */
  readonly radius: Signal<number>;
  /** Unit direction to the sun in the scene frame (the planet's centre is the scene origin). */
  readonly sunDirection: Signal<readonly [number, number, number]>;
  /** 0 is the globe, 1 is the flat map; always within 0 to 1. */
  readonly morph: Signal<number>;
  /**
   * The shared morph uniform (`{ value }`): the same object for the planet's whole life, holding the same number as
   * {@link morph}. Layers that bend on the GPU, or that share the uniform with a material (such as the atmosphere), read
   * this instead of the signal.
   */
  readonly morphUniform: { value: number };
}

/**
 * Provided by `<planet>` (`triangular-engine/lod-surface`) to the layers inside it. Inject it with
 * `inject(PLANET_CONTEXT, { optional: true })`: a layer that works on its own uses the context only for inputs it was not
 * given. It lives in the root entry so that entries such as `triangular-engine/atmosphere` can read it without depending
 * on the terrain.
 */
export const PLANET_CONTEXT = new InjectionToken<PlanetContext>('PLANET_CONTEXT');
