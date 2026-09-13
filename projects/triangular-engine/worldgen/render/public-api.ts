/** Angular/Three.js rendering layer for `triangular-engine/worldgen`'s framework-free Voronoi
 * cell-graph planets (see docs/runbook/022 and 024). Kept as its own secondary entry point so
 * `worldgen/core` never gains a Three.js/Angular dependency — this package is the boundary
 * where a graph/tectonics/ecology gets turned into an actual scene-graph object. */
export * from './color-ramps';
export * from './world-size-tiers';
export * from './flow-path';
export * from './map-projections';
export * from './components/planet-view.component';
export * from './components/cell-planet-map.component';
export * from './components/cell-planet-map-units.component';
