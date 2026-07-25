# triangular-engine/water

`triangular-engine/water` provides large, camera-centred water surfaces for
planes, planets, and the inhabited inside wall of cylinders. The package is
optional: games that do not import this entry point do not pay for it.

The stable public rendering API is the standalone `<waterSurface>` component.
It owns the water mesh, LOD updates, depth capture, shader configuration, and
cleanup.

## Official demo

Run the demo application and open `/water`. This is the maintained
consumer-facing example for all supported domain shapes (`PlaneWaterDomain`,
`SphereWaterDomain`, and `CylinderWaterDomain`), render-quality and motion
presets, and the optional underwater post-processing entry point. The older
water POC pages remain focused diagnostic fixtures.

## Install and import

Install the engine and its required Three.js peer:

```bash
npm i triangular-engine three
```

Import the standalone component and the domain required by the scene:

```ts
import { Component } from '@angular/core';
import { EngineModule } from 'triangular-engine';
import {
  PlaneWaterDomain,
  WaterSurfaceComponent,
} from 'triangular-engine/water';

@Component({
  standalone: true,
  imports: [EngineModule, WaterSurfaceComponent],
  template: `
    <triangular-engine>
      <scene>
        <waterSurface
          [domain]="waterDomain"
          quality="balanced"
          motion="oceanSwell"
        />
      </scene>
    </triangular-engine>
  `,
})
export class GameScene {
  readonly waterDomain = new PlaneWaterDomain({ seaLevelY: 0 });
}
```

Use the camelCase selector exactly as shown: `<waterSurface>`.

## Component inputs

| Input | Type | Default | Purpose |
| --- | --- | --- | --- |
| `domain` | `WaterSurfaceDomain` | `PlaneWaterDomain` at Y=0 | Shape and world-space datum |
| `bodyId` | `string` | generated unique ID | Registry identity for sampling and events |
| `priority` | `number` | `0` | Higher body wins where registered bodies overlap |
| `quality` | `'performance' \| 'balanced' \| 'cinematic'` | `'balanced'` | Rendering cost and shader features |
| `motion` | `'calmLake' \| 'oceanSwell' \| 'storm'` | `'oceanSwell'` | Wave character, independent of quality |
| `presetOverrides` | `WaterRenderPresetOverrides` | `{}` | Typed colour, grid, wave, and far-field overrides |
| `lodDetail` | `number` greater than 0 | `1` | Retains fine LOD geometry farther from the camera |
| `wireframe` | `boolean` | `false` | LOD/debug view |

Quality and motion are deliberately independent. For example, a storm can use
the performance renderer, while calm water can use cinematic far-field glint.

```html
<waterSurface
  [domain]="waterDomain"
  quality="performance"
  motion="storm"
  [lodDetail]="1.5"
/>
```

Changing these inputs at runtime rebuilds only the renderer state that needs to
change. No page reload is required.

## Domains

Keep a domain instance on the component rather than constructing one in the
template. Replacing the instance intentionally replaces the water renderer.

### Flat oceans and lakes

```ts
readonly ocean = new PlaneWaterDomain({ seaLevelY: 12 });
```

The plane is effectively unbounded and follows the camera through its LOD
grid. `seaLevelY` is the undisplaced surface height.

### Planetary water

```ts
import { Vector3 } from 'three';

readonly planetOcean = new SphereWaterDomain(6_371_000, {
  center: new Vector3(0, 0, 0),
});
```

The radius and centre must use the same world units and coordinate frame as the
planet. Water normals point outwards.

### Inside-cylinder water

```ts
import { Vector3 } from 'three';

readonly habitatWater = new CylinderWaterDomain(500, {
  axis: new Vector3(0, 1, 0),
  center: new Vector3(0, 0, 0),
  lengthM: 2_000,
});
```

This domain represents water on the *inside* wall of an O'Neill-style
cylinder. Its water normal points inward, towards the cylinder axis.
`lengthM` is optional; omit it for an infinite cylinder.

## Appearance overrides

Use `presetOverrides` for local art direction without copying renderer or
shader code:

```ts
import type { WaterRenderPresetOverrides } from 'triangular-engine/water';

readonly moonlitWater: WaterRenderPresetOverrides = {
  shading: {
    colorShallow: '#547a99',
    colorDeep: '#020a16',
    absorptionDistance: 10,
    fresnelPower: 5,
    detailStrength: 0.4,
  },
  farField: {
    glintStrength: 0.25,
    horizonBlendDistance: 8_000,
  },
};
```

```html
<waterSurface
  [domain]="ocean"
  quality="cinematic"
  motion="calmLake"
  [presetOverrides]="moonlitWater"
/>
```

Overrides are merged by section. A `grid` override changes only supplied grid
fields, while a `waves` override replaces the complete wave preset.

## Framework-free use and CPU sampling

`WaterSurfaceRenderer` is available for non-Angular render ownership. Most
games should use `<waterSurface>` because it already integrates with the
engine's ordered `beforeRender$` phase and depth prepass.

`GerstnerSurface` implements the shared CPU sampling contract:

```ts
import {
  GerstnerSurface,
  WATER_WAVE_PRESETS,
} from 'triangular-engine/water';

const surface = new GerstnerSurface(WATER_WAVE_PRESETS.oceanSwell.waves);
const height = surface.getHeight(worldX, worldZ, elapsedSeconds);
const normal = surface.getNormal(worldX, worldZ, elapsedSeconds);
const flow = surface.getFlow(worldX, worldZ, elapsedSeconds);
```

For gameplay queries, inject `WaterService`. Every `<waterSurface>` registers
its domain and active wave preset automatically:

```ts
import { inject } from '@angular/core';
import { WaterService } from 'triangular-engine/water';

readonly water = inject(WaterService);

samplePlayer(position: THREE.Vector3, elapsedSeconds: number) {
  const sample = this.water.sample(position, elapsedSeconds);
  // sample?.signedDistance: positive above, negative below
  // sample?.depth: zero above, positive below
  // sample?.position / normal / flow are world-space
}
```

Track an object or position provider when enter/exit transitions are needed:

```ts
const tracker = this.water.track(playerObject, { hysteresis: 0.15 });
tracker.state$.subscribe(({ underwater, sample }) => {
  hud.depth.set(sample?.depth ?? 0);
});
tracker.crossings$.subscribe(({ type }) => {
  if (type === 'enter') playSplash();
});

// On owner teardown:
tracker.dispose();
```

Tracking is evaluated from the engine's ordered before-render phase.
Hysteresis prevents repeated transitions while the camera or object sits on a
moving wave crest. Overlapping bodies are filtered by `contains` and resolved
by highest `priority`; Phase 5 rivers use this same rule.

## Underwater post-processing

Underwater rendering is a separate optional entry point so importing core
water does not load the `postprocessing` peer:

```bash
npm i postprocessing
```

```ts
import {
  PostprocessingComposerComponent,
  ToneMappingEffectComponent,
} from 'triangular-engine/postprocessing';
import {
  WaterUnderwaterEffectComponent,
} from 'triangular-engine/water/postprocessing';
```

```html
<postprocessing-composer>
  <waterUnderwaterEffect
    color="#0b6270"
    [density]="0.035"
    [distortion]="0.0025"
    [fadeDistance]="2"
    [hysteresis]="0.1"
  />
  <toneMappingEffect />
</postprocessing-composer>
```

Place the underwater effect before final tone mapping. It tracks the active
engine camera through `WaterService`, stays inactive above water, and applies
scene-depth fog, tint, and subtle screen-space distortion after a stable
hysteresis crossing. `fadeDistance` controls how quickly the effect reaches
full strength as the camera descends.

## Quality guidance

- `performance`: smallest grid and cheapest material; use for low-power
  devices, secondary bodies, or distant water.
- `balanced`: Gerstner displacement, detail normals, and depth-based shoreline
  shading; use as the normal gameplay default.
- `cinematic`: denser grid plus far-field glint, distance roughness, and
  reflective horizon treatment; use for hero oceans and high-end settings.

Measure with the actual game scene. Water depth capture and high-tier
far-field work scale differently from ordinary opaque geometry.

## Current limitations

- The underwater tint/fog/distortion effect is public; the analytic meniscus
  waterline is still outstanding.
- Jolt buoyancy is not yet shipped.
- Reflections, crest foam, rivers, river flow, and wakes are not yet shipped.
- WebGL is the supported renderer. Do not assume WebGPU compatibility.
- The component must update after camera controllers. Use the component or the
  engine's `beforeRender$` hook; do not update a custom renderer from
  subscription-construction order on `tick$`/`postTick$`.

## Maintenance rule

This README is the public water contract. Any change that adds or changes a
selector, input, preset, entry point, supported domain, optional peer, or
runtime limitation must update this page in the same change.

Implementation history and unfinished engineering gates remain in
[`docs/runbook/002_water_sublibrary.md`](../../../docs/runbook/002_water_sublibrary.md);
game-facing instructions belong here.
