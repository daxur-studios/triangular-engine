# Ecology sublibrary design direction

Status: north-star design recorded; implementation deferred until the
planetary-time animal reconstruction boundary is proven.

Related plans:
[004_multi_surface_terrain.md](004_multi_surface_terrain.md),
[005_scatter_sublibrary.md](005_scatter_sublibrary.md),
[009-dynamic-habitats-seasons-migration.md](009-dynamic-habitats-seasons-migration.md),
[011_animals_sublibrary.md](011_animals_sublibrary.md), and
[011b_animals_planetary_time_slice.md](011b_animals_planetary_time_slice.md).

## Goal

Make terraforming, base building, resource use, protection, and large-scale
damage produce measurable, explainable, and visible changes to living worlds
over days to centuries without simulating every organism.

The target is a game-readable ecology rather than a complete scientific
ecosystem. A player should be able to clear a forest, block migration, restore
a wetland, introduce a species, pollute water, or terraform a sterile region
and observe both immediate local effects and delayed regional consequences.

## Shared causal pipeline

```text
stable planetary substrate
  geology + elevation + slope + latitude + water topology
                         |
                         v
environment at universal time
  climate + weather summaries + soil + water + pollution + disturbance
                         |
                         v
slow ecological state
  vegetation biomass + succession + productivity + habitat connectivity
  + aggregate plant/animal populations + relationship pressures
                         |
                         v
derived current biome/habitat weights
  forest / grassland / wetland / desert / tundra / etc. (blended, not enums)
                         |
       +-----------------+--------------------+
       |                 |                    |
       v                 v                    v
terrain appearance   scatter/procedural   animal populations
regional tint and    visible vegetation   suitability, capacity,
local materials      and affordances      migration and materialization
```

Terrain geometry is not the biome. A planetary cell keeps a stable identity
while its ecological state and derived biome weights can change drastically at
different universal times.

## Ownership boundaries

### Terrain

- Owns surface topology, elevation, slope, normals, geology inputs, patch
  streaming, and rendering integration.
- Consumes regional material/colour weights to show moisture, vegetation,
  exposed soil, snow, erosion, pollution, or damage.
- Does not own ecological population equations or biome classification.

### Biomes

- Classifies named environmental and ecological channels into blended current
  biome weights.
- A static world may feed only baseline channels. A dynamic world feeds the
  ecology state at the requested universal time.
- Does not evolve forests, populations, soil, or player consequences itself.

### Scatter and procedural vegetation

- Turn suitability and ecological state into stable visible candidates,
  density, species mix, age/stage, and affordances.
- Do not simulate every distant tree. Stable candidates may appear, disappear,
  or change stage as a deterministic function of cell state and universal time.
- Individually important planted, cut, burned, or physics-promoted objects are
  game-owned events/overlays keyed by stable IDs.

### Animals

- Consume habitat, food, shelter, water, connectivity, and relationship
  pressures to evaluate populations and group activities.
- Materialize nearby groups and individuals through the animals/navigation
  layers.
- Do not own climate, vegetation growth, terrain colouring, or authoritative
  player consequences.

### Ecology

- Owns slow regional state transitions, carrying capacities, aggregate
  plant/animal pressures, succession/recovery, habitat connectivity effects,
  and a lightweight species-relationship graph.
- Produces explanations and projections in addition to numeric state.
- Does not own meshes, per-frame boids, detailed physics, vehicle damage,
  missions, rewards, or save/timeline policy.

### Game

- Owns authoritative world history: construction, clearing, mining, fire,
  pollution, terraforming, introductions, exclusions, collisions, protection,
  and restoration.
- Chooses balance, species definitions, timeline branching, gameplay rewards,
  and which consequences become persistent events.

## Dynamic biomes

Biomes are derived descriptions of current conditions, not permanently painted
labels. Stable inputs may include geology, latitude, and unmodified elevation.
Dynamic inputs may include temperature, rainfall, soil moisture, fertility,
vegetation biomass, succession stage, fire, erosion, pollution, and water
availability.

A single region may therefore move through states such as:

```text
mature forest -> cleared land -> grass/shrub recovery -> degraded dryland
              -> restored grassland -> young forest -> mature forest
```

Transitions should be gradual, bounded, inspectable, and driven by explicit
inputs. They need not imitate every ecological process.

## Lightweight food web

Species definitions may declare typed relationships:

- consumes plant biomass, prey biomass, carrion, or another resource;
- is prey for another species;
- competes for a resource or habitat;
- requires water, shelter, nest/perch sites, temperature, depth, or vegetation;
- pollinates, disperses seed, cleans, shelters, or otherwise supports another;
- tolerates or avoids noise, light, structures, vehicles, pollution, or people.

The relationship graph operates on aggregate regional values. It can generate:

- a visual food-web graph;
- dependency and habitat maps;
- carrying-capacity and population pressures;
- warnings about broken links, invasive species, and collapse risk;
- causal explanations and before/after projections.

It must not imply that every distant predator physically hunts a simulated
individual prey animal.

## Visual consequences

The same cell state should drive orbit-scale and ground-level presentation:

- forest canopy tint and density rise or fall;
- grasslands spread, shrink, dry, burn, and recover;
- wetlands expand or disappear with water and soil state;
- exposed soil, erosion, and desertification alter terrain colour/materials;
- vegetation species, density, age, and affordances change;
- animal abundance, sounds, migration, nesting, and visible activities change;
- water vegetation and later aquatic populations respond to water quality.

Distant views use coarse fields, textures, and aggregate canopy signals. Near
the player, terrain materials, deterministic scatter, procedural affordances,
and materialized animals express the same authoritative cell state.

## Explainability contract

Avoid a single unexplained “ecology score.” Every important trend should expose
bounded contributing factors. For example:

```text
forest bird population: declining
  nesting capacity       -42%
  food availability      -18%
  migration connectivity -31%
  vehicle disturbance    +12% pressure
```

An inspector should answer:

- What changed?
- Why did it change?
- Which player/world events contributed?
- What is likely to happen if conditions remain the same?
- Which interventions could improve or worsen it?

Exact scientific prediction is not promised; deterministic, internally
consistent, game-useful causality is.

## Time and scale

- Ecology evaluates coarse cells or regions over coarse intervals or direct
  analytical transitions.
- 1x–10,000x time warp must remain bounded; no per-tree or per-animal replay.
- Querying past/future state uses stable initial conditions plus authoritative
  timed events/checkpoints.
- Nearby rendering and animal movement materialize from the evaluated regional
  state; they do not become the source of macro history.
- Important local outcomes fold back only through explicit game events.

## North-star gameplay examples

- Clearing a forest reduces canopy, biomass, nesting capacity, soil retention,
  and corridor connectivity; visible wildlife and terrain appearance respond.
- A base adds blocked area, light, noise, pollution, shelter, food waste, and
  artificial perches according to authored building effects.
- Roads fragment habitat but wildlife crossings restore some connectivity.
- A reservoir replaces terrestrial habitat with a new aquatic opportunity;
  it remains empty until colonisation policy or introduction permits life.
- Reforestation restores biomass and shelter over years rather than instantly.
- Pollution reduces primary productivity, then fish capacity, then whale
  abundance through explainable relationship pressures.
- Terraforming can move a sterile planet through soil, pioneer vegetation,
  grassland, forest, and introduced-animal stages—or destabilise existing life.

## What to build

- Serializable species/resource/relationship definitions.
- Stable planetary ecology cells and versions.
- A small set of slow state channels: biomass/productivity, moisture/fertility,
  disturbance/pollution, habitat capacity/connectivity, and population trends.
- Deterministic bounded evaluation at arbitrary universal time.
- Sparse timed event overlays and checkpoints.
- Blended current biome/habitat outputs.
- Causal contribution records suitable for UI and testing.
- Adapters/signals for terrain tint, scatter suitability, and animal habitat.
- A shared headless/visible inspector for scenarios and time scrubbing.

## What not to build initially

- Continuous simulation of every plant, animal, nutrient, or water molecule.
- Detailed metabolism, genetics, disease, digestion, or full soil chemistry.
- A universal scientifically accurate food web.
- Per-individual distant predator/prey encounters.
- One bespoke behaviour engine for every real species.
- Automatic inference of ecological meaning from arbitrary rendered meshes.
- Unbounded global PDE/fluid simulation as an ecology prerequisite.
- Instant coupling of every existing engine package before one causal slice is
  proven end to end.

## First future vertical slice

After the planetary-time animal reconstruction checkpoint, build one ecology
cell timeline with three aggregate living components: forest biomass, one
forest-dependent herbivore/bird population, and one dependent predator or
consumer.

Apply one timed forest-clearing event and evaluate before, immediately after,
years after without restoration, and years after a restoration event. Require:

- bounded deterministic evaluation at arbitrary time;
- visible forest density and terrain tint derived from the same state;
- carrying capacity and dependent populations responding with delays;
- no changes before an event's effective time;
- unrelated cells remaining unchanged;
- explicit causal factors for every trend;
- the same core driving headless tests and a time-scrubbable inspector.

This proves destruction, delayed consequences, desertification pressure, and
recovery without yet claiming global ecology.

## Open decisions

- Whether the eventual public entry point is `triangular-engine/ecology`, with
  biome classification remaining a separate `biomes` entry point, or whether
  their first implementation shares one package while preserving the boundary.
- Exact ecology-cell topology on quad-sphere planets and how cell versions map
  to terrain/scatter streaming patches.
- Minimal equations and units for biomass, succession, soil degradation, and
  population response.
- Checkpoint frequency and ownership between library and game saves.
- Timeline branching semantics after a player rewinds and acts.
- How regional ecology aggregates across multiple scales without visible seams.

## Definition of done for the design checkpoint

- Terrain, biomes, scatter, animals, ecology, and game ownership are explicit.
- Dynamic biome/appearance behaviour is connected to slow ecological state.
- Food-web visualisation is data-driven and aggregate rather than per-individual.
- Destruction, delayed consequences, restoration, and explainability have one
  concrete future acceptance scenario.
- Implementation remains deferred until the planetary-time animals slice has a
  trustworthy deterministic baseline and event overlay.
