[Back](../COMPONENTS.md)

# Lights

Triangular Engine includes standard Three.js lighting components along with advanced Cascaded Shadow Maps (CSM):

- `<ambientLight>` — Omnidirectional ambient fill light.
- `<directionalLight>` — Directional sunlight with single-frustum orthographic shadows and `[shadowFollow]` tracking.
- `<pointLight>` — Omnidirectional point light with radial attenuation.
- `<csm>` — High-performance multi-cascade shadow map sun rig with frustum depth partitioning, adaptive planetary scaling, and live debug visualizers.
- `[csmReceiver]` — Directive for selective mesh shadow receiver opt-in/opt-out.
