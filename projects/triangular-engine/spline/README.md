# triangular-engine/spline

Authoring-neutral open and closed curves in field space, for anything that
needs "a line on a surface" — rivers, roads, coastlines, mountain-range
outlines, biome regions, and keep-out zones — without each feature
reinventing curve evaluation.

Import spline APIs from `triangular-engine/spline`; do not reach into the
package's internal folders.

This entry point is `core/` only so far (Phase 0A): ambient 3D geometry with
no Three.js or Angular import. Surface binding, masks, rendering, and editing
land in later phases — see `docs/runbook/008_spline_sublibrary.md` in the
`triangular-workspace` repo for the full contract and phased plan.

## Defining a spline

```ts
import { ISplineDefinition } from 'triangular-engine/spline';

const road: ISplineDefinition = {
  schemaVersion: 1,
  id: 'road-a',
  interpolation: 'bezier',
  closed: false,
  points: [
    { position: [0, 0, 0], handleOut: [10, 0, 0] },
    { position: [40, 0, 0], handleIn: [-10, 0, 0] },
  ],
};
```

## Sampling

All public sampling is by distance along the spline, not the raw curve
parameter — arc length is the sampling currency:

```ts
import { evaluateAtDistance, getSplineLength } from 'triangular-engine/spline';

const length = getSplineLength(road);
const midpoint = evaluateAtDistance(road, length / 2);
// midpoint.position, midpoint.tangent
```

## Finding the nearest point

```ts
import { closestPoint } from 'triangular-engine/spline';

const nearest = closestPoint(road, [20, 0, 5]);
// nearest.distance, nearest.point, nearest.tangent, nearest.arcLength, nearest.t
```

`closestPoint` returns no signed quantities — see decision 1 in the runbook
doc. Lateral offset and containment need a reference surface normal and are
introduced with the surface adapter in Phase 1.

## Serialization

```ts
import {
  serializeSplineDefinition,
  deserializeSplineDefinition,
} from 'triangular-engine/spline';

const json = serializeSplineDefinition(road);
const restored = deserializeSplineDefinition(json);
```
