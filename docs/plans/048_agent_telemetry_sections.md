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
5. The cell-planet streaming demo sets `telemetrySection="terrain"` on its surface and keeps a
   `planet` section for projection, quality and morph, which only the page knows.

## Not done

- Other library components, such as the cell-planet streaming view, do not forward
  `telemetrySection` yet; pages set it on `<terrainSurface>` directly.
- Report values are a snapshot taken when the report is copied. A drop event is recorded earlier,
  so the sections cannot say what the queue was doing during it. Recording section values with
  each drop event would close that gap.
- No structured (JSON) output. The report stays markdown, so existing agent prompts still read it.
