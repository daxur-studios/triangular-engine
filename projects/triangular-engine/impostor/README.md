# triangular-engine/impostor

GPU-billboarded octahedral impostors for distant scenery (forests, rock
fields, anything scatter renders thousands of).

Import from `triangular-engine/impostor`; do not reach into the package's
internal folders.

## How it works

1. **Bake** — `createOctahedralImpostorAtlas()` renders a target `Object3D`
   from a grid of camera directions covering the upper hemisphere (a tree
   is essentially never seen from below), packing the results into a single
   albedo texture and a single normal+depth texture arranged as a
   `spritesPerSide × spritesPerSide` grid of views.
2. **Render** — `buildOctahedralImpostorMesh()` builds a camera-facing quad
   whose material (patched via `onBeforeCompile` from any real material type,
   e.g. `MeshStandardMaterial`, so it still receives scene lighting) picks
   the 3 baked views nearest the current camera direction and blends them
   with barycentric weights — no popping as the camera orbits.

Baking can run at runtime (app startup, or lazily on first use) or once
offline: `exportOctahedralImpostorAtlas()` downloads a baked atlas as a PNG
so a game can ship it as a static asset and skip baking entirely at load
time — both paths share the exact same bake + render code, so there is no
separate "pre-baked" format to keep in sync.

Only the hemispherical octahedral projection is implemented (matching what
the reference three.ez implementation this was ported from actually
finished) — this covers every scatter use case, since the camera is never
below the ground plane relative to a tree/rock.
