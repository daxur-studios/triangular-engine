---
type: EngineeringRecord
title: "Parametric catch tower asset"
description: "Dated decisions, findings and evidence for Parametric catch tower asset."
timestamp: 2026-11-24T00:00:00Z
tags: [engineering-records]
record_id: er-090
scope_history_schema: 1
plans:
  - /docs/plans/090_parametric-catch-tower.md
performance: []
---

# Engineering Record 090: Parametric catch tower asset

Plan: [PLAN-090](/docs/plans/090_parametric-catch-tower.md).

## 2026-11-24 — Starting

**Goal.** Compare a Flight 5-inspired visual asset around the centred stock booster before detailing the mast.

**Interface.** The consumer lab and its Plan 004 provide the sliding motion and game dimensions. Keep the 35.75 m rail plane, 4.40 m pin span and 3.20 m closed pad centre spacing. The 4.40 m centered slide per arm leaves 3.30 m beyond each pin at the open stop. The 35.90 m catch socket is 0.15 m above the rail plane. The stock pads give 1.00 m of contact width per pin. Use the hinged engine archetype as a visual reference and stage the requested V sweep in the preview with the same closed pose.

**Parts.** The [study](/projects/brep-poc/studies/catch-tower/README.md) contains the fixed tower, moving carriage, mirrored arms with their rail pads and a stock pin proxy. Each GLB has a local origin and material groups. The geometry is a multi-body visual assembly and its CAD volume sums the constituent solid volumes.

## History

### 2026-11-24 — First asset pass

- `brep verify --check` passed all five defaults and both parameter-limit profiles on both hands. The bake checks the validity and mesh coverage of every constituent body and verifies the two stock contacts across all profiles. A read-only check against the consumer lab's actual archetype and slide function confirmed the mounting, pad centres, rail plane and travel.
- Headless Chromium exercised linked orbit, both arm modes, the carriage controls and the three profiles. Separate GLB reads measured the rail tops and closed pad centres in metres, Y-up. The CAD arm snapshot and preview views were visually inspected. Motion is a preview of the visual assembly. Integration and physics stay with the consumer lab.
- The library build and strict preview type check passed. The repository-wide records check reported existing issues in Plans 081, 087 and 088.
- CAD reports, independent GLBs and the HTML preview are local under `artifacts/brep-catch-tower/`. Regenerate with the commands in the [study](/projects/brep-poc/studies/catch-tower/README.md).

## Scope history

<!-- tri:scope-history -->
<!-- tri:scope-baseline state="unconfirmed" -->
<!-- /tri:scope-baseline -->
<!-- /tri:scope-history -->
