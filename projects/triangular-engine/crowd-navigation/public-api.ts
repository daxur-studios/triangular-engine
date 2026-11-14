/**
 * Worker-safe island crowd navigation core: a navigation grid built from a heightfield with Uint8
 * cost layers, a flag layer and a clearance field, plus a sector/portal abstraction with an abstract
 * path query, lazy per-sector flow fields with a cache (single and multi-source goals), a typed-array crowd simulation and
 * a `NavWorld` facade for incremental edits. No Angular or
 * three.js imports.
 */
export * from './core/nav-types';
export * from './core/nav-flags';
export * from './core/nav-clearance';
export * from './core/nav-grid';
export * from './core/island-heightfield';
export * from './core/nav-sectors';
export * from './core/nav-goals';
export * from './core/nav-flow';
export * from './core/nav-crowd';
export * from './core/nav-world';
