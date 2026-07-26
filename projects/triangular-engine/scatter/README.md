# triangular-engine/scatter

Deterministic, streamed environment scattering for terrain vegetation, rocks,
billboards, and other repeated scene objects.

Import scatter APIs from `triangular-engine/scatter`; do not reach into the
package's internal folders.

Scatter is renderer- and physics-optional. Consumers provide layer
definitions, suitability rules, and assets; the library keeps placement
deterministic as cells stream and LODs change.

## Camera-linked streaming

Provide `ScatterStreamingService` beside the scene's `EngineService`. It follows
the active camera in world space by default and exposes convenience methods for
fixed-level cell selection and LOD bucketing:

```ts
providers: [...EngineService.provide(), ScatterStreamingService];
```

```ts
const streaming = inject(ScatterStreamingService);

streaming.viewpointWorldM$.subscribe(() => {
  const cells = streaming.selectFixedLevelCells(domain, cellOptions);
  const lods = streaming.bucketInstancesByLod(lodOptions);
});
```

Camera movement is coalesced to one-metre steps by default. Use
`setMovementThresholdM()` to tune it. Render streaming can follow a player or
editor viewpoint instead:

```ts
streaming.setViewpointOverride(() => player.worldPositionM);
// Return to the active camera:
streaming.setViewpointOverride(undefined);
```

Physics residency remains independently player/vehicle-driven and should not
share the render-streaming viewpoint.

Current API decisions and implementation status are tracked in
[`docs/runbook/005_scatter_sublibrary.md`](../../../docs/runbook/005_scatter_sublibrary.md).
