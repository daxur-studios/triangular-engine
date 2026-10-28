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
`docs/runbook/001_add_takram_three_clouds.md`.


## Clouds and atmosphere

### Takram cloud textures

`<takram-clouds>` loads its weather, turbulence, shape, shape-detail, and STBN
defaults from `assetBaseUrl` (`/takram-clouds` by default). Applications using
those defaults must copy the `@takram/three-clouds` assets to that path.

Each texture can instead be supplied by the caller. Weather and turbulence
accept either a Three.js `Texture` or Takram `ProceduralTexture`; shape and
shape-detail accept either `Data3DTexture` or `Procedural3DTexture`. STBN accepts
`Data3DTexture`.

```ts
import { DestroyRef, inject } from '@angular/core';
import { LocalWeather } from '@takram/three-clouds';

readonly localWeather = new LocalWeather();

constructor() {
  inject(DestroyRef).onDestroy(() => this.localWeather.dispose());
}
```

```html
<takram-clouds [localWeatherTexture]="localWeather">
  <takram-cloud-layer channel="r" />
</takram-clouds>
```

Provided textures and procedural generators remain caller-owned and must be
disposed by the caller. Setting an input back to `undefined` restores the
component-owned default. The `/takram-clouds` demo shows default, custom
`DataTexture`, and Takram procedural weather sources.

### Takram atmosphere lights

Takram cloud shadows affect scene geometry through aerial-perspective
post-processing, not through Three.js shadow maps. For that composition mode,
render scene meshes as albedo with unlit materials, enable the composer's normal
pass, and enable aerial sun/sky lighting:

```html
<postprocessing-composer [enableNormalPass]="true">
  <takram-atmosphere>
    <mesh>
      <boxGeometry />
      <meshBasicMaterial [params]="{ color: '#b58b62' }" />
    </mesh>
    <takram-clouds [shadowCascadeCount]="1">
      <takram-cloud-layer channel="r" [shadow]="true" />
    </takram-clouds>
    <takram-aerial-perspective
      [sunLight]="true"
      [skyLight]="true"
      [cloudShadows]="true"
    />
  </takram-atmosphere>
</postprocessing-composer>
```

The composer supplies its view-space normal texture to effects that need it.
Disabling `cloudShadows` is a useful A/B check: direct illumination on the
geometry should brighten while the clouds remain visible.

Place the optional atmosphere-aware lights inside `<takram-atmosphere>` when
ordinary Three.js materials should receive the same sun and sky lighting as the
cloud and aerial-perspective effects:

```html
<takram-atmosphere>
  <takram-sun-light [intensity]="1.5" />
  <takram-sky-light [intensity]="0.7" />
  <!-- scene meshes, clouds, and aerial perspective -->
</takram-atmosphere>
```

`<takram-sun-light>` supports `intensity`, `distance`, `correctAltitude`, and
optional conventional Three.js `castShadow`. `<takram-sky-light>` supports
`intensity` and `correctAltitude`. Both use the enclosing atmosphere's lookup
textures, sun direction, and world/ECEF transform.

### Custom planet sizes

The default atmosphere uses Takram's Earth-sized model. For a spherical game
planet, set its radius and atmosphere thickness in the same world units used by
the scene (Takram's physical defaults use metres):

```html
<takram-atmosphere
  [planetRadius]="planet.radius"
  [atmosphereHeight]="planet.atmosphereHeight"
>
  <!-- clouds, lights, and aerial perspective -->
</takram-atmosphere>
```

Changing either value regenerates the atmosphere lookup textures and updates
the ellipsoid shared by clouds, aerial perspective, and atmosphere-aware
lights. The default local tangent frame keeps the planetary surface at `y = 0`.
Supply `worldToECEFMatrix` as well when the planet needs a custom position or
orientation. One atmosphere subtree represents one planet; scenes showing
several independently positioned atmospheric planets at once require separate
composition work and are not yet a verified use case.

Do not combine these real lights with aerial `sunLight`/`skyLight` on the same
unmasked objects; that applies lighting twice. Conventional `castShadow` and
`receiveShadow` remain a separate Three.js shadow-map path and do not make
Takram's cloud-shadow texture affect a standard material.

The Takram cloud adapter rejects non-WebGL/WebGL1 renderers, non-perspective
cameras, more than four layers, and shadow cascade counts outside 1–4. A failed
default texture load is reported through `TakramCloudsComponent.assetError` and
logged with the failing asset URL.
