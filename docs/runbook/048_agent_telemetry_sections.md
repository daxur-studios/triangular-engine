---
type: Runbook
title: Agent Telemetry Sections
description: Evidence for the page-supplied telemetry sections in the engine's Copy for Agent report.
timestamp: 2026-10-14T12:00:00Z
tags: [telemetry, engine, agent, performance, demo]
---

# Runbook 048: Agent Telemetry Sections

Plan: [Plan 048](/docs/plans/048_agent_telemetry_sections.md).

## Verification

- `ng test triangular-engine` over `lib/engine/models/**`: 27/27 pass. New specs cover
  `TelemetrySections` (format, order, `undefined` omission, replacement, unregistering, a
  replaced provider surviving an older unregister, lazy evaluation, and a throwing provider) and
  one `FPSController` case that checks the section lands inside the fenced block after the timeline.
- `npm run build:triangular-engine` passes, and the bundle exposes `TelemetrySections`.
- `ng build demo-app` passes, which type-checks the planet registration against the new API.
- `ng test triangular-engine` over `terrain/components/terrain-surface.component.spec.ts`: 24/24
  pass. New specs: the section appears with counts after an update (and `no update yet` before);
  it is absent when `telemetrySection` is unset; it is removed when the name is cleared or the
  surface is destroyed.
- Field report, cell-planet demo, orbit (high quality, 140 patches), taken before the terrain
  section existed: the page's counts were self-consistent (`levels` sums to 140, resident 140,
  queued 0). The sample also showed a drop 6 s before the copy with queued at 0 at copy time, which
  is the gap noted in the plan.
- Not measured in a browser. Opening the demo would load the planet in WebGL, and the report's
  output is covered by the specs above.

## Format

A page section is appended to the report like this:

```
planet:
  projection: equalEarth
  quality: high
  morph: 0.5
  patches: 140
```
