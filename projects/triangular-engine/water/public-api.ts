/*
 * Public API Surface of triangular-engine/water
 *
 * Phase 0: the framework-free WaterSurface model only. Angular components
 * (water-ocean, water-lake, WaterService, the underwater effect) land in
 * later phases — see docs/runbook/002_water_sublibrary.md in this workspace.
 */
export * from './core/water-surface';
export * from './core/wave-presets';
export * from './core/gerstner-glsl';
export * from './core/water-lod-grid';
export * from './core/water-lod-glsl';
export * from './core/water-lod-patch-geometry';
