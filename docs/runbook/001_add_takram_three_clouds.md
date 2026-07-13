# 001 — Add Takram Three Clouds

## Status

- State: Planning
- Target entry point: `triangular-engine/takram`
- Initial renderer: WebGL
- Last updated: 2026-07-13

## Objective

Add an optional Angular-first integration for Takram's geospatial atmosphere and volumetric cloud packages to triangular-engine.

The intended consumer API should provide the equivalent of Takram's React Three Fiber example without requiring React or R3F:

```html
<scene>
  <postprocessing-composer [enableNormalPass]="true">
    <takram-atmosphere>
      <takram-clouds [disableDefaultLayers]="true">
        <takram-cloud-layer
          channel="r"
          [altitude]="750"
          [height]="650"
        />
        <takram-cloud-layer
          channel="g"
          [altitude]="1000"
          [height]="1200"
        />
        <takram-cloud-layer
          channel="b"
          [altitude]="7500"
          [height]="500"
          [densityScale]="0.003"
          [shapeAmount]="0.4"
          [shapeDetailAmount]="0"
          [coverageFilterWidth]="0.5"
        />
      </takram-clouds>

      <takram-aerial-perspective
        [sky]="true"
        [sunLight]="true"
        [skyLight]="true"
      />
    </takram-atmosphere>
  </postprocessing-composer>
</scene>
```

The final selector names may change after prototyping.

## Why this is not one component

`@takram/three-clouds` does not render an ordinary Three.js mesh. `CloudsEffect` is a multi-pass post-processing effect that produces cloud, shadow, and optional shadow-length buffers.

The full rendering path is:

```text
Scene and camera
    -> scene colour/depth/normal data
    -> cloud shadow ray march
    -> temporal shadow resolve
    -> low-resolution cloud ray march
    -> temporal cloud upscale/resolve
    -> aerial-perspective composition
    -> final image
```

The R3F components hide lifecycle management, asset loading, atmosphere context, frame updates, and routing buffers between the clouds and aerial-perspective effects. Triangular-engine must replace those responsibilities.

## Confirmed package graph

The non-R3F integration uses the plain Three.js exports from the package root.

```text
triangular-engine/takram
├── three
├── postprocessing
├── @takram/three-clouds
│   ├── @takram/three-atmosphere
│   └── @takram/three-geospatial
├── cloud textures
│   ├── local weather texture
│   ├── shape volume texture
│   ├── shape-detail volume texture
│   ├── turbulence texture
│   └── STBN volume texture
└── atmosphere lookup textures
    ├── transmittance
    ├── irradiance
    ├── scattering
    └── optional Mie/higher-order scattering
```

Use:

```ts
import { CloudLayer, CloudsEffect } from '@takram/three-clouds';
```

Do not import `@takram/three-clouds/r3f` in triangular-engine.

Versions observed during initial investigation:

- `@takram/three-clouds`: `0.7.6`
- `@takram/three-atmosphere`: `0.19.1`
- `@takram/three-geospatial`: `0.9.1`
- Takram's minimum `postprocessing` peer version: `6.36.7`
- Takram's declared Three.js range: `>=0.170.0`
- Triangular workspace Three.js version: `0.183.2`

Pin and test a known-compatible set before publishing. Takram's open-ended Three.js peer range is not proof that every later Three.js version is compatible.

## Principal engine incompatibility

Triangular-engine currently wraps the composer from:

```ts
three/examples/jsm/postprocessing/EffectComposer.js
```

Takram effects use the separate `postprocessing` package:

```ts
import { Effect, EffectComposer, EffectPass } from 'postprocessing';
```

The two systems are not interchangeable. A Takram `CloudsEffect` cannot be added to the current composer as a Three.js examples `Pass`.

The current composer is implemented at:

```text
projects/triangular-engine/src/lib/engine/components/postprocessing/
  effect-composer/effect-composer.component.ts
```

## Architecture decision

Keep the existing Three.js examples composer for backward compatibility and introduce a second, `postprocessing`-based composer backend.

First generalise the engine's active composer into a renderer-independent contract:

```ts
export interface EngineRenderPipeline {
  render(deltaTime: number): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}
```

Both the existing composer and the new `postprocessing` composer should register through this contract. Only one final render pipeline should be active for a scene unless explicit pipeline composition is designed later.

Do not silently mix the two composer implementations.

## Proposed secondary entry point

Follow the Angular Package Format pattern already used by `triangular-engine/jolt`, `triangular-engine/rapier`, and `triangular-engine/pmndrs`:

```text
projects/triangular-engine/takram/
├── ng-package.json
├── public-api.ts
├── index.ts
├── takram.module.ts
├── composer/
│   └── postprocessing-composer.component.ts
├── atmosphere/
│   ├── takram-atmosphere.component.ts
│   ├── takram-atmosphere.service.ts
│   └── takram-aerial-perspective.component.ts
├── clouds/
│   ├── takram-clouds.component.ts
│   ├── takram-cloud-layer.component.ts
│   └── takram-cloud-assets.service.ts
└── loaders/
    ├── volume-texture.loader.ts
    └── stbn-texture.loader.ts
```

Use `triangular-engine/takram` rather than `triangular-engine/clouds` because atmosphere, cloud lighting, cloud shadows, and aerial-perspective composition are closely coupled.

## Optional peer dependencies

The Takram family must remain optional for users who only need the core engine or physics entry points.

Candidate package metadata:

```json
{
  "peerDependencies": {
    "@takram/three-atmosphere": "^0.19.1",
    "@takram/three-clouds": "^0.7.6",
    "@takram/three-geospatial": "^0.9.1",
    "postprocessing": "^6.36.7"
  },
  "peerDependenciesMeta": {
    "@takram/three-atmosphere": { "optional": true },
    "@takram/three-clouds": { "optional": true },
    "@takram/three-geospatial": { "optional": true },
    "postprocessing": { "optional": true }
  }
}
```

Confirm the ranges using a clean consumer installation before committing them.

## Responsibilities to replace from R3F

The Angular adapter must:

- Create and dispose `CloudsEffect` and atmosphere effects.
- Obtain and track the active triangular-engine camera.
- Pass frame delta time to the `postprocessing` composer.
- Resize all render targets with the engine canvas.
- Load the default weather, shape, shape-detail, turbulence, and STBN textures.
- Configure texture filtering, wrapping, formats, and colour spaces correctly.
- Decode raw volume data into `Data3DTexture` instances.
- Supply atmosphere parameters and atmosphere lookup textures.
- Update `sunDirection` and `worldToECEFMatrix`.
- Route `atmosphereOverlay`, `atmosphereShadow`, and `atmosphereShadowLength` from `CloudsEffect` into aerial perspective.
- Translate Angular inputs into Takram's nested properties.
- Rebuild packed cloud-layer uniforms when projected children change.
- Enforce Takram's maximum of four cloud layers.
- Dispose render targets, materials, textures, subscriptions, and event listeners.

## Rendering constraints

The first integration should explicitly support:

- WebGL only.
- WebGL2-class functionality.
- Perspective cameras initially.
- Depth textures and, where required, normal data.
- `Data3DTexture` and texture arrays.
- Half-float render targets.
- Multiple temporal history buffers.
- A maximum of four cloud layers.

If triangular-engine is configured with `WebGPURenderer`, the Takram entry point should report a clear unsupported-renderer error. It must not fail silently.

## Implementation plan

### Phase 0 — Compatibility spike

- [x] Install exact Takram and `postprocessing` versions in the workspace as development dependencies.
- [x] Confirm all packages resolve with Three.js `0.183.2`.
- [x] Create a minimal plain TypeScript scene using Takram's non-R3F exports.
- [ ] Render one default cloud layer through a `postprocessing` composer.
- [ ] Confirm the required WebGL extensions and texture formats in target browsers.
- [ ] Record baseline GPU memory, frame time, warnings, and visual output.

Exit gate: a plain Three.js/Takram example renders inside the demo application without React packages.

### Phase 1 — Generic render pipeline

- [ ] Add `EngineRenderPipeline` to triangular-engine core.
- [ ] Adapt the current Three.js examples composer to register through it.
- [ ] Preserve the existing composer API and tests.
- [ ] Pass real frame delta time into the active render pipeline.
- [ ] Forward engine resize events through the pipeline contract.
- [ ] Define behaviour when multiple pipelines attempt to register.

Exit gate: all existing post-processing examples still work unchanged.

### Phase 2 — `postprocessing` composer backend

- [ ] Add an Angular wrapper around `postprocessing.EffectComposer`.
- [ ] Add scene render, effect-pass, depth, and normal support as required.
- [ ] Track camera replacement through `EngineService.camera$`.
- [ ] Handle resize, enable/disable, teardown, and renderer validation.
- [ ] Add a minimal non-Takram effect to prove the backend independently.

Exit gate: triangular-engine can declaratively render an ordinary `postprocessing` effect.

### Phase 3 — Cloud-only adapter

- [ ] Scaffold the `triangular-engine/takram` secondary entry point.
- [ ] Implement `TakramCloudsComponent` around `CloudsEffect`.
- [ ] Implement `TakramCloudLayerComponent` around `CloudLayer`.
- [ ] Project cloud-layer children into the parent effect.
- [ ] Implement default cloud asset loading.
- [ ] Implement volume and STBN loaders.
- [ ] Add quality preset, coverage, resolution scale, temporal upscale, haze, turbulence, and light-shaft inputs.
- [ ] Support custom `Texture`, `Data3DTexture`, and procedural texture inputs.
- [ ] Add clear errors for invalid renderer, camera, layer count, and failed assets.

Exit gate: clouds render and animate without R3F, even before full atmosphere composition is complete.

### Phase 4 — Atmosphere and aerial perspective

- [ ] Implement atmosphere state/service scoped to an Angular scene subtree.
- [ ] Load or generate atmosphere lookup textures.
- [ ] Implement `TakramAerialPerspectiveComponent`.
- [ ] Route cloud overlay, shadow, and shadow-length buffers.
- [ ] Synchronise atmosphere parameters across effects.
- [ ] Synchronise sun direction and world/ECEF transforms.
- [ ] Implement optional sun and sky lights.
- [ ] Verify cloud shadows on opaque scene geometry.
- [ ] Verify sky rendering and light shafts.

Exit gate: reproduce Takram's documented three-layer example with comparable output.

### Phase 5 — Productise the API

- [ ] Finalise selector and input naming conventions.
- [ ] Add Angular signal-input updates without unnecessary effect reconstruction.
- [ ] Add examples for default clouds, custom layers, custom weather, and procedural textures.
- [ ] Document performance presets and browser requirements.
- [ ] Add unit tests for lifecycle, layer mapping, and buffer routing.
- [ ] Add render/screenshot regression coverage where practical.
- [ ] Test a production build and a clean external consumer installation.
- [ ] Confirm tree shaking and that core users do not receive Takram dependencies.
- [ ] Add Takram MIT attribution if source or assets are redistributed.

Exit gate: the entry point is documented, independently installable, and safe to publish.

## Minimum test matrix

| Area | Cases |
| --- | --- |
| Renderer | WebGL success; WebGPU explicit rejection |
| Camera | initial camera; runtime camera replacement; resize |
| Layers | defaults; one custom layer; four layers; fifth-layer rejection |
| Assets | package defaults; custom URLs; provided texture objects; failed load |
| Temporal rendering | moving camera; stationary camera; effect disable/re-enable |
| Composition | standalone clouds; atmosphere overlay; scene shadows; light shafts |
| Lifecycle | component destroy/recreate; route change; repeated scene creation |
| Packaging | core-only install; Takram install; production build; clean consumer app |
| Performance | low/medium/high presets; high-DPI display; reduced resolution scale |

## Initial acceptance example

The first full-fidelity milestone should reproduce these settings:

```ts
[
  { channel: 'r', altitude: 750, height: 650 },
  { channel: 'g', altitude: 1000, height: 1200 },
  {
    channel: 'b',
    altitude: 7500,
    height: 500,
    densityScale: 0.003,
    shapeAmount: 0.4,
    shapeDetailAmount: 0,
    coverageFilterWidth: 0.5,
  },
]
```

Acceptance criteria:

- No React, R3F, Drei, or `@react-three/postprocessing` runtime dependency.
- Clouds remain stable while the camera moves.
- Scene depth correctly occludes clouds.
- Atmospheric perspective is applied to scene and clouds.
- Sun direction affects cloud lighting and shadows.
- Resize and high-DPI changes do not corrupt render targets.
- All GPU resources are released when the scene is destroyed.

## Open questions

- Should the generic `postprocessing` composer live in core, `triangular-engine/pmndrs`, or `triangular-engine/takram`? Preferred direction: a general optional post-processing entry point, because it is useful beyond Takram.
- Should atmosphere lookup textures be loaded from Takram's hosted defaults, copied into triangular-engine assets, or generated at runtime?
- Should the first release expose the full Takram parameter surface or a deliberately small stable subset plus access to the underlying effect?
- Does Takram `0.7.6` compile and render cleanly against Three.js `0.183.2`, including internal shader assumptions?
- Is a normal pass required for every supported composition mode, or only for particular aerial-perspective shadow paths?
- How should two declarative composer components competing for the active pipeline be diagnosed?

## Risks

- The current and Takram composer implementations are incompatible despite sharing the `EffectComposer` name.
- Temporal effects can ghost or smear during disocclusion; Takram documents this as a known limitation.
- Cloud rendering allocates several large half-float buffers and can be expensive on high-DPI screens.
- Default assets may introduce deployment, CORS, cache, or redistribution concerns.
- Takram's shaders and internal materials may be sensitive to future Three.js releases.
- Full geospatial correctness requires consistent units, ellipsoid settings, ECEF transforms, and camera altitude.

## Investigation log

### 2026-07-13 — Initial mapping

- Confirmed triangular-engine is currently on Three.js `0.183.2`.
- Confirmed triangular-engine's composer uses `three/examples/jsm/postprocessing`.
- Confirmed Takram uses the separate `postprocessing` package.
- Confirmed `CloudsEffect` is available from the package root and does not require R3F.
- Confirmed the R3F wrapper supplies asset loading, lifecycle updates, atmosphere context, camera selection, and buffer routing.
- Confirmed clouds depend directly on Takram atmosphere and geospatial packages.
- Chose `triangular-engine/takram` as the provisional secondary entry point.
- Chose a second composer backend plus a generic render-pipeline contract as the provisional architecture.

### 2026-07-13 — M1 compatibility spike started

- Installed exact Takram versions `three-clouds@0.7.6`, `three-atmosphere@0.19.1`, and `three-geospatial@0.9.1`.
- `postprocessing@6.37.8` rejected Three.js `0.183.2` because its peer range ended below `0.181.0`.
- Selected `postprocessing@6.39.2`; its peer range supports Three.js `>=0.168.0 <0.186.0`.
- Added the isolated demo route `/takram-clouds-spike`; it imports no triangular-engine or React APIs.
- Confirmed a development build succeeds and the runtime loads WebGL2 plus all cloud/atmosphere textures without errors.
- Confirmed cloud output must be routed into `AerialPerspectiveEffect`; constructing `CloudsEffect` alone produced a black composition.
- Current runtime is deliberately low quality with one layer, quarter-resolution clouds, and shadows disabled.
- Visual acceptance remains open: the automated browser reports the pass running but its software/GPU environment falls to roughly 1 fps once atmosphere overlay composition is active, preventing a reliable screenshot.
- A real-browser test initially produced a black frame and the ANGLE warning `X4000: use of potentially uninitialized variable`; the warning is recorded but is not treated as the cause of the black frame.
- Corrected the spike's coordinate setup: local metres now map to an east/up/south frame translated to the WGS84 equatorial surface. Identity `worldToECEFMatrix` incorrectly placed the camera near Earth's centre.
- Removed the world-space sky plane. The spike uses the sky generated by `AerialPerspectiveEffect({ sky: true })` directly.

## References

- [Takram three-clouds package](https://www.npmjs.com/package/@takram/three-clouds)
- [Takram three-geospatial repository](https://github.com/takram-design-engineering/three-geospatial)
- [Clouds package source](https://github.com/takram-design-engineering/three-geospatial/tree/main/packages/clouds)
- [CloudsEffect source](https://github.com/takram-design-engineering/three-geospatial/blob/main/packages/clouds/src/CloudsEffect.ts)
- [Clouds R3F wrapper source](https://github.com/takram-design-engineering/three-geospatial/blob/main/packages/clouds/src/r3f/Clouds.tsx)
- [Atmosphere package source](https://github.com/takram-design-engineering/three-geospatial/tree/main/packages/atmosphere)
