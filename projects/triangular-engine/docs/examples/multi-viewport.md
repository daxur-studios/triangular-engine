# Example: Multi-Viewport Rendering

Split a single scene into multiple camera viewports. Useful for split-screen effects, dual-monitor rendering, or picture-in-picture views.

Bind `[viewport]` (normalized `[x, y, width, height]`, `0-1`) on any `<camera>` or `<orbitControls>` inside a `<scene>` — the scene renders once per registered viewport camera, scissored into its rectangle. See [core-concepts.md](../core-concepts.md) for how `<scene>` owns rendering, and [components.md](../components.md#camera--controls) for the rest of the camera/controls API.

## Example: Rocket + Landing Pad (Side-by-Side)

```html
<scene>
  <!-- Left viewport: rocket camera (50% width) -->
  <camera 
    [position]="[0, 5, 10]" 
    [lookAt]="rocketPosition"
    [viewport]="[0, 0, 0.5, 1]">
  </camera>

  <!-- Right viewport: landing pad camera (50% width) -->
  <camera 
    [position]="landingPadCameraPos" 
    [lookAt]="landingPadPosition"
    [viewport]="[0.5, 0, 0.5, 1]">
  </camera>

  <!-- Single scene graph — both cameras see the same objects -->
  <rigidBody [position]="rocketPosition">
    <mesh><boxGeometry /><meshStandardMaterial /></mesh>
  </rigidBody>

  <rigidBody [position]="landingPadPosition">
    <mesh><boxGeometry /><meshStandardMaterial /></mesh>
  </rigidBody>
</scene>
```

## Example: 4-Way Split (Quadrants)

```html
<scene>
  <!-- Top-left: 25% each -->
  <camera [position]="[0, 5, 10]" [viewport]="[0, 0.5, 0.5, 0.5]" />

  <!-- Top-right: 25% each -->
  <camera [position]="[10, 5, 0]" [viewport]="[0.5, 0.5, 0.5, 0.5]" />

  <!-- Bottom-left: 25% each -->
  <camera [position]="[-10, 5, 0]" [viewport]="[0, 0, 0.5, 0.5]" />

  <!-- Bottom-right: 25% each -->
  <camera [position]="[0, 10, 0]" [viewport]="[0.5, 0, 0.5, 0.5]" />

  <!-- Scene content -->
</scene>
```

Splits don't have to be even — `[viewport]` is just rectangle math, so a main view plus stacked side panes is just picking different rects:

```html
<scene>
  <!-- Main view: 75% wide -->
  <camera [viewport]="[0, 0, 0.75, 1]" ... />

  <!-- Three stacked side panes, 25% wide -->
  <camera [viewport]="[0.75, 0.6667, 0.25, 0.3333]" ... />
  <camera [viewport]="[0.75, 0.3333, 0.25, 0.3333]" ... />
  <camera [viewport]="[0.75, 0,      0.25, 0.3333]" ... />
</scene>
```

## Example: Orbit Controls in Every Viewport

Each `<orbitControls [viewport]>` gets its own scoped input region — dragging inside one viewport only orbits that viewport's camera, independently of the others, no click-to-activate step needed.

```html
<scene>
  <orbitControls 
    [target]="[0, 0, 0]"
    [cameraPosition]="[0, 5, 10]"
    [viewport]="[0, 0, 0.5, 1]">
  </orbitControls>

  <orbitControls 
    [target]="[0, 0, 0]"
    [cameraPosition]="[0, 2, -15]"
    [viewport]="[0.5, 0, 0.5, 1]">
  </orbitControls>

  <!-- Scene content -->
</scene>
```

See the demo app's "Multi-Viewport Lab" page (`projects/demo-app/src/app/pages/multi-viewport-lab/`) for a working example that cycles single view → side-by-side → quadrants.

## Viewport Coordinates

Viewport is `[x, y, width, height]`, all normalized to `[0, 1]` range:

```
+---+---+
| 1 | 2 |   Quadrants:
+---+---+   [0,   0.5, 0.5, 0.5] = top-left
| 3 | 4 |   [0.5, 0.5, 0.5, 0.5] = top-right
+---+---+   [0,   0,   0.5, 0.5] = bottom-left
            [0.5, 0,   0.5, 0.5] = bottom-right

Origin (0, 0) is **bottom-left** (Three.js convention).
```

## Performance Notes

- ✅ **Single scene graph** — physics, lighting, and objects are shared across all viewports
- ✅ **One render call per camera** — efficient (not multiple canvases)
- ✅ **Aspect ratio auto-correction** — each viewport's camera aspect is updated automatically
- ✅ **Independent orbit input per viewport** — each `<orbitControls [viewport]>` gets its own scoped DOM overlay, so dragging in one viewport never affects another
- ❌ **Post-processing not supported** — `EffectComposer` can't easily apply to individual viewports

## Use Cases

| Use Case | Viewport Count | Notes |
|----------|---|---|
| Rocket + landing pad | 2 (side-by-side) | Shared physics, dual perspectives |
| Security camera system | 4+ (grid) | Main view + monitor feeds |
| Editor/viewport split | 2-4 | Different angles of same model |
| Minimap overlay | 2 (tiny + main) | Use `render-to-texture` instead for efficiency |
