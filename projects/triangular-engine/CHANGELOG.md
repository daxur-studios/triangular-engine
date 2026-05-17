# Changelog

All notable changes to triangular-engine are documented here.

## [0.0.14] - 2026-05-16

### Added

- `planeGeometry` `[orientation]` input: `vertical` (default), `horizontal`, `billboard` (no geom rotation; pair with `<billboard>`)

### Fixed

- `planeGeometry` `[horizontal]` no longer rotates every plane on every effect run (only when orientation is `horizontal`)

### Deprecated

- `planeGeometry` `[horizontal]` — use `[orientation]="'horizontal'"`

## [0.0.13] - 2026-05-16

### Added

- Optional `triangular-engine/pmndrs` entry point with `billboard` and `sparkles` components wrapping `@pmndrs/vanilla`
- `PmndrsModule` for batch imports

## [0.0.12] - 2025-03-07

### Added

- feat: add triangular-engine skill definition with installation, core patterns, and component reference
- npm package updates & angular minor version updates

```
    "three": "0.183.2",
    "three-mesh-bvh": "^0.9.9",
```

## [0.0.11] - 2025-03-07

Initial changelog. See git history for changes prior to this version.
