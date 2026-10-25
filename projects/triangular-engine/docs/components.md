# Components Guide

All components are standalone and can be nested inside `<scene>`.

## Scene

```html
<scene> ...children... </scene>
```

- Hosts the renderer canvas, handles resize, and drives the render loop.
- `[wireframe]="true"` renders every mesh and line in the scene with a wireframe
  material for debugging; original materials are restored when set back to
  `false`. Objects added while enabled are picked up automatically. Points and
  sprites are skipped because they need their own material types.
- `[wireframeMode]="'uniform' | 'name-hash'"` (default `'uniform'`) chooses the
  coloring: `'uniform'` for a single shared green material, or `'name-hash'` for
  a deterministic per-object color hashed from each object's `name` (or `uuid`)
  with one cached material per color.

## Core 3D Nodes

- `<group>`: logical container (extends Object3D)
- `<mesh>`: renderable mesh
- `<points>`: point cloud
- `<sprite>`: screen-aligned sprite
- Helpers: `<gridHelper>`, `<arrowHelper>`

Example:

```html
<mesh [position]="[0,1,0]" [castShadow]="true">
  <boxGeometry [params]="[1,1,1]" />
  <meshStandardMaterial [params]="{ color: '#88c' }" />
</mesh>
```

## Geometry

- `<boxGeometry>`, `<sphereGeometry>`, `<planeGeometry>`
- `<bufferGeometry>` for custom geometries

See also: src/lib/engine/components/geometry/GEOMETRY.md

## Materials

- `<meshStandardMaterial>`, `<meshNormalMaterial>`, `<meshBasicMaterial>`
- `<shaderMaterial>`, `<rawShaderMaterial>`
- `<pointsMaterial>`

See also: src/lib/engine/components/materials/MATERIAL.md

## Lights

- `<ambientLight [intensity]="1" [color]="'#fff'" />`
- `<directionalLight [position]="[3,5,2]" [castShadow]="true" />`
- `<pointLight />`

See also: src/lib/engine/components/light/LIGHT.md

## Camera & Controls

- `<camera [isActive]="true" [lookAt]="[0,0,0]" />`
- `<orbitControls [isActive]="true" [target]="[0,0,0]" [cameraPosition]="[0,2,5]" />`
- `[viewport]` on either one splits the scene into multiple simultaneous camera rectangles (split-screen); see [examples/multi-viewport.md](./examples/multi-viewport.md)

## GLTF

```html
<gltf [gltfPath]="'assets/models/scene.glb'" [enableBVH]="true" />
```

- `enableBVH` computes per-mesh BVH for fast raycasting.

## CSS2D / CSS3D

- `<css2d>` and `<css3d>` overlay HTML elements in 3D

## Keyboard

- `<keyboardControls>` exposes a minimal keyboard control component

## Post-Processing (WebGL)

Declarative EffectComposer with pass components. Place inside `<scene>`:

```html
<effect-composer>
  <unrealBloomPass [strength]="1.2" [radius]="0.4" [threshold]="0.85" />
  <glitchPass [goWild]="false" />
  <smaaPass />
  <outputPass />
</effect-composer>
```

Passes: `unrealBloomPass`, `glitchPass`, `outputPass`, `smaaPass`, `shaderPass`. Order matters; `outputPass` should typically be last.

## Features

- Environment: `<skyBox>`, `<ocean>`
- Performance monitor: `<performanceMonitor>`

## Component overview


All components are standalone and can be nested inside `<scene>`.

- `scene`: hosts the renderer canvas, handles resize, and drives the render loop
- Core nodes: `group`, `mesh`, `points`, `sprite`, `gridHelper`, `arrowHelper`
- Post-processing: `effect-composer`, `unrealBloomPass`, `glitchPass`, `outputPass`, `smaaPass`, `shaderPass`
- Geometry: `boxGeometry`, `sphereGeometry`, `planeGeometry`, `bufferGeometry`, `capsuleGeometry`, `bufferAttribute`
- Materials: `meshStandardMaterial`, `meshNormalMaterial`, `meshBasicMaterial`, `shaderMaterial`, `rawShaderMaterial`, `pointsMaterial`, `spriteMaterial`
- Lights: `ambientLight`, `directionalLight`, `pointLight`
- Camera & Controls: `camera`, `orbitControls` (bind `[viewport]` for split-screen multi-camera rendering — see [examples/multi-viewport.md](examples/multi-viewport.md))
- GLTF: `gltf`
- Audio: `audioListener`, `positionalAudio`, `ambientAudio`, `audioSource` (see [audio.md](audio.md))
- CSS: `css2d`, `css3d`
- Physics: `physics`, `rigidBody`, `collider` family, `fixedJoint`, `sphericalJoint`, `instancedRigidBody`
- Features & UI: `skyBox`, `ocean`, `performanceMonitor`, `sceneTree`, `engine-ui`, `engine-stats`, `portalOutlet`, `[portalTarget]`, `[raycast]`

Example mesh:

```html
<mesh [position]="[0,1,0]" [castShadow]="true">
  <boxGeometry [params]="[1,1,1]" />
  <meshStandardMaterial [params]="{ color: '#88c' }" />
  <!-- or <meshStandardMaterial [map]="'assets/textures/wood.jpg'" /> -->
  <!-- or <meshNormalMaterial /> -->
  <!-- or <shaderMaterial /> -->
  <!-- or <rawShaderMaterial /> -->
  <!-- or <pointsMaterial /> -->
  <!-- or <spriteMaterial /> -->
</mesh>
```

## GLTF Loading

```html
<gltf [gltfPath]="'assets/models/thing.glb'" [enableBVH]="true" />
```

- `enableBVH`: builds per-mesh BVH using `three-mesh-bvh` for faster raycasts
- Optional `cachePath`: custom key for the in-memory GLTF cache
