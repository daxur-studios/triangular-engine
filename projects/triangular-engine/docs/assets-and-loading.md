# Assets & Loading

## Draco Setup

Add to `angular.json` assets:

```json
{
  "glob": "**/*",
  "input": "node_modules/three/examples/jsm/libs/draco/",
  "output": "draco/"
}
```

## GLTF

```html
<gltf [gltfPath]="'assets/models/thing.glb'" [enableBVH]="true" />
```

- Optional `cachePath` to key the in-memory cache differently
- When `enableBVH` is true, each mesh geometry computes BVH for faster raycasts

## Textures

Use `meshStandardMaterial` and pass `map` for automatic loading:

```html
<meshStandardMaterial [map]="'assets/textures/wood.jpg'" />
```

Or load via `LoaderService.loadAndCacheTexture`.

## Export/Other Loaders

`LoaderService` also exposes `BufferGeometryLoader`, `ObjectLoader`, `SVGLoader`, `STLLoader`, `FBXLoader`, `GLTFExporter` if you need direct access.
