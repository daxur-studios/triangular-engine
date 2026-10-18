import { Color } from 'three';
import {
  Fn,
  clamp,
  float,
  fract,
  fwidth,
  max,
  mix,
  select,
  sin,
  smoothstep,
  uniform,
} from 'three/tsl';
import type { IPlanetContext } from './planet-context';
import type { ISurfaceSample, SurfaceLayer } from './planet-surface-layers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A filtered square wave of period 2: `+1` over `[0, 1)`, `-1` over `[1, 2)`, and so on, clamped by its
 * screen-space width so a cell that falls below a pixel fades to grey instead of aliasing. The same filter the
 * atmosphere lab's grid uses (`BentPlanetLab.buildGrid`).
 *
 * `fwidth` is evaluated unconditionally here, which WGSL requires (derivatives in non-uniform control flow are
 * undefined): only call this from a graph that always runs it.
 */
export const filteredSquareWave = Fn(([t]: [any]) => {
  const width = max(fwidth(t), float(1e-4));
  return clamp(sin(t.mul(Math.PI)).div(width.mul(Math.PI)), -1, 1);
});

/** Checker parity in `cells` space: `0` on one colour, `1` on the other (each axis alternates every unit cell). Fwidth-filtered, so sub-pixel cells fade to grey. */
export const checkerParity = Fn(([cells]: [any]) =>
  float(0.5).sub(
    filteredSquareWave(cells.x).mul(filteredSquareWave(cells.y)).mul(0.5),
  ),
);

/** A graticule line on the integer boundaries of `cells`, `widthPx` pixels wide (screen-space, so it never thickens with distance). */
export const cellGridLine = Fn(([cells, widthPx]: [any, any]) => {
  const distance = fract(cells.add(0.5)).sub(0.5).abs();
  const pixels = distance.div(max(fwidth(cells), float(1e-6)));
  return float(1).sub(smoothstep(widthPx.mul(0.5), widthPx.mul(1.5), pixels));
});

/** The coordinate space the checker cells live in. */
export type CheckerDebugSpace = 'latLon' | 'uv';

export interface ICheckerDebugLayerOptions {
  /**
   * The space the cells live in. Fixed at construction: it changes the graph shape.
   * - `'latLon'` (default): latitude/longitude in radians. Cells stay welded to geography as the view morphs,
   *   but they narrow toward the poles, where longitude converges.
   * - `'uv'`: the map UV (0..1), matching the tile/atlas UVs.
   */
  readonly space?: CheckerDebugSpace;
  /**
   * Cell edge length in the space's units (radians for `'latLon'`, map UV for `'uv'`). Defaults to `pi/16`
   * (~11.25 degrees), or `1/16` for `'uv'`. Live.
   */
  readonly cellSize?: number;
  /** The lighter tone, linear RGB. Default a neutral light grey. */
  readonly lightColor?: string | Color;
  /** The darker tone, linear RGB. Default a dark grey. */
  readonly darkColor?: string | Color;
  /** 0..1 blend of the checker over the layer below (default 1: the checker replaces it). Live. */
  readonly strength?: number;
  /** Draw a thin line on the cell boundaries (a graticule). Default false. */
  readonly lines?: boolean;
  /** Boundary line colour, linear RGB. Default black. */
  readonly lineColor?: string | Color;
  /** Boundary line width in pixels (default 1). Live. */
  readonly lineWidthPx?: number;
  readonly enabled?: boolean;
}

export interface ICheckerDebugLayer {
  readonly layer: SurfaceLayer;
  /** The chosen space (fixed at construction). */
  readonly space: CheckerDebugSpace;
  /** 1 = on. Uniform nodes: change `.value`, nothing recompiles. */
  readonly enabled: any;
  readonly strength: any;
  readonly cellSize: any;
  readonly lightColor: any;
  readonly darkColor: any;
  /** Boundary line width node, or `null` when `lines` was left off. */
  readonly lineWidthPx: any | null;
}

function toColor(value: string | Color | undefined, fallback: string): Color {
  return value instanceof Color ? value : new Color(value ?? fallback);
}

/**
 * Debug surface layer: a filtered checkerboard over the planet, the reusable form of the atmosphere lab's
 * ground checker and grid. It only reads the planet context (`latLon` or `uv`), so it needs no vertex
 * attributes and stays within WebGPU's 8-buffer budget. Add it like any layer:
 *
 * ```ts
 * const checker = checkerDebugLayer({ space: 'latLon' });
 * material.addSurfaceLayer({ id: 'checkerDebug', order: SURFACE_LAYER_ORDER.game, layer: checker.layer });
 * checker.enabled.value = 0; // a live toggle: no recompile
 * ```
 *
 * The cells are anti-aliased with `fwidth` (each tone fades to the average when a cell is smaller than a
 * pixel), so — unlike a distance fade — it reads cleanly at every zoom on both backends.
 */
export function checkerDebugLayer(
  options: ICheckerDebugLayerOptions = {},
): ICheckerDebugLayer {
  const space = options.space ?? 'latLon';
  const cellSize: any = uniform(
    options.cellSize ?? (space === 'uv' ? 1 / 16 : Math.PI / 16),
  );
  const lightColor: any = uniform(toColor(options.lightColor, '#cccccc'));
  const darkColor: any = uniform(toColor(options.darkColor, '#262626'));
  const strength: any = uniform(options.strength ?? 1);
  const enabled: any = uniform(options.enabled === false ? 0 : 1);
  const lines = options.lines ?? false;
  const lineColor: any = uniform(toColor(options.lineColor, '#000000'));
  const lineWidthPx: any | null = lines
    ? uniform(options.lineWidthPx ?? 1)
    : null;

  const layer: SurfaceLayer = (
    context: IPlanetContext,
    below: ISurfaceSample,
  ) => {
    const coords: any = space === 'uv' ? context.uv : context.latLon;
    const cells = coords.div(cellSize);
    const toned = mix(darkColor, lightColor, checkerParity(cells));
    const checker = lineWidthPx
      ? mix(toned, lineColor, cellGridLine(cells, lineWidthPx))
      : toned;
    const shaded = mix(below.albedo, checker, strength);
    return {
      ...below,
      albedo: select(enabled.greaterThan(0.5), shaded, below.albedo),
    };
  };

  return {
    layer,
    space,
    enabled,
    strength,
    cellSize,
    lightColor,
    darkColor,
    lineWidthPx,
  };
}
