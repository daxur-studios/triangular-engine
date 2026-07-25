# triangular-engine/takram

Angular-first atmosphere, aerial-perspective, cloud, and geospatial adapters
for Takram's Three.js packages.

```ts
import {
  TakramAtmosphereComponent,
  TakramCloudsComponent,
  TakramModule,
} from 'triangular-engine/takram';
```

This entry point uses `triangular-engine/postprocessing` for screen-space
atmosphere and cloud composition. Install the Takram and `postprocessing`
optional peers used by the selected components.

Design constraints, compatibility notes, and milestone history are tracked in
[`docs/runbook/001_add_takram_three_clouds.md`](../../../docs/runbook/001_add_takram_three_clouds.md).

