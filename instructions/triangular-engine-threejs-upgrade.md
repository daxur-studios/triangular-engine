# Triangular Engine Three.js Upgrade Checklist

Use this maintainer checklist when changing the Three.js version used by the
workspace or published library.

## Source of truth

Keep these in sync:

- `package.json` (`three`, `@types/three`, `three-mesh-bvh`)
- `projects/triangular-engine/package.json` peer dependency
- `package-lock.json`
- `projects/triangular-engine/README.md`
- `projects/triangular-engine/docs/getting-started.md`
- `projects/triangular-engine/.agent/skills/triangular-engine/SKILL.md`

Also verify the Draco asset path in `angular.json` and the documentation.

## High-risk review

Review renderer/WebGPU integration, post-processing wrappers, CSS3D, camera
helpers, raycasting, demo startup, GLTF loading, and Draco decoding. Search
for `three/examples/jsm`, `three/webgpu`, `from 'three'`, and the old/new
version numbers.

## Verification

Update dependencies and the lockfile, then run:

```powershell
npm run build:triangular-engine
```

Build or run the demo and check WebGL/WebGPU startup, post-processing, GLTF,
Draco, CSS renderers, and orbit controls.

Current workspace baseline: Three.js `0.183.2`; library peer range
`^0.183.0`.
