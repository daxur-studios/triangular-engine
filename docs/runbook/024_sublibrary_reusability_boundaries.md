# 024 — Sublibrary Reusability Boundaries

## Status

- State: Standing convention, adopted
- Applies to: every sublibrary under `projects/triangular-engine/` (not one migration)
- Date: 2026-08-29

## Objective

State one rule so it stops needing to be re-derived per sublibrary: **a
sublibrary's core logic must stay free of any specific game's scale, content,
or authored data.** Concrete numbers (a planet's radius, a launch site's
coordinates, a world-size tier enum) belong at the boundary where a
*consuming app* wires the sublibrary up — never inside the sublibrary itself.
A sublibrary that only works at Bruno's Space Program's numbers isn't a
sublibrary, it's app code that happens to live in the engine package.

This was written while scoping [022](./022_v4_voronoi_cell_planets.md)'s
M4d (surface colliders), triggered by a direct question from the consuming
app about whether it's safe to thread BSP's planet-size tiers into
`worldgen`. It isn't specific to `worldgen` or V4 — it's recorded here,
separately, so it's discoverable from any sublibrary, not just buried in one
migration's dated changelog.

## The rule

- Core sublibrary logic operates in unit/dimensionless space (unit sphere,
  unitless elevation, normalized time, etc.) wherever the math allows it.
- A real-world scale (`radiusM`, a duration in seconds, a physical mass) is
  accepted as a plain parameter only at the sublibrary's outermost consuming
  boundary — the function that turns abstract output into a mesh, a
  collider, or a scene object. It is never assumed, defaulted from a game's
  concept of "world size," or looked up from another sublibrary's stock data.
- A sublibrary must not import another sublibrary's *stock content*
  (named bodies, presets, authored sites) to use as defaults. Importing a
  types/math utility is fine; importing `HOME_PLANET` is not.
- Tier/preset systems (e.g. "mini / small / medium / large" world-size
  enums) are consuming-app concepts. They may live in a sublibrary as an
  opt-in convenience layer, but the sublibrary's core must work correctly
  when called with a bare number instead.

## Evidence this isn't hypothetical

Two data points, one on each side, found while auditing for this rule:

- **Clean**: `worldgen/core` (`planet-graph.ts`, `sample-elevation.ts`,
  `chunking.ts`, etc.) has zero references to `radiusM`/`radius` anywhere in
  its core — confirmed by grep. It operates entirely on the unit sphere and
  unitless elevation. This is the pattern to keep.
- **Already violated**: `celestial/bodies/stock-bodies.ts`'s `HOME_PLANET`
  bakes BSP-specific authored content directly into the engine package —
  `HOME_PLANET_RADIUS_M = 600_000` picked for BSP's "low orbit reachable in
  a short flight" pacing, plus a fully authored launch site (lat/lon, pad
  and runway directions) and `HOME_BASE_COASTAL_ACCESS` shoreline data. None
  of that is reusable by another game; it's BSP content that happens to
  live in `triangular-engine/celestial`. Left as-is for now (out of scope
  for the V4 work that surfaced it) — flagged here so it isn't repeated, and
  so it has a place to point to if it's ever untangled.

## How this applies going forward

- `worldgen/core` stays dimensionless. `radiusM` gets threaded in only at
  mesh/collider-builder functions consuming its output, as a plain number —
  not as a `WorldSizeTier`, not by importing anything from `celestial`. See
  [022](./022_v4_voronoi_cell_planets.md) for the concrete M4c/M4d follow-up
  this produced.
- `world-size-presets.ts`'s tier system (`WorldSizeTier`,
  `WORLD_SIZE_TIER_RADIUS_M`, `createStockBodiesForTier()`) is a legitimate
  BSP-facing convenience layer over `celestial`, not a precedent to copy into
  other sublibraries — a new sublibrary should default to taking a bare
  `radiusM`, and only grow a tier/preset helper if a consuming app actually
  asks for one.
- The `/cell-planet-lab` demo page should get its own simple radius input
  independent of BSP's tier system, rather than importing BSP's tiers —
  keeps the lab honest about what the library itself requires to run.

## Non-goals

- Not proposing to fix `stock-bodies.ts`'s existing coupling right now — it
  works, nothing is broken, and untangling it is a separate, deliberate
  effort if it's ever done.
- Not proposing a lint rule or automated enforcement — this is a design
  convention for agents and humans to apply by judgment, recorded so it
  doesn't need re-deriving.
