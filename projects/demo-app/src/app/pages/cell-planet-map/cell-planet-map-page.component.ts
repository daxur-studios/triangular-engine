import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
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
  IPlanetEcology,
  IPlanetFeatures,
  IPlanetGraphCore,
  IPlanetTectonics,
  IVec3,
  IWorldProfile,
  normalize,
  projectOnTangentPlane,
  scale,
  vec3,
  WORLD_PROFILES,
  WorldProfileKind,
} from 'triangular-engine/worldgen';
import { biomeColor, lavaOceanColor } from 'triangular-engine/worldgen/render';

/** Base render resolution the world is drawn at, once, on every regenerate — pan/zoom is a CSS
 * transform on this fixed bitmap afterward (see `onWheel()`/`onPointerMove()`), never a redraw
 * per frame. Wide enough that zooming in a few steps still reads crisp. */
const BASE_WIDTH = 3000;
const BASE_HEIGHT = 1500;

const MIN_ZOOM = 1;
const MAX_ZOOM = 14;

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

/** Uniform global temperature swing per season, additive on top of the world profile's own
 * `baseTemperatureOffset` and the climate-extremes slider. `summer` is 0 (today's baseline
 * generation, unchanged) since it's the default. This is deliberately *not* a hemisphere/axial-
 * tilt model — `computeClimate()`'s latitude term uses `abs(y)`, so north and south are already
 * symmetric; a real winter-in-one-hemisphere effect needs that changed in the library itself,
 * not just here. */
const SEASON_TEMPERATURE_OFFSET: Record<Season, number> = {
  summer: 0,
  spring: -0.12,
  autumn: -0.18,
  winter: -0.32,
};

/** Elevation-units-per-slider-unit for `waterLevel` — same order of magnitude as `noiseAmplitude`
 * (0.08) and the continental/oceanic base gap (0.85) in `elevation.ts`'s `DEFAULTS`, so the full
 * -1..1 range visibly drowns/exposes coastal terrain without swallowing whole continents. */
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

type ILonLat = { lon: number; lat: number };

/** Longitude jump between consecutive points bigger than this signals the antimeridian seam
 * (`atan2` wrapping from +π to −π), not a real edge on the sphere. */
const SEAM_THRESHOLD = Math.PI * 0.9;

/** One contiguous run produced by `splitAtSeam()`. `closed` is true only for the single-run,
 * no-cut-found case — every run produced by an actual split is open, since a shape cut at the
 * seam has no way to sensibly reconnect its ends. */
interface ISeamRun {
  pts: ILonLat[];
  closed: boolean;
}

/** Splits the internal edges of an already-linear (non-wrapping) point sequence into maximal
 * runs wherever a seam jump occurs — shared by both the open-path case and the rotated closed
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
 * runs — there's no way to "close" a shape that's been cut, so every returned run is open. */
function splitAtSeam(lls: ILonLat[], closed: boolean): ISeamRun[] {
  const n = lls.length;
  if (n < 2) return [{ pts: lls, closed }];

  if (!closed) {
    return splitLinearAtSeam(lls).map((pts) => ({ pts, closed: false }));
  }

  // Closed loop: find a seam edge to open the loop at, then reuse the linear splitter on the
  // rotated, now-linear sequence. Rotating so the loop starts right after that edge means the
  // one edge we deliberately don't draw (the cut we opened at) simply isn't part of the rotated
  // sequence's n-1 internal edges at all — so any *further* cuts found by the linear splitter
  // are genuinely additional crossings (common near poles, where longitude swings wildly),
  // never a false rejoin across the first one.
  const firstCut = lls.findIndex((p, k) => Math.abs(p.lon - lls[(k + 1) % n].lon) > SEAM_THRESHOLD);
  if (firstCut === -1) return [{ pts: lls, closed: true }];

  const start = (firstCut + 1) % n;
  const rotated = Array.from({ length: n }, (_, step) => lls[(start + step) % n]);
  return splitLinearAtSeam(rotated).map((pts) => ({ pts, closed: false }));
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

@Component({
  selector: 'app-cell-planet-map-page',
  imports: [RouterLink],
  templateUrl: './cell-planet-map-page.component.html',
  styleUrl: './cell-planet-map-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex-page' },
})
export class CellPlanetMapPageComponent implements AfterViewInit {
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('mapCanvas');
  private readonly viewportRef = viewChild<ElementRef<HTMLDivElement>>('viewport');

  readonly cellCount = signal(1500);
  readonly seed = signal(1);
  readonly worldProfileKind = signal<WorldProfileKind>('terran');
  readonly showIcons = signal(true);
  readonly showRivers = signal(true);
  readonly showCellEdges = signal(false);
  readonly iconBudget = signal(1400);
  readonly buildMs = signal('—');

  /** -1 (ice age) .. 1 (extreme heat/desertification) — a demo-page testing knob, not a world
   * profile setting. Restyles the existing terrain via `rebuildEcology()` rather than rerolling
   * a new map, so dragging this slider changes climate on the *same* planet. */
  readonly climateExtreme = signal(0);
  readonly season = signal<Season>('summer');
  readonly seasons: Season[] = ['winter', 'spring', 'summer', 'autumn'];

  /** -1 (seas fall) .. 1 (seas rise) — shifts the land/ocean threshold on the *same* fixed
   * elevation field via `deriveIsLand()`, same "restyle, don't reroll" pattern as
   * `climateExtreme`. Coastlines/rivers/biomes/features all re-derive from `tectonics.isLand`
   * once it's re-thresholded, via the normal `rebuildEcology()` path. */
  readonly waterLevel = signal(0);

  readonly zoom = signal(1);
  readonly panX = signal(0);
  readonly panY = signal(0);

  /** Sphere-space point (unit length) that projects to the center of the equirectangular map —
   * default `(1,0,0)` reproduces the original untranslated projection exactly. Double-clicking
   * the map recenters here via `onMapDoubleClick()`, so whatever region is currently distorted
   * near the poles/seam can be rotated into the low-distortion middle instead of redesigning the
   * projection itself. */
  readonly projectionCenter = signal<IVec3>({ x: 1, y: 0, z: 0 });

  readonly worldProfileKinds: WorldProfileKind[] = ['terran', 'moon', 'volcanic', 'protoplanet'];

  private graph: IPlanetGraphCore | null = null;
  private tectonics: IPlanetTectonics | null = null;
  private ecology: IPlanetEcology | null = null;
  /** `tectonics.seaLevelElevation` as generated, before any `waterLevel` shift — the fixed
   * baseline `rebuildEcology()` re-thresholds from each time, so repeated slider moves never
   * compound. */
  private baseSeaLevelElevation = 0;
  private features: IPlanetFeatures = { feature: [], instances: [], featureByCellId: new Map() };

  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  ngAfterViewInit(): void {
    this.regenerate();
  }

  regenerate(): void {
    const t0 = performance.now();
    const profile = WORLD_PROFILES[this.worldProfileKind()];

    const graph = buildPlanetGraphCore({
      cellCount: this.cellCount(),
      seed: this.seed(),
      relaxationIterations: 2,
      jitter: 0.35,
    });
    this.graph = graph;

    const tectonics = buildPlanetTectonics(graph, { plateCount: 14, seed: this.seed(), ...profile.tectonics });
    this.tectonics = tectonics;
    this.baseSeaLevelElevation = tectonics.seaLevelElevation;

    this.rebuildEcology();

    this.buildMs.set(`${(performance.now() - t0).toFixed(1)} ms`);
    this.resetView();
  }

  randomizeSeed(): void {
    this.seed.set(Math.floor(Math.random() * 1_000_000));
    this.regenerate();
  }

  onClimateExtremeInput(value: number): void {
    this.climateExtreme.set(value);
    this.rebuildEcology();
  }

  onSeasonChange(season: Season): void {
    this.season.set(season);
    this.rebuildEcology();
  }

  onWaterLevelInput(value: number): void {
    this.waterLevel.set(value);
    this.rebuildEcology();
  }

  /** Recomputes climate/biomes/rivers/features from the existing terrain (graph + tectonics)
   * without rebuilding plates/elevation — so the climate-extremes slider, season toggle, and
   * water-level slider all restyle the *same* map instead of rerolling a new one on every change.
   * `regenerate()` also routes through here after building fresh terrain. */
  private rebuildEcology(): void {
    const graph = this.graph;
    const tectonics = this.tectonics;
    if (!graph || !tectonics) return;

    const profile = WORLD_PROFILES[this.worldProfileKind()];

    const seaLevelElevation = this.baseSeaLevelElevation + this.waterLevel() * WATER_LEVEL_ELEVATION_SCALE;
    tectonics.seaLevelElevation = seaLevelElevation;
    tectonics.isLand = deriveIsLand(
      graph,
      tectonics.elevation,
      seaLevelElevation,
      profile.tectonics?.minRegionCellFraction,
    );

    const ecology = buildPlanetEcology(graph, tectonics, {
      climate: { ...profile.climate, baseTemperatureOffset: this.effectiveTemperatureOffset(profile) },
      biomes: profile.biomes,
    });
    this.ecology = ecology;
    this.features = computeFeatures(graph, tectonics, ecology.waterBodyKind, profile.features);
    this.draw();
  }

  /** Sums the world profile's own offset (a world-type knob, e.g. Moon's cold baseline) with the
   * climate-extremes slider and the season toggle. */
  private effectiveTemperatureOffset(profile: IWorldProfile): number {
    const base = profile.climate.baseTemperatureOffset ?? 0;
    return base + this.climateExtreme() * 0.8 + SEASON_TEMPERATURE_OFFSET[this.season()];
  }

  resetView(): void {
    this.zoom.set(1);
    this.panX.set(0);
    this.panY.set(0);
  }

  onIconsToggle(): void {
    this.showIcons.update((v) => !v);
    this.draw();
  }

  onRiversToggle(): void {
    this.showRivers.update((v) => !v);
    this.draw();
  }

  onEdgesToggle(): void {
    this.showCellEdges.update((v) => !v);
    this.draw();
  }

  onIconDensityInput(value: number): void {
    this.iconBudget.set(value);
    this.draw();
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const viewport = this.viewportRef()?.nativeElement;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;

    const oldZoom = this.zoom();
    const factor = Math.exp(-event.deltaY * 0.0015);
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom * factor));
    if (newZoom === oldZoom) return;

    // Keep the point under the cursor stationary: solve for the new pan that maps the same
    // world-space point (under the cursor, at the old zoom/pan) to the same screen position at
    // the new zoom.
    const worldX = (cursorX - this.panX()) / oldZoom;
    const worldY = (cursorY - this.panY()) / oldZoom;
    this.panX.set(cursorX - worldX * newZoom);
    this.panY.set(cursorY - worldY * newZoom);
    this.zoom.set(newZoom);
  }

  onPointerDown(event: PointerEvent): void {
    this.dragging = true;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.dragging) return;
    const dx = event.clientX - this.lastPointerX;
    const dy = event.clientY - this.lastPointerY;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.panX.update((v) => v + dx);
    this.panY.update((v) => v + dy);
  }

  onPointerUp(): void {
    this.dragging = false;
  }

  /** Rotates the clicked map point to the projection center (see `projectionCenter`), so the
   * area under the cursor moves to the low-distortion middle of the equirectangular map instead
   * of wherever it happened to land. Inverts the same pixel -> lon/lat -> sphere-point chain
   * `draw()`'s `lonLat`/`mapPoint` use, then un-rotates through the *current* basis to recover
   * the true sphere-space point before storing it as the new center. */
  onMapDoubleClick(event: MouseEvent): void {
    const viewport = this.viewportRef()?.nativeElement;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const cssX = (event.clientX - rect.left - this.panX()) / this.zoom();
    const cssY = (event.clientY - rect.top - this.panY()) / this.zoom();
    if (cssX < 0 || cssX > viewport.clientWidth || cssY < 0 || cssY > viewport.clientHeight) return;

    // The canvas backing store is BASE_WIDTH x BASE_HEIGHT, but its CSS box is stretched to fill
    // the viewport (`.scss`'s `canvas { width: 100%; height: 100% }`) *before* the pan/zoom
    // transform applies — cssX/cssY above are in that stretched CSS-pixel space, not
    // BASE_WIDTH/BASE_HEIGHT space, so they need converting before the lon/lat math below, which
    // assumes canvas-native pixels. Skipping this was the earlier bug: on any viewport narrower
    // than BASE_WIDTH (always, in practice), it made every click resolve to a near-constant lon
    // regardless of where you actually clicked.
    const canvasX = (cssX / viewport.clientWidth) * BASE_WIDTH;
    const canvasY = (cssY / viewport.clientHeight) * BASE_HEIGHT;

    const lon = ((canvasX / BASE_WIDTH) * 2 - 1) * Math.PI;
    const lat = (1 - (2 * canvasY) / BASE_HEIGHT) * (Math.PI / 2);
    const local = vec3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));

    const { forward, up, right } = this.projectionBasis();
    const clicked = add(add(scale(forward, local.x), scale(up, local.y)), scale(right, local.z));
    this.projectionCenter.set(normalize(clicked));
    this.draw();
  }

  resetProjectionCenter(): void {
    this.projectionCenter.set({ x: 1, y: 0, z: 0 });
    this.draw();
  }

  /** Orthonormal basis rotating `projectionCenter` to local +X (map center). `forward` becomes
   * the new lon=0/lat=0 axis, `up` the new pole axis (world +Y projected onto the tangent plane
   * at `forward`, so "north" stays "up" on the map except right at the projection's own poles),
   * `right` the new lon=+90° axis. At the default center `(1,0,0)` this reduces to the original
   * unrotated `{forward:(1,0,0), up:(0,1,0), right:(0,0,1)}` exactly. */
  private projectionBasis(): { forward: IVec3; up: IVec3; right: IVec3 } {
    const forward = normalize(this.projectionCenter());
    const worldUp = Math.abs(forward.y) > 0.999 ? vec3(0, 0, 1) : vec3(0, 1, 0);
    const up = normalize(projectOnTangentPlane(worldUp, forward));
    const right = cross(forward, up);
    return { forward, up, right };
  }

  /** One full redraw of the fixed `BASE_WIDTH x BASE_HEIGHT` bitmap — pan/zoom afterward is a
   * CSS transform on this canvas, never a re-render, so this only runs on regenerate or a
   * layer toggle, not per frame/per pan tick. Public: the icon-density slider's template
   * binding calls this directly (see `onIconDensityInput()`). */
  draw(): void {
    const graph = this.graph;
    const tectonics = this.tectonics;
    const ecology = this.ecology;
    const canvas = this.canvasRef()?.nativeElement;
    if (!graph || !tectonics || !ecology || !canvas) return;

    canvas.width = BASE_WIDTH;
    canvas.height = BASE_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#141d2e';
    ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

    const { forward, up, right } = this.projectionBasis();
    const lonLat = (p: IVec3): { lon: number; lat: number } => ({
      lon: Math.atan2(dot(p, right), dot(p, forward)),
      lat: Math.asin(Math.max(-1, Math.min(1, dot(p, up)))),
    });
    const mapPoint = (ll: { lon: number; lat: number }): { x: number; y: number } => ({
      x: ((ll.lon / Math.PI) * 0.5 + 0.5) * BASE_WIDTH,
      y: (1 - ((ll.lat / (Math.PI / 2)) * 0.5 + 0.5)) * BASE_HEIGHT,
    });

    const profile = WORLD_PROFILES[this.worldProfileKind()];

    // Cell fill.
    for (const cell of graph.cells) {
      const n = cell.corners.length;
      if (n < 3) continue;
      const lls = cell.corners.map(lonLat);
      const wraps = lls.some((ll, k) => Math.abs(ll.lon - lls[(k + 1) % n].lon) > Math.PI * 0.9);
      if (wraps) continue;

      ctx.fillStyle = this.resolveFillColor(cell.id, profile.oceanSubstance);
      ctx.beginPath();
      const p0 = mapPoint(lls[0]);
      ctx.moveTo(p0.x, p0.y);
      for (let k = 1; k < n; k++) {
        const p = mapPoint(lls[k]);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fill();
    }

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

    // Shorelines (every water body — ocean and every lake alike, `extractCoastlines()` doesn't
    // distinguish) and rivers, drawn as smoothed curves through the same exact corner points
    // the cell fill above uses — never resampled or simplified, so this is real per-edge
    // resolution, just rendered as a curve instead of a straight polyline. Decoupled entirely
    // from cell count: this is why it can look crisp regardless of how coarse the fill grid is.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    this.drawSmoothLoops(ctx, ecology.coastlines, lonLat, mapPoint, '#f4ecd8', 3.2, true);

    if (this.showRivers()) {
      this.drawSmoothPaths(
        ctx,
        ecology.riverPaths,
        ecology.riverFlow,
        ecology.minNavigableFlow,
        lonLat,
        mapPoint,
      );
    }

    if (this.showIcons()) {
      this.drawIcons(ctx, graph, tectonics, ecology, lonLat, mapPoint);
    }
  }

  private resolveFillColor(cellId: number, oceanSubstance: 'water' | 'lava'): string {
    const ecology = this.ecology!;
    const feature = this.features.feature[cellId];
    const isLava =
      feature === 'lava_lake' || (oceanSubstance === 'lava' && ecology.waterBodyKind[cellId] === 'ocean');
    if (isLava) return lavaOceanColor();
    return biomeColor(ecology.biome[cellId]);
  }

  /** Draws every loop in `loops` (coastlines: closed) as one or more smooth paths through the
   * *real* corner points — a quadratic curve through consecutive midpoints, the standard trick
   * for turning a polyline into a smooth curve that still passes near every real vertex,
   * without discarding or resampling any of them. A loop that crosses the ±180° seam is split
   * into open runs by `splitAtSeam()` rather than dropped, so continents that happen to straddle
   * the antimeridian still get their outline drawn (just as separate segments). */
  private drawSmoothLoops(
    ctx: CanvasRenderingContext2D,
    loops: IVec3[][],
    lonLat: (p: IVec3) => { lon: number; lat: number },
    mapPoint: (ll: { lon: number; lat: number }) => { x: number; y: number },
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
        this.strokeSmoothRun(ctx, run.pts.map(mapPoint), run.closed);
      }
    }
  }

  /** Strokes a single open (or, if `closed`, wrap-around-drawn) smooth run — the shared
   * quadratic-curve-through-midpoints body used by both coastlines/lakes and, per-run, rivers. */
  private strokeSmoothRun(
    ctx: CanvasRenderingContext2D,
    pts: { x: number; y: number }[],
    closed: boolean,
  ): void {
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

  /** Curves each river edge through a quadratic bulging toward its real start corner (`cur`),
   * same family of trick as `strokeSmoothRun` — but stroked one edge at a time, each with its
   * own width from `flow[k]`, since a river's width has to vary along its length and a single
   * `stroke()` call can't carry more than one `lineWidth`. Each edge's curve starts/ends at the
   * midpoint shared with its neighbor (so adjacent edges join with matching endpoints, just
   * different widths/curvature either side), except at the two ends of the path and on either
   * side of a seam cut, where it lands on the real point instead since there's no neighbor to
   * share a midpoint with. Every segment except the ones crossing the seam is drawn directly by
   * original index — simpler and index-safe than reusing splitAtSeam()'s generic run output
   * here, since that drops the cut segment and would otherwise desync the flow-array lookup.
   *
   * Segments at/above `minNavigableFlow` (`IPlanetRivers.minNavigableFlow` — see the runbook
   * 022 "River hydrology rework" entry and `rivers.ts`'s doc comment) stroke in a deeper,
   * more saturated blue than the spring/creek color below it, so the boat-navigable/spring
   * distinction reads directly off the map instead of needing a separate mode or legend. */
  private drawSmoothPaths(
    ctx: CanvasRenderingContext2D,
    paths: IVec3[][],
    flow: number[][],
    minNavigableFlow: number,
    lonLat: (p: IVec3) => { lon: number; lat: number },
    mapPoint: (ll: { lon: number; lat: number }) => { x: number; y: number },
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

  /** Scatters a bounded, deterministic number of glyphs (`iconBudget()`, independent of total
   * cell count — the same "cost doesn't scale with cell density" discipline as the rest of
   * this codebase's per-cell detail work) across land cells, jittered off-center for an organic
   * look instead of one glyph dead-center per cell. A feature (volcano/mesa/crater) always
   * draws its own dedicated glyph on its site cell in addition to the sampled biome scatter, so
   * named landforms never depend on winning the random sample. */
  private drawIcons(
    ctx: CanvasRenderingContext2D,
    graph: IPlanetGraphCore,
    tectonics: IPlanetTectonics,
    ecology: IPlanetEcology,
    lonLat: (p: IVec3) => { lon: number; lat: number },
    mapPoint: (ll: { lon: number; lat: number }) => { x: number; y: number },
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
