# 025 — Context helper: driving cloud placement from planet climate data

## Status

- State: **Not started — this is a context/orientation doc for the next session**, written
  2026-08-29 at Bruno's request ("focus on that cloud POC and make better use of the cell
  planet data... where clouds should spawn/rain"). Nothing below is implemented. It exists so a
  fresh session doesn't have to re-derive the two systems' current shape before starting.
- Depends on: [022_v4_voronoi_cell_planets.md](022_v4_voronoi_cell_planets.md) (planet data
  source), [023_mesh_puff_clouds.md](023_mesh_puff_clouds.md) (cloud renderer), the new
  `triangular-engine/worldgen/render` entry point (`<planetView>`, not yet documented in 022 —
  see [`worldgen/README.md`](../../projects/triangular-engine/worldgen/README.md) for its API).

## The gap, precisely

`/cloud-puffs-lab`'s `sphere-shell` domain now renders a real `<planetView>` planet (wired
2026-08-29, proving `worldgen/render` is reusable outside `/cell-planet-lab` — see the README
above) — but the **cloud placement has zero awareness of it**. Read
`cloud-puffs-lab-page.component.ts`/`.html`: the planet and the cloud cluster are two unrelated
siblings in the same `<scene>`. `buildCloudPuffCluster()`'s `sphere-shell` domain
(`sphere-shell-domain.ts`) places puffs by uniform-random angle within an altitude band —
`placeInstances()` never receives or consults any per-direction climate value. `ecology.moisture`
and `ecology.temperature` (see the README's Generation pipeline section) exist, are already
computed by the planet the clouds are floating above, and are currently unused for anything
except the lab's own 2D map / vertex-color debug views.

So "make better use of the cell planet data... where clouds should spawn/rain" is a real,
unstarted integration — not a bug fix and not blocked on anything. Both sides already expose
what's needed; they just aren't wired together.

## What each side already exposes (as of this doc)

**From the planet** (`<planetView>` public signals, detailed in the README):
- `planet.ecology()?.moisture: number[]` — per-cell, 1 (ocean) decaying inland, minus a latitude
  arid-belt term. This is the natural cloud-density driver.
- `planet.ecology()?.temperature: number[]` — per-cell, hot equator to frozen poles minus
  elevation lapse. Natural driver for cloud *type* (thin cirrus-ish at cold/high vs. dense
  cumulus at warm/humid) and for whether precipitation should be rain vs. snow.
- `planet.ecology()?.biome: Biome[]` — already encodes a temperature×moisture lookup (see
  Whittaker table in 022 §Architecture step 8) — may be a cheaper single signal to start from
  than combining temperature+moisture by hand.
- `planet.tectonics()?.isLand` / `ecology()?.waterBodyKind` — evaporation source (ocean/lake
  cells) if a more physical "clouds form over water, drift over land" model is wanted later.
- `findCellNear(graph, direction, hintCellId)` (from `triangular-engine/worldgen`) — the O(1)-ish
  lookup a per-puff or per-frame query needs; see README's "Querying a direction" section for why
  the hint-seeded version, not `findCellAt`, is the one to use here.

**From the cloud system** (`triangular-engine/clouds`, see 023's Architecture tree):
- `ICloudPuffDomain.placeInstances(context: ICloudPuffDomainContext) -> ICloudPuffTransform[]` —
  the pluggable placement hook. `ICloudPuffDomainContext` (`cloud-puff-domain.ts`) currently
  carries only geometry params (`radiusM`, `regionSizeM`, etc.) — **no density/weight input
  exists yet**. This is the extension point to add one to.
- `sphere-shell-domain.ts` — the concrete domain in use on `/cloud-puffs-lab`'s planet view;
  today it samples a placement direction uniformly at random with no rejection/weighting step.
- `ICloudPuffDomainWindController.advanceWind(...)` — already receives `simulationTimeSeconds`
  and could later drive cloud *movement* toward/away from moisture sources, but that's a bigger
  step than placement — see Suggested scope below.
- Nothing in `clouds` currently imports anything from `worldgen` — this integration is new
  coupling between two previously-independent sublibraries, both already registered in
  `tsconfig.json`/`angular.json`, so no build plumbing is missing, just the actual code.

## Suggested scope for a first pass (not decided — a starting proposal, revisit before building)

Smallest useful step, in the same "pure function first, lab proof second" style every M4
sub-milestone in 022 used:

1. **Add an optional density-weight callback to `ICloudPuffDomainContext`**, e.g.
   `densityAt?: (direction: IVec3) => number` (0..1). Leave every existing domain's behavior
   unchanged when it's absent (`undefined` ⇒ current uniform placement) — this keeps `box` and
   `cylinder-interior` domains, which have no planet under them, working exactly as today.
2. **`sphere-shell-domain.ts`: consult `densityAt` if present** — simplest correct approach is
   rejection sampling (pick a uniform-random direction, keep it with probability
   `densityAt(direction)`, else resample) rather than reshaping the distribution analytically;
   cheap, and starts producing visibly clustered-over-humid-regions cloud cover with a small
   diff.
3. **`cloud-puffs-lab-page.component.ts`: build the callback from the live `<planetView>`**,
   something like `direction => planet.ecology()?.moisture[findCellNear(planet.graph()!, direction, lastHintId).id] ?? 0.5`,
   threaded into `buildCloudPuffCluster()`'s options alongside the existing `domainId`/`styleId`
   ones. This is the "lab proof" — a toggle to turn moisture-weighting on/off, same pattern as
   every other lab control on that page.
4. **Rain is a separate, later step** — nothing in `clouds` or `worldgen` has a precipitation
   concept yet. A first cut could be purely visual (denser/darker puffs where moisture is high,
   using the existing `ICloudPuffMaterialOptions`/style system — no new mechanic) before
   attempting an actual rain-particle or ground-wetness system. Don't scope that into the same
   pass as placement-by-moisture; keep the "bite-sized, provable" discipline 022's M4 milestones
   used.

## Explicitly not scoped by this doc

- No decision on whether density-weighting belongs in the domain layer (proposed above) vs. a
  wrapper around `placeInstances` vs. a new `ICloudPuffStyle`-parallel concept — worth a quick
  design pass before writing code, this doc is a starting point, not a spec.
- No rain/precipitation mechanic design (ground wetness, particle system, gameplay effect).
- No temperature→cloud-type mapping design (which puff style/variant reads as "storm" vs.
  "cirrus").
- No integration with BSP — this is still `triangular-engine`-side POC work, same isolation
  discipline 022 and 023 both followed.

## References

- [022_v4_voronoi_cell_planets.md](022_v4_voronoi_cell_planets.md) — planet data source, full
  generation pipeline and milestone history.
- [023_mesh_puff_clouds.md](023_mesh_puff_clouds.md) — cloud renderer architecture (styles,
  domains, lighting).
- [`worldgen/README.md`](../../projects/triangular-engine/worldgen/README.md) — API reference
  for the data layers this doc proposes consuming (written alongside this doc, same session).
