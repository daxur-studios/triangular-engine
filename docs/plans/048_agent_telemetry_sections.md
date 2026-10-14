---
type: Plan
title: Agent Telemetry Sections
description: Let pages add their own state to the engine's Copy for Agent telemetry report, without the engine knowing about them.
timestamp: 2026-10-14T12:00:00Z
tags: [telemetry, engine, agent, performance, demo]
---

# Plan 048: Agent Telemetry Sections

Evidence: [Runbook 048](/docs/runbook/048_agent_telemetry_sections.md).

## Problem

**Copy for Agent** in `engine-stats` reports only what `FPSController` knows: frame rate, draw calls,
triangles, memory, camera and drop events. Page state such as terrain patch counts, LOD levels and
morph progress was never in the report, so a pasted report could not explain a frame drop.
`formatTelemetryForAgent()` hard-coded every line, so pages had no way in.

## Changes

1. `TelemetrySections` (`models/telemetry-sections.model.ts`) is a named registry of providers. Each
   provider returns `key: value` pairs; `format()` renders them as `name:` headings with indented
   lines, in registration order. `register` returns a function that removes the section.
2. `FPSController.telemetry` owns one registry per engine. `formatTelemetryForAgent()` appends its
   output inside the same fenced block, after the timeline. The engine's own lines are unchanged.
3. Providers run only when the report is copied, so registering a section costs nothing per frame.
   A provider that throws becomes an `error:` line and does not stop the copy.
4. `TerrainSurfaceComponent` takes an optional `telemetrySection` input. When set, it registers a
   section with its own counts (desired, resident, queued, draw calls, triangles, geometry MB and
   the level histogram), read from the stats it already emits. Unset, the default, it adds nothing.
   Its triangle and geometry counts are named `residentTriangles` and `residentGeometryMB`, because
   they cover every resident patch, including patches draw culling hides.
5. The cell-planet streaming demo sets `telemetrySection="terrain"` on its surface and keeps a
   `planet` section for projection, quality and morph, which only the page knows.

## Not done

- Other library components, such as the cell-planet streaming view, do not forward
  `telemetrySection` yet; pages set it on `<terrainSurface>` directly.
- Report values are a snapshot taken when the report is copied, so a drop shows the sections as
  they read when the drop was detected instead (`IPerformanceDropEvent.pageSections`). Each second
  that qualifies as a drop refreshes it. Sections still cannot explain a stall that falls outside
  a detected drop second, such as a single long frame that does not lower the second's FPS enough.
- No structured (JSON) output. The report stays markdown, so existing agent prompts still read it.
