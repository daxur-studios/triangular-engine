import type {
  ILatLonTerrainPatchAddress,
  ITerrainSurfaceSelectionRequest,
  LatLonTerrainDomain,
  TerrainSurfacePatchSelector,
} from 'triangular-engine/terrain';
import { MAP_PROJECTIONS, MapProjectionKind } from './map-projections';

export interface ICellPlanetMorphSurfaceSelectorOptions {
  /**
   * All fields are read live on every `select()` call rather than captured once, so this can be
   * constructed eagerly (e.g. as an Angular field initializer) before a required `radiusM`-style
   * input has actually been bound - the getters are simply not invoked until `select()` runs.
   */
  readonly domain: () => LatLonTerrainDomain;
  readonly radiusM: () => number;
  /** The 0 (sphere) .. 1 (flat map) morph driving the material. */
  readonly morph: () => number;
  readonly projectionKind: () => MapProjectionKind;
  /**
   * Refinement distance at level 0, as a multiple of `radiusM` (halved per level below that).
   * Defaults to 4.2, the value proven in the `cell-planet-morph-streaming` demo.
   */
  readonly refinementDistanceFactor?: () => number | undefined;
  /**
   * Threshold multiplier applied to a patch that was refined last frame, so a camera sitting
   * near the split boundary does not thrash between one and four patches every frame.
   * Defaults to 1.2 (the demo's value).
   */
  readonly stickyRefinementFactor?: () => number | undefined;
}

export interface ICellPlanetMorphSurfaceSelector {
  readonly select: TerrainSurfacePatchSelector<ILatLonTerrainPatchAddress>;
  /** Clears refinement-hysteresis state - call when the domain or radius changes. */
  readonly reset: () => void;
}

/**
 * Creates a stateful quadtree patch selector for `TerrainSurfaceComponent` that measures screen
 * relevance in the *morphed* position (blended between the sphere direction and the projected
 * flat-map position by the live `morph` value), so refinement follows what the camera can
 * actually see mid-morph instead of only the sphere's geometry. Extracted from the proven
 * `cell-planet-morph-streaming` demo page (see runbook 039's "morph-aware patch selector" gap)
 * and generalized: quality knobs, projection and radius are supplied by the caller rather than
 * hardcoded to that demo's presets.
 */
export function createCellPlanetMorphSurfaceSelector(
  options: ICellPlanetMorphSurfaceSelectorOptions,
): ICellPlanetMorphSurfaceSelector {
  let previousRefinedKeys = new Set<string>();

  interface Candidate {
    readonly address: ILatLonTerrainPatchAddress;
    readonly key: string;
    readonly distance: number;
    readonly threshold: number;
    readonly canRefine: boolean;
    readonly priority: number;
  }

  const select = (
    request: ITerrainSurfaceSelectionRequest<ILatLonTerrainPatchAddress>,
  ): readonly ILatLonTerrainPatchAddress[] => {
    const domain = options.domain();
    const radius = options.radiusM();
    const morph = options.morph();
    const mapWidth = 2 * Math.PI * radius;
    const mapHeight = Math.PI * radius;
    const projection = MAP_PROJECTIONS[options.projectionKind()];
    const maxLevel = request.maxLevel;
    const refinementDistanceFactor = options.refinementDistanceFactor?.() ?? 4.2;
    const stickyRefinementFactor = options.stickyRefinementFactor?.() ?? 1.2;
    const baseRefinementDistance = radius * refinementDistanceFactor;
    const cam = request.cameraWorldM;
    const nextRefined = new Set<string>();

    const measure = (address: ILatLonTerrainPatchAddress): Candidate => {
      const bounds = domain.getPatchBounds(address);
      const u = (bounds.minU + bounds.maxU) * 0.5;
      const v = (bounds.minV + bounds.maxV) * 0.5;
      const dir = domain.getFieldPosition(address, u, v);

      const sphereX = dir[0] * radius;
      const sphereY = dir[1] * radius;
      const sphereZ = dir[2] * radius;

      const proj = projection.project(u, v, mapWidth, mapHeight);
      const flatX = proj.x - mapWidth * 0.5;
      const flatY = mapHeight * 0.5 - proj.y;

      const cx = (1 - morph) * sphereX + morph * flatX;
      const cy = (1 - morph) * sphereY + morph * flatY;
      const cz = (1 - morph) * sphereZ; // flat map's z is 0 at patch-center resolution

      const distance = Math.hypot(cx - cam[0], cy - cam[1], cz - cam[2]);
      const key = request.getKey(address);
      const wasRefined = previousRefinedKeys.has(key);
      const threshold =
        (baseRefinementDistance / Math.pow(2, address.level)) *
        (wasRefined ? stickyRefinementFactor : 1);

      return {
        address,
        key,
        distance,
        threshold,
        canRefine: address.level < maxLevel,
        priority: threshold / Math.max(distance, 1),
      };
    };

    const maxPatches = Math.max(
      request.roots.length,
      Math.floor(request.maxPatches ?? Number.MAX_SAFE_INTEGER),
    );

    // Start with one resident patch per root, then spend the remaining budget on the most
    // screen-relevant leaves. Replacing one leaf with four children costs three additional
    // patches, so the result always stays within maxPatches while remaining a complete cut.
    const frontier = request.roots.map(measure);
    while (frontier.length < maxPatches) {
      let bestIndex = -1;
      let bestPriority = 1;
      for (let index = 0; index < frontier.length; index += 1) {
        const candidate = frontier[index];
        if (!candidate.canRefine || candidate.distance >= candidate.threshold) {
          continue;
        }
        if (candidate.priority > bestPriority) {
          bestIndex = index;
          bestPriority = candidate.priority;
        }
      }

      if (bestIndex < 0) break;

      const [parent] = frontier.splice(bestIndex, 1);
      nextRefined.add(parent.key);
      for (const child of domain.getChildren(parent.address)) {
        frontier.push(measure(child));
      }
    }

    previousRefinedKeys = nextRefined;
    return frontier.map((candidate) => candidate.address);
  };

  return {
    select,
    reset: () => {
      previousRefinedKeys = new Set();
    },
  };
}
