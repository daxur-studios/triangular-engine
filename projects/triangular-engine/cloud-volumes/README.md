# Cloud volumes and planet clouds

Import `PlanetCloudsComponent` and `PlanetCloudShell` from `triangular-engine/cloud-volumes`. The entry also provides bounded 3D cloud volumes. The planet shell is a procedural 2D layer and needs `WebGPURenderer`.

Inside `<planet>`, add `<planetClouds [coverage]="0.45" />` alongside the terrain. It inherits the planet radius, sun and morph unless explicitly supplied. `shell()` exposes the `PlanetCloudShell` once the component has started.

## Cloud sampling and ground shadows

`shell.coverageAt(direction)` returns a TSL float node from 0 to 1, sampling the same procedural coverage as the visible shell. The `vec3` direction is in the planet's unbent body frame, measured from its centre; it is normalised by the method. Coverage, softness, scale and drift use the shell's live uniforms.

`shell.groundShadowAt(radialDirection, strength)` returns a TSL float node for the fraction of direct sunlight left after the clouds. Strength defaults to 1; use 0 for no shadow. Full cloud at strength 1 leaves 0.15. For atmosphere lighting, install the stage after the surface, atmosphere and shell are ready:

```ts
surface.setLightingStage({
  id: 'atmosphere',
  stage: atmosphere.binding.lighting({
    directShadow: (context) => shell.groundShadowAt(context.radialDirection),
  }),
});
// On cleanup: surface.setLightingStage(null).
```

Disable the atmosphere component's automatic lighting (`[lighting]="false"`) when installing this stage yourself. Use the radial direction, not the slope-dependent shading normal. Shadows sample where a sun ray from the planet radius crosses the shell; terrain elevation is an approximation, and the projection follows the unbent globe during morphing. The shell's camera and morph fades or its `enabled` flag do not automatically disable this separate lighting stage; manage its strength or installation when needed.
