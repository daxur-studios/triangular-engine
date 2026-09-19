import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  model,
  OnDestroy,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Plane,
  PlaneGeometry,
  Raycaster,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import { EngineService, GroupComponent, provideObject3DComponent } from 'triangular-engine';
import {
  add,
  buildPlanetEcology,
  buildPlanetGraphCore,
  buildPlanetTectonics,
  computeFeatures,
  createSeededRandom,
  cross,
  deriveIsLand,
  dot,
  findCellAt,
  IPlanetEcology,
  IPlanetFeatures,
  IPlanetGraphCore,
  IPlanetTectonics,
  IVec3,
  IWorldProfile,
  normalize,
  projectOnTangentPlane,
  scale as scaleVec3,
  vec3,
  WORLD_PROFILES,
  WorldProfileKind,
} from 'triangular-engine/worldgen';
import { biomeColor, elevationColor, lavaOceanColor, moistureColor, plateColor, temperatureColor } from '../color-ramps';
import { MAP_PROJECTIONS, MapProjectionKind } from '../map-projections';

/** Fixed logical space every shape is drawn in via `mapPoint()` before `#rasterize()` maps it
 * onto the offscreen canvas backing the terrain `CanvasTexture` — not a bitmap resolution in its
 * own right, just the coordinate space world-space lon/lat gets projected into. 2:1 aspect - the
 * default equirectangular projection fills it exactly; a non-rectangular one (e.g. Equal Earth, see
 * `projectionType`/`../map-projections.ts`) fits inside it with background showing at the edges. */
const BASE_WIDTH = 3000;
const BASE_HEIGHT = 1500;

const MIN_ZOOM = 1;
const MAX_ZOOM = 14;

/** Largest dimension the offscreen raster canvas is allowed to grow to at high zoom — a `zoom`
 * past this point stops gaining raster detail and just magnifies the capped texture, same
 * "inherent detail ceiling" trade `PlanetViewComponent`'s own mesh LOD makes. Every re-rasterize
 * (see `#rasterize()`) redraws the *entire* map — every cell, river, icon — at this resolution, so
 * this constant directly sets how long each one takes; 8192 (quadruple the pixel-fill cost of the
 * original 4096) measurably reintroduced interaction lag (see `PARAM_DEBOUNCE_MS`/
 * `RASTERIZE_DEBOUNCE_MS` above — debouncing *when* a rasterize fires doesn't shrink how long the
 * one that does fire takes). 6144 (~2.25x the pixel-fill cost of 4096, still well under 8192's 4x)
 * pushes the crisp-zoom ceiling to ~2.1x (dpr=1) instead of 4096's ~1.4x — most of the low/mid zoom
 * range is crisp now, but a lot of `MAX_ZOOM` (14) still reads soft at this dimension. A single
 * whole-map texture fundamentally can't stay crisp across a 14x range regardless of this constant
 * (that would need a >40000px-wide texture); fixing that for real means re-rasterizing only the
 * visible viewport region at high zoom. */
const MAX_RASTER_DIM = 6144;

/** Trailing debounce applied to every wheel-driven zoom change before re-rasterizing the terrain
 * texture at the new resolution — see `#requestRasterize()`. Re-rasterizing the whole map on every
 * wheel-delta frame during a zoom gesture would be wasteful; the texture is magnified (briefly
 * soft) mid-gesture and snaps sharp once this fires. */
const RASTERIZE_DEBOUNCE_MS = 150;

/** Leading+trailing throttle interval applied to the generation/ecology/layer-toggle effects below
 * (cellCount, waterLevel, iconBudget, etc.). Every one of those inputs is driven by a
 * `<input type="range">` in the demo page, which fires an `input` event per pixel of drag - without
 * *some* limit, dragging a slider re-runs the full (expensive - graph rebuild, ecology rebuild, or
 * full-map rasterize) pipeline dozens of times a second. A trailing-only debounce was tried first
 * and reads as dead/unresponsive while dragging - the whole point of a live slider is seeing the
 * map update *as you drag*, not only once you let go. Throttle instead: the first change in a burst
 * runs immediately (leading edge), then at most once every `PARAM_THROTTLE_MS` while the burst
 * continues, plus one final trailing run so the settled value is never dropped. Kept short/
 * "generous" on purpose so dragging still reads as live, not periodic. */
const PARAM_THROTTLE_MS = 120;

/** How many cells' worth of fill drawing `#rasterize()` does per `requestAnimationFrame` tick
 * before yielding back to the browser - see `#runChunked()`. A full rasterize used to draw every
 * cell synchronously in one call, which at high `cellCount`/raster resolution is long enough to
 * read as an input stall (the exact "blocks the main thread" complaint this exists to fix). This
 * is deliberately *not* a worker/OffscreenCanvas move - the per-cell draw logic, `this` context,
 * and canvas 2D calls stay exactly where they are; only the loop that drives them now spreads
 * across frames instead of running to completion in one. Small enough that even a single frame's
 * worth of work stays well under a 16ms budget at default settings, large enough that a full
 * rasterize still finishes in a handful of frames rather than trickling in visibly slowly. */
const RASTERIZE_CHUNK_SIZE = 400;

/** Screen-pixel drag distance below which a pointerdown->pointerup is treated as a click
 * (`cellClick`) rather than a pan gesture — see `onPointerMove()`/`#dragDistance`. */
const CLICK_DRAG_THRESHOLD_PX = 4;

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

/** Uniform global temperature swing per season, additive on top of the world profile's own
 * `baseTemperatureOffset` and `climateExtreme`. `summer` is 0 (baseline generation, unchanged)
 * since it's the default. Deliberately *not* a hemisphere/axial-tilt model — `computeClimate()`'s
 * latitude term uses `abs(y)`, so north and south are already symmetric; a real
 * winter-in-one-hemisphere effect needs that changed in `worldgen` itself. */
const SEASON_TEMPERATURE_OFFSET: Record<Season, number> = {
  summer: 0,
  spring: -0.12,
  autumn: -0.18,
  winter: -0.32,
};

/** Elevation-units-per-`waterLevel`-unit — same order of magnitude as `noiseAmplitude` (0.08) and
 * the continental/oceanic base gap (0.85) in `elevation.ts`'s `DEFAULTS`, so the full -1..1 range
 * visibly drowns/exposes coastal terrain without swallowing whole continents. */
const WATER_LEVEL_ELEVATION_SCALE = 0.3;

type IconDrawer = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rng: () => number) => void;

const INK = '#241a10';

function drawRoundTree(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rng: () => number): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, size * 0.06);
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.5);
  ctx.lineTo(x, y + size * 0.05);
  ctx.stroke();
  ctx.fillStyle = `hsl(${100 + rng() * 25}, 32%, ${30 + rng() * 12}%)`;
  const lobes = 3;
  for (let i = 0; i < lobes; i++) {
    const angle = (i / lobes) * Math.PI * 2 + rng() * 0.7;
    const ox = Math.cos(angle) * size * 0.16;
    const oy = Math.sin(angle) * size * 0.12 - size * 0.18;
    ctx.beginPath();
    ctx.ellipse(x + ox, y + oy, size * 0.26, size * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(36,26,16,0.5)';
  ctx.lineWidth = Math.max(0.6, size * 0.03);
  ctx.stroke();
}

function drawPineTree(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rng: () => number): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, size * 0.06);
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.5);
  ctx.lineTo(x, y + size * 0.15);
  ctx.stroke();
  ctx.fillStyle = `hsl(${140 + rng() * 20}, 28%, ${22 + rng() * 10}%)`;
  for (let tier = 0; tier < 3; tier++) {
    const w = size * (0.34 - tier * 0.08);
    const topY = y - size * (0.08 + tier * 0.16);
    const baseY = topY + size * 0.2;
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x - w, baseY);
    ctx.lineTo(x + w, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawGrassTuft(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rng: () => number): void {
  ctx.strokeStyle = `hsl(${85 + rng() * 30}, 38%, 28%)`;
  ctx.lineWidth = Math.max(0.8, size * 0.05);
  const blades = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < blades; i++) {
    const lean = (i - (blades - 1) / 2) * 0.35 + (rng() - 0.5) * 0.2;
    ctx.beginPath();
    ctx.moveTo(x, y + size * 0.3);
    ctx.quadraticCurveTo(
      x + lean * size * 0.3,
      y - size * 0.05,
      x + lean * size * 0.55,
      y - size * 0.35,
    );
    ctx.stroke();
  }
}

function drawCactus(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rng: () => number): void {
  ctx.strokeStyle = INK;
  ctx.fillStyle = `hsl(${110 + rng() * 20}, 30%, 32%)`;
  ctx.lineWidth = Math.max(0.8, size * 0.05);
  ctx.beginPath();
  ctx.roundRect(x - size * 0.08, y - size * 0.35, size * 0.16, size * 0.55, size * 0.08);
  ctx.fill();
  ctx.stroke();
  const armY = y - size * 0.1;
  ctx.beginPath();
  ctx.roundRect(x - size * 0.28, armY - size * 0.18, size * 0.14, size * 0.28, size * 0.06);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(x + size * 0.14, armY - size * 0.28, size * 0.14, size * 0.28, size * 0.06);
  ctx.fill();
  ctx.stroke();
}

function drawMountain(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rng: () => number): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, size * 0.06);
  ctx.fillStyle = `hsl(30, 14%, ${34 + rng() * 10}%)`;
  ctx.beginPath();
  ctx.moveTo(x - size * 0.4, y + size * 0.3);
  ctx.lineTo(x, y - size * 0.42);
  ctx.lineTo(x + size * 0.4, y + size * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f4f4f4';
  ctx.beginPath();
  ctx.moveTo(x, y - size * 0.42);
  ctx.lineTo(x - size * 0.12, y - size * 0.16);
  ctx.lineTo(x + size * 0.12, y - size * 0.16);
  ctx.closePath();
  ctx.fill();
}

function drawVolcano(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rng: () => number): void {
  drawMountain(ctx, x, y, size, rng);
  ctx.fillStyle = '#c0432a';
  ctx.beginPath();
  ctx.arc(x, y - size * 0.44, size * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(192,67,42,0.7)';
  ctx.lineWidth = Math.max(0.6, size * 0.03);
  ctx.beginPath();
  ctx.moveTo(x, y - size * 0.48);
  ctx.quadraticCurveTo(x + size * 0.08, y - size * 0.62, x + size * 0.03, y - size * 0.74);
  ctx.stroke();
}

function drawIceShard(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rng: () => number): void {
  ctx.strokeStyle = '#7fb8c9';
  ctx.fillStyle = 'rgba(220,240,245,0.85)';
  ctx.lineWidth = Math.max(0.8, size * 0.05);
  const spikes = 3;
  for (let i = 0; i < spikes; i++) {
    const angle = -Math.PI / 2 + (i - 1) * 0.55 + (rng() - 0.5) * 0.15;
    const len = size * (0.32 + rng() * 0.14);
    ctx.beginPath();
    ctx.moveTo(x, y + size * 0.3);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }
}

function drawRock(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rng: () => number): void {
  ctx.strokeStyle = INK;
  ctx.fillStyle = `hsl(25, 12%, ${38 + rng() * 12}%)`;
  ctx.lineWidth = Math.max(0.8, size * 0.05);
  ctx.beginPath();
  ctx.ellipse(x, y, size * 0.3, size * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

const BIOME_ICONS: Partial<Record<string, IconDrawer>> = {
  meadow: drawGrassTuft,
  steppe: drawGrassTuft,
  savanna: drawGrassTuft,
  taiga: drawPineTree,
  jungle: drawRoundTree,
  rainforest: drawRoundTree,
  desert: drawCactus,
  alpine: drawMountain,
  hills: drawRock,
  canyon: drawRock,
  tundra: drawIceShard,
  ice_cap: drawIceShard,
  glacier: drawIceShard,
};

const FEATURE_ICONS: Partial<Record<string, IconDrawer>> = {
  volcano: drawVolcano,
  mesa: drawMountain,
  crater: drawRock,
};

type ILonLat = { lon: number; lat: number };

/** Longitude jump between consecutive points bigger than this signals the antimeridian seam
 * (`atan2` wrapping from +pi to -pi), not a real edge on the sphere. */
const SEAM_THRESHOLD = Math.PI * 0.9;

/** One contiguous run produced by `splitAtSeam()`. `closed` is true only for the single-run,
 * no-cut-found case - every run produced by an actual split is open, since a shape cut at the
 * seam has no way to sensibly reconnect its ends. */
interface ISeamRun {
  pts: ILonLat[];
  closed: boolean;
}

/** Splits the internal edges of an already-linear (non-wrapping) point sequence into maximal
 * runs wherever a seam jump occurs - shared by both the open-path case and the rotated closed
 * loop below. */
function splitLinearAtSeam(pts: ILonLat[]): ILonLat[][] {
  const cuts: number[] = [];
  for (let k = 0; k < pts.length - 1; k++) {
    if (Math.abs(pts[k].lon - pts[k + 1].lon) > SEAM_THRESHOLD) cuts.push(k);
  }
  if (cuts.length === 0) return [pts];
  const runs: ILonLat[][] = [];
  let start = 0;
  for (const c of cuts) {
    runs.push(pts.slice(start, c + 1));
    start = c + 1;
  }
  runs.push(pts.slice(start));
  return runs.filter((r) => r.length >= 2);
}

/** Splits a loop or path into maximal runs of consecutive points that never cross the
 * antimeridian seam, instead of drawing a spurious line straight across the map or dropping the
 * whole thing. A closed loop (e.g. a coastline) that crosses the seam becomes one or more open
 * runs - there's no way to "close" a shape that's been cut, so every returned run is open. */
function splitAtSeam(lls: ILonLat[], closed: boolean): ISeamRun[] {
  const n = lls.length;
  if (n < 2) return [{ pts: lls, closed }];

  if (!closed) {
    return splitLinearAtSeam(lls).map((pts) => ({ pts, closed: false }));
  }

  const firstCut = lls.findIndex((p, k) => Math.abs(p.lon - lls[(k + 1) % n].lon) > SEAM_THRESHOLD);
  if (firstCut === -1) return [{ pts: lls, closed: true }];

  const start = (firstCut + 1) % n;
  const rotated = Array.from({ length: n }, (_, step) => lls[(start + step) % n]);
  return splitLinearAtSeam(rotated).map((pts) => ({ pts, closed: false }));
}

/** Mutable state for one `#throttleRun()` call site - see `PARAM_THROTTLE_MS`. */
interface IThrottleState {
  lastRun: number;
  handle: number | null;
}

export interface ICellClickEvent {
  cellId: number;
  direction: IVec3;
}

export interface IProjectionRecenteredEvent {
  center: IVec3;
  source: 'doubleClick' | 'programmatic';
}

/** Optional host-owned world data shared by several planet renderers. */
export interface ICellPlanetMapWorldData {
  readonly graph: IPlanetGraphCore;
  readonly tectonics: IPlanetTectonics;
  readonly ecology: IPlanetEcology;
  readonly features: IPlanetFeatures;
  readonly seaLevelElevation: number;
}

/**
 * Reusable Voronoi cell-graph flat map renderer (runbook 022/024's 2D counterpart to
 * `PlanetViewComponent`). Generates a graph + tectonics + ecology from the generation inputs
 * below, exactly like `<planetView>`, but renders it as a flat map instead of a sphere: the
 * existing canvas-2D cell-fill/river/coastline/decorative-icon drawing is rasterized into an
 * offscreen canvas, wrapped in a `CanvasTexture`, and mapped onto a `PlaneGeometry` — so pan/zoom
 * become this component's own `position`/`scale` (inherited from `Object3DComponent`) instead of
 * a DOM/CSS transform, and clicks resolve to cells via a camera-ray/world-plane intersection
 * instead of raw canvas pixel math.
 *
 * **Assumption**: this component owns its `position`/`scale` as its pan/zoom state (`position.z`
 * always 0, `scale` always a uniform number, never rotated) — do not bind `[position]`/`[scale]`/
 * `[rotation]` externally, and do not nest it under a rotated/offset parent; the click/pan/zoom
 * math assumes the map plane sits unrotated at world Z=0. Wrap it in an external `<group>` if you
 * need to also place the whole map elsewhere in a larger scene.
 *
 * **Interaction is the consumer's to wire**, same convention as `<planetView>` leaving camera
 * control to the consumer's own `<orbitControls>`: forward your own DOM pointer/wheel events to
 * `onWheel()`/`onPointerDown()`/`onPointerMove()`/`onPointerUp()`/`onClick()`/`onDoubleClick()`,
 * passing the element whose bounding box matches your rendered viewport.
 *
 * Game-icon layer (bulk add/remove + smooth per-frame "follow") is a separate follow-up, not
 * built here — nothing above precludes adding it as a second object inside this component later.
 */
export type CellPlanetMapFillMode = 'biome' | 'elevation' | 'plates' | 'temperature' | 'moisture' | 'land';

@Component({
  selector: 'cellPlanetMap',
  imports: [],
  template: '<ng-content></ng-content>',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [provideObject3DComponent(CellPlanetMapComponent)],
})
export class CellPlanetMapComponent extends GroupComponent implements OnDestroy {
  /** When supplied, adopt this graph/terrain instead of generating a second world. */
  readonly worldData = input<ICellPlanetMapWorldData | null>(null);
  // ==========================================================================
  // Generation inputs
  // ==========================================================================
  readonly cellCount = input(1500);
  readonly seed = input(1);
  readonly relaxationIterations = input(2);
  readonly jitter = input(0.35);
  readonly plateCount = input(14);
  readonly worldProfileKind = input<WorldProfileKind>('terran');

  // ==========================================================================
  // Ecology-restyle inputs ("restyle, don't reroll" - recompute climate/biomes/rivers/features
  // from the existing terrain rather than rebuilding plates/elevation on every change)
  // ==========================================================================
  /** -1 (ice age) .. 1 (extreme heat/desertification), on top of the world profile's own
   * `baseTemperatureOffset`. */
  readonly climateExtreme = input(0);
  readonly season = input<Season>('summer');
  /** -1 (seas fall) .. 1 (seas rise) - shifts the land/ocean threshold on the fixed elevation
   * field via `deriveIsLand()`. */
  readonly waterLevel = input(0);

  // ==========================================================================
  // Rendering inputs
  // ==========================================================================
  /** Which per-cell data drives the base terrain fill color - same mode set as `<planetView>`'s
   * `renderMode` (`PlanetRenderMode`), independent named type here since the two components don't
   * share an input contract. Lava (`oceanSubstance: 'lava'` worlds, or a `lava_lake` feature cell)
   * always overrides the chosen mode - it isn't a fill mode itself, just a substance override that
   * applies regardless of what data layer you're looking at. */
  readonly fillMode = input<CellPlanetMapFillMode>('biome');

  /** Which lon/lat -> canvas-space projection draws (and hit-tests) the map - see
   * `worldgen/render/map-projections.ts`. Changing this re-rasterizes (below) but does not move
   * `projectionCenter` - the two are independent (center = which point on the sphere is centered,
   * type = how the sphere unwraps onto the plane around it). */
  readonly projectionType = input<MapProjectionKind>('equirectangular');

  /** Decorative, deterministic biome/feature glyphs (trees/mountains/etc.) baked into the
   * terrain raster - unrelated to any future game-marker icon layer. */
  readonly showIcons = input(true);
  readonly iconBudget = input(1400);
  readonly showRivers = input(true);
  readonly showRidges = input(true);
  readonly showCellEdges = input(false);

  // ==========================================================================
  // Capability: cell highlighting
  // ==========================================================================
  readonly highlightedCellIds = input<ReadonlySet<number> | readonly number[]>([]);
  readonly highlightColor = input<string>('#ffe066');

  // ==========================================================================
  // Capability: projection center - `model()` so a consumer can both bind it externally
  // (`[(projectionCenter)]`) and read the double-click-driven recenter via the auto-generated
  // `projectionCenterChange` output; `projectionRecentered` additionally carries *why* it changed.
  // ==========================================================================
  readonly projectionCenter = model<IVec3>({ x: 1, y: 0, z: 0 });
  readonly projectionRecentered = output<IProjectionRecenteredEvent>();

  // ==========================================================================
  // Capability: click-to-cell
  // ==========================================================================
  readonly cellClick = output<ICellClickEvent>();

  // ==========================================================================
  // Public readonly-in-spirit state (mirrors PlanetViewComponent)
  // ==========================================================================
  readonly graph = signal<IPlanetGraphCore | null>(null);
  readonly tectonics = signal<IPlanetTectonics | null>(null);
  readonly ecology = signal<IPlanetEcology | null>(null);
  readonly buildMs = signal<number | null>(null);

  /** Pan/zoom state - see the class doc comment's "Assumption" section. Public so a consumer's
   * own UI (e.g. a zoom-level readout) can read them; use `onWheel()`/`onPointerDown/Move/Up()`
   * or `resetView()` to change them, not `.set()` directly. */
  readonly panX = signal(0);
  readonly panY = signal(0);
  readonly zoomLevel = signal(1);

  // ==========================================================================
  // Three.js resources
  // ==========================================================================
  private readonly offscreenCanvas = document.createElement('canvas');
  /** Draw target for `#rasterize()` itself - see `#commitScratchCanvas()`. Keeping the live
   * `offscreenCanvas`/`texture` untouched until a rasterize fully completes (cells + edges +
   * coastlines + rivers + icons) means the plane only ever shows a *complete* frame, old or new -
   * never a just-cleared background or a partially cell-filled in-progress one. */
  private readonly scratchCanvas = document.createElement('canvas');
  /** Not `readonly` - `#commitScratchCanvas()` replaces this instance whenever the raster canvas
   * actually changes size (see its own doc comment for why an in-place `needsUpdate` isn't safe
   * then). */
  private texture: CanvasTexture;
  private readonly planeGeometry = new PlaneGeometry(BASE_WIDTH, BASE_HEIGHT);
  private readonly planeMaterial: MeshBasicMaterial;
  private readonly planeMesh: Mesh;

  private readonly raycaster = new Raycaster();
  private readonly groundPlane = new Plane(new Vector3(0, 0, 1), 0);

  private baseSeaLevelElevation = 0;
  private features: IPlanetFeatures = { feature: [], instances: [], featureByCellId: new Map() };
  private worldDataSource: ICellPlanetMapWorldData | null = null;

  private dragging = false;
  private dragDistance = 0;
  private lastPointerX = 0;
  private lastPointerY = 0;

  private rasterizeDebounceHandle: number | null = null;

  /** Bumped by every `#rasterize()` call; `#runChunked()`'s in-flight `requestAnimationFrame`
   * chain checks this each tick and bails the moment it no longer matches - the cancellation
   * mechanism for "a newer rasterize (or component destroy) superseded this chunked one mid-draw".
   * Without it, a slider drag that retriggers `#rasterize()` before the previous chunked run
   * finished would keep drawing stale cells into the (possibly now wrong-sized) canvas. */
  private rasterizeToken = 0;

  /** Per-effect throttle state for `#throttleRun()` - see `PARAM_THROTTLE_MS`. Plain mutable
   * objects (rather than three more scalar fields) so `#throttleRun()` can take one and mutate it
   * by reference instead of needing a field name per call site. */
  private readonly regenerateThrottle: IThrottleState = { lastRun: 0, handle: null };
  private readonly ecologyThrottle: IThrottleState = { lastRun: 0, handle: null };
  private readonly layersThrottle: IThrottleState = { lastRun: 0, handle: null };

  constructor() {
    super();

    this.offscreenCanvas.width = BASE_WIDTH;
    this.offscreenCanvas.height = BASE_HEIGHT;
    this.texture = new CanvasTexture(this.offscreenCanvas);
    // Canvas 2D pixels are sRGB-encoded color data - without this, the renderer's own sRGB output
    // encoding pass double-applies (the raw bytes get treated as linear, then re-encoded), which
    // reads as a washed-out/overbright "flashlight" look across the whole texture. Same fix
    // `sprite-material.component.ts` and `render-target.component.ts` already apply for the same
    // reason - see their own comments.
    this.texture.colorSpace = SRGBColorSpace;
    this.planeMaterial = new MeshBasicMaterial({ map: this.texture, side: DoubleSide });
    this.planeMesh = new Mesh(this.planeGeometry, this.planeMaterial);
    this.planeMesh.name = 'CellPlanetMapTerrain';
    (this.object3D() as Group).add(this.planeMesh);

    // untracked() below is load-bearing, not a style choice: #regenerate()/#rebuildEcology()/
    // #requestRasterize() all read graph()/tectonics()/ecology() deep inside (and, on the
    // generation/ecology paths, .set() fresh objects onto those same signals). Without
    // untracked(), those incidental reads become *this effect's own* dependencies too - and
    // since buildPlanetGraphCore()/buildPlanetEcology() return a new object reference every call,
    // each run's own write reads back as "changed", rescheduling the effect forever. Same
    // discipline as PlanetViewComponent's usePinning effect (see its own doc comment).
    effect(() => {
      const worldData = this.worldData();
      this.cellCount();
      this.seed();
      this.relaxationIterations();
      this.jitter();
      this.plateCount();
      this.worldProfileKind();
      untracked(() =>
        this.#throttleRun(this.regenerateThrottle, () =>
          worldData ? this.#adoptWorldData(worldData) : this.#regenerate(),
        ),
      );
    });

    effect(() => {
      this.climateExtreme();
      this.season();
      this.waterLevel();
      untracked(() => this.#throttleRun(this.ecologyThrottle, () => this.#rebuildEcology()));
    });

    effect(() => {
      this.projectionCenter();
      untracked(() => this.#requestRasterize('other'));
    });

    effect(() => {
      this.fillMode();
      this.showIcons();
      this.iconBudget();
      this.showRivers();
      this.showRidges();
      this.showCellEdges();
      this.highlightedCellIds();
      this.highlightColor();
      this.projectionType();
      untracked(() => this.#throttleRun(this.layersThrottle, () => this.#requestRasterize('other')));
    });

    effect(() => {
      const x = this.panX();
      const y = this.panY();
      this.position.set([x, y, 0]);
    });

    effect(() => {
      this.scale.set(this.zoomLevel());
    });

    // The very first #rasterize() (triggered by the generation effect above) almost always runs
    // before the consuming <scene>'s ResizeObserver has fired even once - EngineService.resolution$
    // starts at a placeholder {width:50,height:50} (see its own field doc) until the real viewport
    // size is measured, so that first rasterize bakes at a tiny, wrong resolution. Nothing
    // previously re-rasterized once the real size became known, so the map stayed wrong until some
    // unrelated interaction (a slider, a double-click) happened to trigger another #rasterize() -
    // this is the "looks wrong until you click something" bug. Re-rasterizing on every resolution$
    // change (debounced like a zoom - see #requestRasterize()) fixes it at the source instead of
    // relying on an incidental later trigger.
    this.engineService.resolution$.pipe(takeUntilDestroyed()).subscribe(() => this.#requestRasterize('resize'));
  }

  override ngOnDestroy(): void {
    // Supersede any in-flight chunked rasterize so its requestAnimationFrame chain bails on its
    // next tick instead of continuing to draw into a canvas whose owning component is gone.
    this.rasterizeToken++;
    if (this.rasterizeDebounceHandle !== null) clearTimeout(this.rasterizeDebounceHandle);
    if (this.regenerateThrottle.handle !== null) clearTimeout(this.regenerateThrottle.handle);
    if (this.ecologyThrottle.handle !== null) clearTimeout(this.ecologyThrottle.handle);
    if (this.layersThrottle.handle !== null) clearTimeout(this.layersThrottle.handle);
    this.planeGeometry.dispose();
    this.planeMaterial.dispose();
    this.texture.dispose();
    super.ngOnDestroy();
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  resetView(): void {
    this.zoomLevel.set(1);
    this.panX.set(0);
    this.panY.set(0);
    this.#requestRasterize('other');
  }

  /** Applies a reproducible consumer-owned view for visual comparison harnesses. */
  setView(view: { readonly panX: number; readonly panY: number; readonly zoom: number }): void {
    this.zoomLevel.set(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom)));
    this.panX.set(view.panX);
    this.panY.set(view.panY);
    this.#requestRasterize('other');
  }

  resetProjectionCenter(): void {
    this.recenterProjection({ x: 1, y: 0, z: 0 }, 'programmatic');
  }

  recenterProjection(center: IVec3, source: 'doubleClick' | 'programmatic' = 'programmatic'): void {
    const normalized = normalize(center);
    this.projectionCenter.set(normalized);
    this.projectionRecentered.emit({ center: normalized, source });
  }

  /** Resolves the graph cell under a plane-local point (`BASE_WIDTH`/`BASE_HEIGHT` space, origin
   * at map center - what `onClick()` etc. compute via `#screenToLocalPoint()`). Exposed so a
   * consumer can do their own picking (e.g. against a custom overlay) and still land on the same
   * cell math this component uses internally. Returns `null` outside the map's bounds, before a
   * graph exists, or across the projection's own polar singularities. */
  resolveCellAt(localPoint: { x: number; y: number }): ICellClickEvent | null {
    const graph = this.graph();
    if (!graph) return null;
    if (Math.abs(localPoint.x) > BASE_WIDTH / 2 || Math.abs(localPoint.y) > BASE_HEIGHT / 2) return null;

    const direction = this.#sphereDirectionFromLocalPoint(localPoint);
    if (!direction) return null;
    const cell = findCellAt(graph, direction);
    return { cellId: cell.id, direction };
  }

  onWheel(event: WheelEvent, viewportEl: HTMLElement): void {
    event.preventDefault();
    const worldHit = this.#screenToWorldZ0Point(event.clientX, event.clientY, viewportEl);
    if (!worldHit) return;

    const oldZoom = this.zoomLevel();
    const factor = Math.exp(-event.deltaY * 0.0015);
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom * factor));
    if (newZoom === oldZoom) return;

    // Keep the point under the cursor stationary: solve for the new pan that maps the same
    // plane-local point (under the cursor, at the old zoom/pan) to the same world position at
    // the new zoom - same algebra the page used for CSS pixels, done here in world units.
    const localX = (worldHit.x - this.panX()) / oldZoom;
    const localY = (worldHit.y - this.panY()) / oldZoom;
    this.zoomLevel.set(newZoom);
    this.panX.set(worldHit.x - newZoom * localX);
    this.panY.set(worldHit.y - newZoom * localY);
    this.#requestRasterize('zoom');
  }

  onPointerDown(event: PointerEvent): void {
    this.dragging = true;
    this.dragDistance = 0;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  /** Converts the screen-pixel drag delta into a world-space delta by comparing the ground-plane
   * hit before/after, rather than a fixed pixel-to-world ratio - necessary because an arbitrary
   * consumer camera (ortho or perspective, any distance/fov/zoom) maps screen pixels to world
   * units differently, unlike the page's original fixed-canvas-CSS-pixel-space math. */
  onPointerMove(event: PointerEvent, viewportEl: HTMLElement): void {
    if (!this.dragging) return;
    const dx = event.clientX - this.lastPointerX;
    const dy = event.clientY - this.lastPointerY;
    this.dragDistance += Math.hypot(dx, dy);
    const prevWorld = this.#screenToWorldZ0Point(this.lastPointerX, this.lastPointerY, viewportEl);
    const nextWorld = this.#screenToWorldZ0Point(event.clientX, event.clientY, viewportEl);
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    if (!prevWorld || !nextWorld) return;
    this.panX.update((v) => v + (nextWorld.x - prevWorld.x));
    this.panY.update((v) => v + (nextWorld.y - prevWorld.y));
  }

  onPointerUp(): void {
    this.dragging = false;
  }

  /** Resolves a click to a cell (`cellClick`) - ignored if the preceding pointerdown->up moved
   * more than `CLICK_DRAG_THRESHOLD_PX`, so panning never spuriously selects a cell. */
  onClick(event: MouseEvent, viewportEl: HTMLElement): void {
    if (this.dragDistance > CLICK_DRAG_THRESHOLD_PX) return;
    const local = this.#screenToLocalPoint(event.clientX, event.clientY, viewportEl);
    if (!local) return;
    const resolved = this.resolveCellAt(local);
    if (resolved) this.cellClick.emit(resolved);
  }

  /** Rotates the clicked map point to the projection center (`recenterProjection()`), so the
   * area under the cursor moves to the low-distortion middle of the map instead of wherever it
   * happened to land. */
  onDoubleClick(event: MouseEvent, viewportEl: HTMLElement): void {
    const local = this.#screenToLocalPoint(event.clientX, event.clientY, viewportEl);
    if (!local) return;
    if (Math.abs(local.x) > BASE_WIDTH / 2 || Math.abs(local.y) > BASE_HEIGHT / 2) return;
    const direction = this.#sphereDirectionFromLocalPoint(local);
    if (!direction) return;
    this.recenterProjection(direction, 'doubleClick');
  }

  // ==========================================================================
  // Screen/world/local coordinate helpers
  // ==========================================================================

  /** Casts a ray from the consumer's active camera through the given screen point and intersects
   * the world Z=0 plane - independent of this component's own pan/zoom (`position`/`scale`),
   * since that transform never touches Z. `viewportEl`'s bounding box is assumed to match the
   * consumer's actual rendered viewport. */
  #screenToWorldZ0Point(clientX: number, clientY: number, viewportEl: HTMLElement): { x: number; y: number } | null {
    const rect = viewportEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const camera = this.engineService.camera;
    if (!camera) return null;

    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.raycaster.setFromCamera(ndc, camera);
    const hit = new Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, hit) ? { x: hit.x, y: hit.y } : null;
  }

  /** As `#screenToWorldZ0Point()`, then un-pans/un-zooms into plane-local (`BASE_WIDTH`/
   * `BASE_HEIGHT`-space) coordinates using this component's own current `panX`/`panY`/
   * `zoomLevel`. */
  #screenToLocalPoint(clientX: number, clientY: number, viewportEl: HTMLElement): { x: number; y: number } | null {
    const world = this.#screenToWorldZ0Point(clientX, clientY, viewportEl);
    if (!world) return null;
    const zoom = this.zoomLevel();
    return { x: (world.x - this.panX()) / zoom, y: (world.y - this.panY()) / zoom };
  }

  /** Inverts a plane-local point (`BASE_WIDTH`/`BASE_HEIGHT` space, origin at map center) back to
   * canvas space, then through the selected `projectionType()`'s `unproject()` and the exact
   * lon/lat -> sphere-direction chain `#rasterize()`'s `mapPoint()`/`lonLat()` use, un-rotated
   * through the *current* projection basis to recover the true sphere-space point. Returns `null`
   * where `unproject()` does - a rectangular-canvas point outside a non-rectangular projection's
   * (e.g. Equal Earth's lens-shaped) valid area. */
  #sphereDirectionFromLocalPoint(localPoint: { x: number; y: number }): IVec3 | null {
    const canvasX = localPoint.x + BASE_WIDTH / 2;
    const canvasY = BASE_HEIGHT / 2 - localPoint.y;
    const lonLat = MAP_PROJECTIONS[this.projectionType()].unproject(canvasX, canvasY, BASE_WIDTH, BASE_HEIGHT);
    if (!lonLat) return null;
    const { lon, lat } = lonLat;
    const local = vec3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));

    const { forward, up, right } = this.#projectionBasis();
    const rotated = add(add(scaleVec3(forward, local.x), scaleVec3(up, local.y)), scaleVec3(right, local.z));
    return normalize(rotated);
  }

  /** Orthonormal basis rotating `projectionCenter` to local +X (map center). `forward` becomes
   * the new lon=0/lat=0 axis, `up` the new pole axis (world +Y projected onto the tangent plane
   * at `forward`, so "north" stays "up" on the map except right at the projection's own poles),
   * `right` the new lon=+90 axis. At the default center `(1,0,0)` this reduces to the original
   * unrotated `{forward:(1,0,0), up:(0,1,0), right:(0,0,1)}` exactly. */
  #projectionBasis(): { forward: IVec3; up: IVec3; right: IVec3 } {
    const forward = normalize(this.projectionCenter());
    const worldUp = Math.abs(forward.y) > 0.999 ? vec3(0, 0, 1) : vec3(0, 1, 0);
    const up = normalize(projectOnTangentPlane(worldUp, forward));
    const right = cross(forward, up);
    return { forward, up, right };
  }

  /** Sphere direction -> canvas-space `{x,y}` (`0..BASE_WIDTH`/`0..BASE_HEIGHT`, y-down, origin
   * top-left), through the given basis - the same lon/lat + mapPoint composition `#rasterize()`'s
   * own `lonLat()`/`mapPoint()` closures use (kept separate there since a few callers need the
   * intermediate lon/lat, e.g. seam-splitting). Factored out so `projectDirectionToLocalPoint()`
   * below doesn't duplicate it. Canvas space, not plane-local space - see that method for the
   * distinction (same one `#sphereDirectionFromLocalPoint()`'s `canvasX`/`canvasY` locals draw). */
  #directionToCanvasPoint(direction: IVec3, basis: { forward: IVec3; up: IVec3; right: IVec3 }): { x: number; y: number } {
    const lon = Math.atan2(dot(direction, basis.right), dot(direction, basis.forward));
    const lat = Math.asin(Math.max(-1, Math.min(1, dot(direction, basis.up))));
    return MAP_PROJECTIONS[this.projectionType()].project(lon, lat, BASE_WIDTH, BASE_HEIGHT);
  }

  /** Sphere direction -> plane-local `{x,y}` (`BASE_WIDTH`/`BASE_HEIGHT` space, origin at map
   * center, +Y = north = up) - the same space `resolveCellAt()`'s `localPoint` parameter and
   * `#screenToLocalPoint()` use, and the space a sibling Object3D (e.g. `<cellPlanetMapUnits>`)
   * should position itself in, since it shares this component's own local coordinate frame (both
   * are children of the same `Group`). Uses the *current* `projectionCenter()` basis, recomputed
   * fresh on every call (cheap - this is meant for a handful of per-tick calls, not the
   * thousands-of-corners rasterize loop), so a caller re-projecting every frame automatically stays
   * correct across a `recenterProjection()` with no extra invalidation wiring. */
  projectDirectionToLocalPoint(direction: IVec3): { x: number; y: number } {
    const canvas = this.#directionToCanvasPoint(direction, this.#projectionBasis());
    return { x: canvas.x - BASE_WIDTH / 2, y: BASE_HEIGHT / 2 - canvas.y };
  }

  // ==========================================================================
  // Generation / ecology
  // ==========================================================================

  #regenerate(): void {
    const t0 = performance.now();
    this.worldDataSource = null;
    const profile = WORLD_PROFILES[this.worldProfileKind()];

    const graph = buildPlanetGraphCore({
      cellCount: this.cellCount(),
      seed: this.seed(),
      relaxationIterations: this.relaxationIterations(),
      jitter: this.jitter(),
    });
    this.graph.set(graph);

    const tectonics = buildPlanetTectonics(graph, {
      plateCount: this.plateCount(),
      seed: this.seed(),
      ...profile.tectonics,
    });
    this.tectonics.set(tectonics);
    this.baseSeaLevelElevation = tectonics.seaLevelElevation;

    this.#rebuildEcology();

    this.buildMs.set(performance.now() - t0);
  }

  /** Adopts shared world data while keeping canvas rasterization and interaction local. */
  #adoptWorldData(worldData: ICellPlanetMapWorldData): void {
    const t0 = performance.now();
    this.worldDataSource = worldData;
    this.graph.set(worldData.graph);
    // The ecology controls below mutate sea level/land flags, so give this renderer its own
    // mutable tectonics shell and leave the shared snapshot safe for globe/morph consumers.
    this.tectonics.set({ ...worldData.tectonics, isLand: worldData.tectonics.isLand.slice() });
    // The shared snapshot already contains this page's water-level shift. Keep the unshifted
    // baseline here because #rebuildEcology() applies the control once when it derives land.
    this.baseSeaLevelElevation =
      worldData.seaLevelElevation - this.waterLevel() * WATER_LEVEL_ELEVATION_SCALE;
    this.#rebuildEcology();
    this.buildMs.set(performance.now() - t0);
  }

  /** Recomputes climate/biomes/rivers/features from the existing terrain (graph + tectonics)
   * without rebuilding plates/elevation - so `climateExtreme`/`season`/`waterLevel` all restyle
   * the *same* map instead of rerolling a new one on every change. `#regenerate()` also routes
   * through here after building fresh terrain. */
  #rebuildEcology(): void {
    const graph = this.graph();
    const currentTectonics = this.tectonics();
    if (!graph || !currentTectonics) return;

    const tectonics = this.worldDataSource
      ? { ...currentTectonics, isLand: currentTectonics.isLand.slice() }
      : currentTectonics;

    const profile = WORLD_PROFILES[this.worldProfileKind()];

    const seaLevelElevation = this.baseSeaLevelElevation + this.waterLevel() * WATER_LEVEL_ELEVATION_SCALE;
    tectonics.seaLevelElevation = seaLevelElevation;
    tectonics.isLand = deriveIsLand(
      graph,
      tectonics.elevation,
      seaLevelElevation,
      profile.tectonics?.minRegionCellFraction,
    );
    if (this.worldDataSource) this.tectonics.set(tectonics);

    const ecology = buildPlanetEcology(graph, tectonics, {
      climate: { ...profile.climate, baseTemperatureOffset: this.#effectiveTemperatureOffset(profile) },
      biomes: profile.biomes,
    });
    this.ecology.set(ecology);
    this.features = computeFeatures(graph, tectonics, ecology.waterBodyKind, profile.features);
    this.#requestRasterize('other');
  }

  /** Sums the world profile's own offset (a world-type knob, e.g. Moon's cold baseline) with
   * `climateExtreme` and the season toggle. */
  #effectiveTemperatureOffset(profile: IWorldProfile): number {
    const base = profile.climate.baseTemperatureOffset ?? 0;
    return base + this.climateExtreme() * 0.8 + SEASON_TEMPERATURE_OFFSET[this.season()];
  }

  /** Leading+trailing throttle - see `PARAM_THROTTLE_MS`'s doc comment for why this replaced a
   * plain trailing debounce. Runs `fn` immediately if `state` hasn't run within the last
   * `PARAM_THROTTLE_MS`, otherwise schedules exactly one trailing run for when that window
   * elapses (re-scheduling, not stacking, on repeated calls within the window). */
  #throttleRun(state: IThrottleState, fn: () => void): void {
    if (state.handle !== null) {
      clearTimeout(state.handle);
      state.handle = null;
    }
    const now = performance.now();
    const elapsed = now - state.lastRun;
    if (elapsed >= PARAM_THROTTLE_MS) {
      state.lastRun = now;
      fn();
    } else {
      state.handle = window.setTimeout(() => {
        state.handle = null;
        state.lastRun = performance.now();
        fn();
      }, PARAM_THROTTLE_MS - elapsed);
    }
  }

  // ==========================================================================
  // Terrain rasterization
  // ==========================================================================

  /** Immediate for anything other than a zoom gesture or a viewport resize (regenerate, layer
   * toggle, highlight change, projection recenter). Zoom and resize are both trailing-debounced,
   * regardless of direction - re-rasterizing the whole map (all cells/rivers/icons, up to
   * `MAX_RASTER_DIM` pixels) is genuinely expensive, not just "risky to upload", so firing it
   * synchronously on every wheel-delta tick (as a zoom-decrease used to) or every intermediate
   * `ResizeObserver` callback during a window drag reads as lag mid-gesture: trackpads and mice
   * routinely emit a stray opposite-sign tick inside what the user experiences as one continuous
   * zoom-in, and a resize drag fires many `resolution$` updates in quick succession. The displayed
   * texture keeps showing the previous complete frame until the debounce fires and the new one
   * finishes (see `#commitScratchCanvas()`). Panning never calls this at all - see
   * `onPointerMove()`. */
  #requestRasterize(reason: 'zoom' | 'resize' | 'other'): void {
    if (this.rasterizeDebounceHandle !== null) {
      clearTimeout(this.rasterizeDebounceHandle);
      this.rasterizeDebounceHandle = null;
    }
    if (reason === 'zoom' || reason === 'resize') {
      this.rasterizeDebounceHandle = window.setTimeout(() => {
        this.rasterizeDebounceHandle = null;
        this.#rasterize();
      }, RASTERIZE_DEBOUNCE_MS);
    } else {
      this.#rasterize();
    }
  }

  /** Draws the map into `scratchCanvas`, never touching the live `offscreenCanvas`/`texture`
   * until `#commitScratchCanvas()` publishes the finished result - see `scratchCanvas`'s own field
   * doc comment for why. The scratch canvas is sized to the renderer's actual on-screen
   * device-pixel width, scaled by `zoomLevel` and clamped to `MAX_RASTER_DIM` (see the
   * `displayPixelWidth` comment below) - rather than fixed at `BASE_WIDTH x BASE_HEIGHT` - a
   * `CanvasTexture` uploaded once at a fixed pixel size and then magnified by zooming `scale` up
   * is exactly the "fixed-resolution bitmap stretched by a transform" bug the demo page's own
   * `ctx.setTransform` fix eliminated for the DOM-canvas case; this is the same discipline applied
   * to the texture source instead. All drawing below still emits plain `BASE_WIDTH`/`BASE_HEIGHT`-
   * space coordinates via `mapPoint()`, unchanged - only the top-level sizing/transform differs. */
  #rasterize(): void {
    const graph = this.graph();
    const tectonics = this.tectonics();
    const ecology = this.ecology();
    if (!graph || !tectonics || !ecology) return;

    // Supersede any still-running chunked rasterize from a previous call - its `#runChunked()`
    // step() bails on its next tick once it sees this.
    const token = ++this.rasterizeToken;

    // The plane spans BASE_WIDTH world units at zoom 1 inside the consumer's fixed-frustum ortho
    // camera, so the raster resolution that's actually needed for a crisp render is however many
    // *device* pixels the renderer's own canvas occupies on screen - not BASE_WIDTH itself. Using
    // `zoomLevel * dpr` alone (as an earlier revision did) silently assumed the displayed viewport
    // is exactly BASE_WIDTH CSS pixels wide, which is essentially never true (this demo page's
    // viewport is narrower still, sharing width with a side panel) - it was rasterizing several
    // times more pixels than the page ever shows, on every regenerate/ecology-rebuild/rasterize.
    // That's the real reason this got much slower than the old direct-canvas page: that page sized
    // its canvas to `viewport.clientWidth * dpr` exactly; falling back to BASE_WIDTH here (instead
    // of 0) only matters for a rasterize that lands before the renderer canvas has been sized -
    // which is also handled at the source now (see the `resolution$` subscription in the
    // constructor), so this fallback is a last-resort guard, not the normal path.
    const displayPixelWidth = this.engineService.renderer.domElement.width || BASE_WIDTH;
    const pixelsPerBaseUnit = displayPixelWidth / BASE_WIDTH;
    const maxScale = MAX_RASTER_DIM / BASE_WIDTH;
    const effScale = Math.min(this.zoomLevel() * pixelsPerBaseUnit, maxScale);
    const rasterWidth = Math.max(1, Math.round(BASE_WIDTH * effScale));
    const rasterHeight = Math.max(1, Math.round(BASE_HEIGHT * effScale));

    const canvas = this.scratchCanvas;
    if (canvas.width !== rasterWidth || canvas.height !== rasterHeight) {
      canvas.width = rasterWidth;
      canvas.height = rasterHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(rasterWidth / BASE_WIDTH, 0, 0, rasterHeight / BASE_HEIGHT, 0, 0);

    ctx.fillStyle = '#141d2e';
    ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

    const { forward, up, right } = this.#projectionBasis();
    const lonLat = (p: IVec3): ILonLat => ({
      lon: Math.atan2(dot(p, right), dot(p, forward)),
      lat: Math.asin(Math.max(-1, Math.min(1, dot(p, up)))),
    });
    const projection = MAP_PROJECTIONS[this.projectionType()];
    const mapPoint = (ll: ILonLat): { x: number; y: number } => projection.project(ll.lon, ll.lat, BASE_WIDTH, BASE_HEIGHT);

    const profile = WORLD_PROFILES[this.worldProfileKind()];
    // Only actually read by 'elevation' fill mode, but cheap next to the per-cell fill loop below
    // (the dominant cost of a rasterize) - not worth gating behind fillMode() === 'elevation'.
    let elevMin = Infinity;
    let elevMax = -Infinity;
    for (const e of tectonics.elevation) {
      if (e < elevMin) elevMin = e;
      if (e > elevMax) elevMax = e;
    }
    const highlightIdsInput = this.highlightedCellIds();
    const highlighted = highlightIdsInput instanceof Set ? highlightIdsInput : new Set(highlightIdsInput);
    const highlightColor = this.highlightColor();

    // Cell fill - the dominant cost of a rasterize (one fill() per cell, up to `cellCount`), so
    // this is the loop that actually gets chunked; everything drawn on top of it below (edges,
    // coastlines, rivers, icons) only runs once every cell has been filled, in `onCellFillDone`.
    const onCellFillDone = (): void => {
      if (this.showCellEdges()) {
        ctx.strokeStyle = 'rgba(20,14,8,0.25)';
        ctx.lineWidth = 1;
        for (const cell of graph.cells) {
          const n = cell.corners.length;
          if (n < 3) continue;
          const lls = cell.corners.map(lonLat);
          for (let k = 0; k < n; k++) {
            const a = lls[k];
            const b = lls[(k + 1) % n];
            if (Math.abs(a.lon - b.lon) > Math.PI * 0.9) continue;
            const pa = mapPoint(a);
            const pb = mapPoint(b);
            ctx.beginPath();
            ctx.moveTo(pa.x, pa.y);
            ctx.lineTo(pb.x, pb.y);
            ctx.stroke();
          }
        }
      }

      // Shorelines (every water body - ocean and every lake alike) and rivers, drawn as smoothed
      // curves through the same exact corner points the cell fill above uses.
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      this.#drawSmoothLoops(ctx, ecology.coastlines, lonLat, mapPoint, '#f4ecd8', 3.2, true);

      if (this.showRidges()) {
        this.#drawRidges(ctx, ecology.ridgePaths, ecology.ridgePathStrength, ecology.ridgePeaks, lonLat, mapPoint);
      }

      if (this.showRivers()) {
        this.#drawSmoothPaths(ctx, ecology.riverPaths, ecology.riverFlow, ecology.minNavigableFlow, lonLat, mapPoint);
      }

      if (this.showIcons()) {
        this.#drawIcons(ctx, graph, tectonics, ecology, lonLat, mapPoint);
      }

      this.#commitScratchCanvas(rasterWidth, rasterHeight);
    };

    this.#runChunked(
      token,
      graph.cells,
      RASTERIZE_CHUNK_SIZE,
      (cell) => {
        const n = cell.corners.length;
        if (n < 3) return;
        const lls = cell.corners.map(lonLat);
        const wraps = lls.some((ll, k) => Math.abs(ll.lon - lls[(k + 1) % n].lon) > Math.PI * 0.9);
        if (wraps) return;

        ctx.fillStyle = highlighted.has(cell.id)
          ? highlightColor
          : this.#resolveFillColor(cell.id, tectonics, ecology, profile.oceanSubstance, elevMin, elevMax);
        ctx.beginPath();
        const p0 = mapPoint(lls[0]);
        ctx.moveTo(p0.x, p0.y);
        for (let k = 1; k < n; k++) {
          const p = mapPoint(lls[k]);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fill();
      },
      onCellFillDone,
    );
  }

  /** Publishes a just-finished `scratchCanvas` draw to the live `offscreenCanvas`/`texture` in one
   * shot - the plane only ever shows either the previous complete frame or the new complete one,
   * never a just-cleared background or a partially cell-filled in-progress frame (the "black
   * flicker" a leaner in-place-clear version of `#rasterize()` used to show on every regenerate,
   * layer toggle, or zoom snap). `width`/`height` are `#rasterize()`'s already-computed raster
   * dimensions, passed through rather than re-read off `scratchCanvas` for clarity at the call
   * site.
   *
   * When the raster's *pixel dimensions* actually change, `this.texture` is replaced rather than
   * just marked `needsUpdate` - three.js only allocates GPU texture storage (`texStorage2D`) the
   * very first time a texture uploads; every later `needsUpdate` reuses that storage via
   * `texSubImage2D`. Growing the backing canvas after that first upload (which happens on almost
   * any non-1 `devicePixelRatio`, or on any zoom/resize-driven change) makes Chrome's canvas-upload
   * fast path try to copy more pixels than the allocated storage holds - `GL_INVALID_VALUE:
   * glCopySubTextureCHROMIUM: Offset overflows texture dimensions` - which fails the upload and
   * leaves the plane black. A fresh `CanvasTexture` forces fresh, correctly-sized GPU storage. */
  #commitScratchCanvas(width: number, height: number): void {
    const canvas = this.offscreenCanvas;
    const dimensionsChanged = canvas.width !== width || canvas.height !== height;
    if (dimensionsChanged) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // The scratch canvas is already exactly `width x height`, fully opaque (its own background
    // fill covers every pixel before anything else draws) - a 1:1 identity-transform copy fully
    // overwrites the previous frame, no separate clear needed. The identity reset matters even so:
    // this context's transform otherwise still carries the `rasterWidth/BASE_WIDTH` scale a
    // previous #rasterize() left on it (context state persists across calls on the same canvas).
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.scratchCanvas, 0, 0);

    if (dimensionsChanged) {
      this.texture.dispose();
      this.texture = new CanvasTexture(this.offscreenCanvas);
      this.texture.colorSpace = SRGBColorSpace;
      this.planeMaterial.map = this.texture;
      this.planeMaterial.needsUpdate = true;
    } else {
      this.texture.needsUpdate = true;
    }
  }

  /** Runs `draw` for every item in `items`, `chunkSize` at a time, yielding to
   * `requestAnimationFrame` between chunks instead of running the whole loop in one synchronous
   * pass - see `RASTERIZE_CHUNK_SIZE`. Bails on its next tick the moment `token` no longer matches
   * `this.rasterizeToken` (a newer `#rasterize()` call, or `ngOnDestroy`, superseded it) rather
   * than continuing to draw stale cells into a canvas that may have since been resized or torn
   * down. */
  #runChunked<T>(token: number, items: readonly T[], chunkSize: number, draw: (item: T) => void, onDone: () => void): void {
    let i = 0;
    const step = (): void => {
      if (token !== this.rasterizeToken) return;
      const end = Math.min(items.length, i + chunkSize);
      for (; i < end; i++) draw(items[i]);
      if (i < items.length) {
        requestAnimationFrame(step);
      } else {
        onDone();
      }
    };
    step();
  }

  #resolveFillColor(
    cellId: number,
    tectonics: IPlanetTectonics,
    ecology: IPlanetEcology,
    oceanSubstance: 'water' | 'lava',
    elevMin: number,
    elevMax: number,
  ): string {
    const feature = this.features.feature[cellId];
    const isLava =
      feature === 'lava_lake' || (oceanSubstance === 'lava' && ecology.waterBodyKind[cellId] === 'ocean');
    if (isLava) return lavaOceanColor();

    const mode = this.fillMode();
    if (mode === 'plates') return plateColor(tectonics.plateIdByCell[cellId]);
    if (mode === 'elevation') {
      return elevationColor(tectonics.elevation[cellId], tectonics.seaLevelElevation, elevMin, elevMax);
    }
    if (mode === 'temperature') return temperatureColor(ecology.temperature[cellId]);
    if (mode === 'moisture') return moistureColor(ecology.moisture[cellId]);
    if (mode === 'land') return tectonics.isLand[cellId] ? 'hsl(100, 40%, 38%)' : 'hsl(210, 60%, 22%)';
    return biomeColor(ecology.biome[cellId]);
  }

  /** Draws every loop in `loops` (coastlines: closed) as one or more smooth paths through the
   * real corner points - a quadratic curve through consecutive midpoints. A loop that crosses the
   * +/-180 seam is split into open runs by `splitAtSeam()` rather than dropped. */
  #drawSmoothLoops(
    ctx: CanvasRenderingContext2D,
    loops: IVec3[][],
    lonLat: (p: IVec3) => ILonLat,
    mapPoint: (ll: ILonLat) => { x: number; y: number },
    color: string,
    width: number,
    closed: boolean,
  ): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (const loop of loops) {
      if (loop.length < 3) continue;
      const lls = loop.map(lonLat);
      for (const run of splitAtSeam(lls, closed)) {
        this.#strokeSmoothRun(ctx, run.pts.map(mapPoint), run.closed);
      }
    }
  }

  #strokeSmoothRun(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], closed: boolean): void {
    const n = pts.length;
    if (n < 2) return;
    ctx.beginPath();
    const start = closed ? { x: (pts[0].x + pts[n - 1].x) / 2, y: (pts[0].y + pts[n - 1].y) / 2 } : pts[0];
    ctx.moveTo(start.x, start.y);
    const count = closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const cur = pts[i % n];
      const next = pts[(i + 1) % n];
      const mid = { x: (cur.x + next.x) / 2, y: (cur.y + next.y) / 2 };
      ctx.quadraticCurveTo(cur.x, cur.y, mid.x, mid.y);
    }
    if (!closed) ctx.lineTo(pts[n - 1].x, pts[n - 1].y);
    if (closed) ctx.closePath();
    ctx.stroke();
  }

  #drawSmoothPaths(
    ctx: CanvasRenderingContext2D,
    paths: IVec3[][],
    flow: number[][],
    minNavigableFlow: number,
    lonLat: (p: IVec3) => ILonLat,
    mapPoint: (ll: ILonLat) => { x: number; y: number },
  ): void {
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      if (path.length < 2) continue;
      const lls = path.map(lonLat);
      const flows = flow[i];
      const pts = lls.map(mapPoint);
      const n = pts.length;
      for (let k = 0; k < n - 1; k++) {
        if (Math.abs(lls[k].lon - lls[k + 1].lon) > SEAM_THRESHOLD) continue;
        const cur = pts[k];
        const next = pts[k + 1];
        const prevValid = k > 0 && Math.abs(lls[k - 1].lon - lls[k].lon) <= SEAM_THRESHOLD;
        const start = prevValid ? { x: (pts[k - 1].x + cur.x) / 2, y: (pts[k - 1].y + cur.y) / 2 } : cur;
        const nextValid = k < n - 2 && Math.abs(lls[k + 1].lon - lls[k + 2].lon) <= SEAM_THRESHOLD;
        const end = nextValid ? { x: (cur.x + next.x) / 2, y: (cur.y + next.y) / 2 } : next;
        const f = flows?.[k] ?? 0;
        ctx.strokeStyle = f >= minNavigableFlow ? '#2f8fd6' : '#8fd8ff';
        ctx.lineWidth = Math.min(9, 1.6 + Math.sqrt(f) * 1.3);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.quadraticCurveTo(cur.x, cur.y, end.x, end.y);
        ctx.stroke();
      }
    }
  }

  #drawRidges(
    ctx: CanvasRenderingContext2D,
    paths: IVec3[][],
    strengths: number[],
    peaks: IVec3[],
    lonLat: (p: IVec3) => ILonLat,
    mapPoint: (ll: ILonLat) => { x: number; y: number },
  ): void {
    ctx.strokeStyle = '#6b3f2a';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      if (path.length < 2) continue;
      const lls = path.map(lonLat);
      ctx.lineWidth = 2.1 + Math.min(1, strengths[i] ?? 0.5) * 2.2;
      for (const run of splitAtSeam(lls, false)) {
        this.#strokeSmoothRun(ctx, run.pts.map(mapPoint), false);
      }
    }

    ctx.fillStyle = '#4a2a1d';
    for (const peak of peaks) {
      const point = mapPoint(lonLat(peak));
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Scatters a bounded, deterministic number of glyphs (`iconBudget()`, independent of total
   * cell count) across land cells, jittered off-center for an organic look. A feature (volcano/
   * mesa/crater) always draws its own dedicated glyph on its site cell in addition to the sampled
   * biome scatter, so named landforms never depend on winning the random sample. */
  #drawIcons(
    ctx: CanvasRenderingContext2D,
    graph: IPlanetGraphCore,
    tectonics: IPlanetTectonics,
    ecology: IPlanetEcology,
    lonLat: (p: IVec3) => ILonLat,
    mapPoint: (ll: ILonLat) => { x: number; y: number },
  ): void {
    const rng = createSeededRandom((this.seed() + 5051) >>> 0);
    const landCellIds = graph.cells.map((c) => c.id).filter((id) => tectonics.isLand[id]);
    for (let i = landCellIds.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [landCellIds[i], landCellIds[j]] = [landCellIds[j], landCellIds[i]];
    }

    const iconSize = Math.max(10, Math.min(30, (BASE_WIDTH * BASE_HEIGHT) / Math.max(1, this.cellCount()) / 260));
    const drawAt = (cellId: number, drawer: IconDrawer, jitter: number): void => {
      const p = mapPoint(lonLat(graph.cells[cellId].center));
      const cellRng = createSeededRandom((this.seed() * 7919 + cellId * 104729) >>> 0);
      const ox = (cellRng() - 0.5) * iconSize * jitter;
      const oy = (cellRng() - 0.5) * iconSize * jitter;
      drawer(ctx, p.x + ox, p.y + oy, iconSize * (0.8 + cellRng() * 0.5), cellRng);
    };

    let placed = 0;
    const budget = this.iconBudget();
    for (const cellId of landCellIds) {
      if (placed >= budget) break;
      const drawer = BIOME_ICONS[ecology.biome[cellId]];
      if (!drawer) continue;
      const clusterSize = 1 + Math.floor(rng() * 2);
      for (let c = 0; c < clusterSize && placed < budget; c++) {
        drawAt(cellId, drawer, 1.6);
        placed++;
      }
    }

    for (const [cellId, instance] of this.features.featureByCellId) {
      const drawer = FEATURE_ICONS[instance.kind];
      if (drawer) drawAt(cellId, drawer, 0.3);
    }
  }
}
