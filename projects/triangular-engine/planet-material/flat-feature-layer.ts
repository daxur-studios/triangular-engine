import { Color, type DataTexture } from 'three';
import { clamp, dFdx, dFdy, dot, float, floor, fract, length, max, min, mix, normalize, select, smoothstep, texture, uniform, vec2, vec3 } from 'three/tsl';
import type { IPlanetContext } from './planet-context';
import type { ISurfaceSample, SurfaceLayer } from './planet-surface-layers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * What the layer reads from `FlatFeaturePageWindow` (`triangular-engine/worldgen/render/core`), structurally, so
 * this entry point does not import worldgen. Pass the real object: `flatFeatureLayer(window)`.
 */
export interface IFlatFeatureGpu {
  /** `capacity × 3` RGBA float texels: per feature `along.xyz, halfLength`, `across.xyz, halfWidth`, `shape, markings, priority, surface`. */
  readonly featureTexture: DataTexture;
  /** `windowPages² × maxPerPage/4` RGBA float texels: per window page, `featureIndex + 1` per slot (0 = empty). */
  readonly pageTexture: DataTexture;
  readonly windowPages: number;
  readonly maxPerPage: number;
  readonly capacity: number;
  /** Page grid at the current level, and the grid page at window (0, 0). Read every frame. */
  readonly columns: number;
  readonly rows: number;
  readonly originX: number;
  readonly originY: number;
  /** Datum radius in metres. */
  readonly radiusM: number;
  /** 0 draws nothing (no features, or the window not placed yet). */
  readonly enabled: number;
}

/** Colours of {@link flatFeatureLayer}; each becomes a live uniform. */
export interface IFlatFeatureLayerOptions {
  readonly asphalt?: string | Color;
  readonly concrete?: string | Color;
  /** White paint (runway and road markings). */
  readonly paint?: string | Color;
  /** Yellow paint (taxiway centreline). */
  readonly taxiwayPaint?: string | Color;
}

/** The layer and its live uniforms. */
export interface IFlatFeatureLayer {
  readonly layer: SurfaceLayer;
  /** 1 = drawn (default). Multiplied with the window's own `enabled`. */
  readonly enabled: any;
  readonly asphalt: any;
  readonly concrete: any;
  readonly paint: any;
  readonly taxiwayPaint: any;
}

/** Coverage of a line of half width `halfWidth` at signed distance `distance`, filtered by the pixel footprint `px`. */
const lineCoverage = (distance: any, halfWidth: any, px: any): any => clamp(halfWidth.sub(distance.abs()).div(px).add(0.5), 0, 1);

/** Coverage of the `[0, duty)` part of each `period`-metre cycle of `t`, filtered by `px`. */
const dashCoverage = (t: any, period: number, duty: number, px: any): any => {
  const phase = fract(t.div(period));
  const p = px.div(period);
  return clamp(float(duty).sub(phase).div(p).add(0.5), 0, 1).mul(clamp(phase.div(p).add(0.5), 0, 1));
};

/** 1 while a marking `width` metres wide is resolved, fading to 0 as the pixel footprint outgrows it. */
const fade = (width: number, px: any): any => float(1).sub(smoothstep(width * 0.6, width * 3.5, px));

/**
 * Surface layer: draws flat features (runways, aprons, roads, taxiways) analytically, sharp at any distance. Each
 * pixel finds its page in the window, walks that page's short feature list (`maxPerPage` slots, unrolled) and
 * evaluates each feature's SDF in metres. The surface is the union of the features; the markings are those of the
 * winning feature: the highest priority one the pixel is inside, or else the nearest.
 *
 * Every texture read is an explicit level-0 fetch, because which page and feature a pixel reads differs per pixel
 * (WGSL has no implicit derivatives in non-uniform control flow). Empty slots and pixels outside the window still
 * read, then are masked with `select`, so no fetch sits under control flow. The pixel footprint comes from
 * unconditional `dFdx`/`dFdy` of the surface position.
 *
 * Geometry: features are great-circle segments and tangent-frame rectangles in body-fixed coordinates, evaluated on
 * `radialDirection × radiusM`, so the paint stays welded to geography at every terrain LOD and as the view morphs.
 * On Earth-sized planets the float32 surface position limits sub-metre markings (about 0.5 m steps).
 */
export function flatFeatureLayer(gpu: IFlatFeatureGpu, options: IFlatFeatureLayerOptions = {}): IFlatFeatureLayer {
  // Defaults are linear RGB (the spike's tuned values); strings are CSS colours (sRGB).
  const colour = (value: string | Color | undefined, fallback: [number, number, number]) =>
    uniform(value instanceof Color ? value : value !== undefined ? new Color(value) : new Color().setRGB(...fallback));
  const enabled: any = uniform(1);
  const asphalt: any = colour(options.asphalt, [0.045, 0.045, 0.05]);
  const concrete: any = colour(options.concrete, [0.3, 0.29, 0.27]);
  const paint: any = colour(options.paint, [0.62, 0.62, 0.58]);
  const taxiwayPaint: any = colour(options.taxiwayPaint, [0.6, 0.42, 0.05]);

  const mirror = (read: () => number): any => {
    const node: any = uniform(read());
    node.onFrameUpdate(() => {
      node.value = read();
    });
    return node;
  };
  const columns = mirror(() => gpu.columns);
  const rows = mirror(() => gpu.rows);
  const originX = mirror(() => gpu.originX);
  const originY = mirror(() => gpu.originY);
  const radiusM = mirror(() => gpu.radiusM);
  const gpuEnabled = mirror(() => gpu.enabled);

  const W = gpu.windowPages;
  const pageWidth = W * W;
  const pageRows = gpu.maxPerPage / 4;
  const capacity = gpu.capacity;

  const layer: SurfaceLayer = (context: IPlanetContext, below: ISurfaceSample) => {
    const dir = normalize(context.radialDirection);
    const position = dir.mul(radiusM);
    const px = max(max(length(dFdx(position)), length(dFdy(position))), float(0.01));

    // Page of the pixel, in the window. Columns wrap at the antimeridian.
    const lat = context.latLon.x;
    const lon = context.latLon.y;
    const gx = min(floor(lon.add(Math.PI).div(2 * Math.PI).mul(columns)), columns.sub(1));
    const gy = min(floor(lat.add(Math.PI / 2).div(Math.PI).mul(rows)), rows.sub(1));
    const dx = gx.sub(originX);
    const wx = select(dx.lessThan(0), dx.add(columns), dx);
    const wy = gy.sub(originY);
    const inWindow = wx.lessThan(W).and(wy.greaterThanEqual(0)).and(wy.lessThan(W)).and(gpuEnabled.greaterThan(0.5));
    const column = clamp(wy.mul(W).add(wx), 0, pageWidth - 1);
    const pageU = column.add(0.5).div(pageWidth);

    let bestKey: any = float(1e9);
    let bestD: any = float(1e9);
    let bestA: any = float(0);
    let bestB: any = float(0);
    let bestHL: any = float(1);
    let bestHW: any = float(1);
    let bestMarkings: any = float(0);
    let bestSurface: any = float(0);
    let body: any = float(0);

    for (let row = 0; row < pageRows; row += 1) {
      const entries = texture(gpu.pageTexture, vec2(pageU, (row + 0.5) / pageRows)).level(float(0));
      for (const component of ['x', 'y', 'z', 'w'] as const) {
        const entry = entries[component];
        const valid = inWindow.and(entry.greaterThan(0.5));
        const featureU = max(entry.sub(1), 0).add(0.5).div(capacity);
        const t0 = texture(gpu.featureTexture, vec2(featureU, 0.5 / 3)).level(float(0));
        const t1 = texture(gpu.featureTexture, vec2(featureU, 1.5 / 3)).level(float(0));
        const t2 = texture(gpu.featureTexture, vec2(featureU, 2.5 / 3)).level(float(0));
        const a: any = dot(dir, t0.xyz).mul(radiusM);
        const b: any = dot(dir, t1.xyz).mul(radiusM);
        const halfL = t0.w;
        const halfW = t1.w;
        const qx: any = a.abs().sub(halfL);
        const qy: any = b.abs().sub(halfW);
        const boxD = length(max(vec2(qx, qy), 0)).add(min(max(qx, qy), 0));
        const capsuleD = length(vec2(max(qx, 0), b)).sub(halfW);
        const d: any = select(valid, select(t2.x.greaterThan(0.5), capsuleD, boxD), float(1e9));
        // Past one pixel the strip is narrower than the footprint: spread it over the footprint at the right weight.
        const coverage = clamp(float(0.5).sub(d.div(px)), 0, 1).mul(min(float(1), halfW.mul(2).div(px)));
        body = max(body, coverage);
        // Inside: the highest priority wins, then the deepest. Outside: the nearest.
        const key = select(d.lessThan(0), d.sub(t2.z.mul(1e6)), d);
        const better = key.lessThan(bestKey);
        bestKey = select(better, key, bestKey);
        bestD = select(better, d, bestD);
        bestA = select(better, a, bestA);
        bestB = select(better, b, bestB);
        bestHL = select(better, halfL, bestHL);
        bestHW = select(better, halfW, bestHW);
        bestMarkings = select(better, t2.y, bestMarkings);
        bestSurface = select(better, t2.w, bestSurface);
      }
    }

    // Markings of the winning feature, each fading as the pixel footprint outgrows it.
    const a = bestA;
    const b = bestB;
    const inside = clamp(float(0.5).sub(bestD.div(px)), 0, 1);
    const isRunway = bestMarkings.sub(1).abs().lessThan(0.5);
    const isTaxiway = bestMarkings.sub(2).abs().lessThan(0.5);
    const isRoad = bestMarkings.sub(3).abs().lessThan(0.5);
    const withinLength = clamp(float(0.5).sub(a.abs().sub(bestHL).div(px)), 0, 1);

    // Runway: 30 m dashes every 50 m on the centreline, edge lines 1.5 m in, threshold bars at both ends.
    const runwayCentre = lineCoverage(b, float(0.45), px).mul(dashCoverage(a, 50, 0.6, px)).mul(fade(0.9, px));
    const runwayEdge = lineCoverage(b.abs().sub(bestHW.sub(1.5)), float(0.3), px).mul(fade(0.6, px)).mul(withinLength);
    const fromEnd = bestHL.sub(a.abs());
    const bars = lineCoverage(fromEnd.sub(21), float(15), px)
      .mul(lineCoverage(fract(b.div(5)).sub(0.5).mul(5), float(0.9), px))
      .mul(fade(1.8, px))
      .mul(clamp(float(0.5).sub(b.abs().sub(bestHW.sub(2.5)).div(px)), 0, 1));
    const runway = max(max(runwayCentre, runwayEdge), bars);
    // Taxiway: a continuous yellow centreline.
    const taxiway = lineCoverage(b, float(0.15), px).mul(fade(0.3, px));
    // Road: 3 m dashes every 12 m on the centreline, solid edge lines 0.4 m in.
    const roadCentre = lineCoverage(b, float(0.08), px).mul(dashCoverage(a, 12, 0.25, px));
    const roadEdge = lineCoverage(b.abs().sub(bestHW.sub(0.4)), float(0.08), px);
    const road = max(roadCentre, roadEdge).mul(fade(0.16, px));

    const marks = select(isRunway, runway, select(isTaxiway, taxiway, select(isRoad, road, float(0)))).mul(inside);
    const surface = mix(vec3(asphalt), vec3(concrete), bestSurface);
    const ink = mix(vec3(paint), vec3(taxiwayPaint), select(isTaxiway, float(1), float(0)));
    const featureAlbedo = mix(surface, ink, marks);
    const weight = body.mul(enabled);
    return {
      ...below,
      albedo: mix(below.albedo, featureAlbedo, weight),
      roughness: mix(below.roughness, float(0.85), weight),
      metalness: mix(below.metalness, float(0), weight),
    };
  };

  return { layer, enabled, asphalt, concrete, paint, taxiwayPaint };
}
