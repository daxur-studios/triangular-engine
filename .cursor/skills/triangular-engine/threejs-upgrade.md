# Three.js Version Upgrade Checklist

Use this reference when updating the Three.js version used by `triangular-engine`.

## Source of truth

Treat the workspace root `package.json` and `projects/triangular-engine/package.json` as the primary versioned files:

- `package.json`
- `projects/triangular-engine/package.json`

The root workspace controls local development and build-time typing. The library package controls the published peer dependency expected from consumers.

## Files that usually need updating

### Required version updates

1. `package.json`

- Update `dependencies.three`
- Update `devDependencies.@types/three`
- Review `dependencies.three-mesh-bvh` for compatibility with the target Three.js release

2. `projects/triangular-engine/package.json`

- Update `peerDependencies.three`

3. `package-lock.json`

- Regenerate after dependency changes with `npm install`

### Documentation and guidance that should stay in sync

4. `projects/triangular-engine/README.md`

- Update the compatibility table
- Update any install snippets that mention the expected Three.js version

5. `projects/triangular-engine/docs/getting-started.md`

- Update install guidance if the recommended dependency set changes

6. `d:\code\triangular-workspace\.cursor\skills\triangular-engine\SKILL.md`

- Update the compatibility table and install snippets if the version expectation changes

7. `projects/triangular-engine/.agent/skills/triangular-engine/SKILL.md`

- Optional but recommended if you still use the project-local agent skill
- Keep it aligned with the Cursor skill to avoid conflicting guidance

## Code areas to review after the version bump

These files may not need manual edits every time, but they are the most likely to break if Three.js changes exports, example module paths, renderer APIs, or types.

### WebGPU and renderer integration

- `projects/triangular-engine/src/lib/engine/services/engine.service.ts`
- `projects/triangular-engine/src/lib/engine/models/engine.model.ts`

Review imports from:

- `three`
- `three/webgpu`
- `three/examples/jsm/renderers/*`
- `three/examples/jsm/controls/*`

### Post-processing wrappers

- `projects/triangular-engine/src/lib/engine/components/postprocessing/effect-composer/effect-composer.component.ts`
- `projects/triangular-engine/src/lib/engine/components/postprocessing/passes/abstract-pass.component.ts`
- `projects/triangular-engine/src/lib/engine/components/postprocessing/passes/glitch-pass.component.ts`
- `projects/triangular-engine/src/lib/engine/components/postprocessing/passes/output-pass.component.ts`
- `projects/triangular-engine/src/lib/engine/components/postprocessing/passes/shader-pass.component.ts`
- `projects/triangular-engine/src/lib/engine/components/postprocessing/passes/smaa-pass.component.ts`
- `projects/triangular-engine/src/lib/engine/components/postprocessing/passes/unreal-bloom-pass.component.ts`

These depend on `three/examples/jsm/postprocessing/*`, which is often where upgrade friction appears first.

### Other direct Three.js integration points

- `projects/triangular-engine/src/lib/engine/components/css/css-3d.component.ts`
- `projects/triangular-engine/src/lib/engine/components/object-3d/camera-helper.component.ts`
- `projects/triangular-engine/src/lib/engine/components/object-3d/raycast.ts`
- `projects/demo-app/src/app/app.component.ts`

### Asset path assumption to keep checking

- `node_modules/three/examples/jsm/libs/draco/`

This path is referenced in:

- `projects/triangular-engine/README.md`
- `projects/triangular-engine/docs/getting-started.md`
- `d:\code\triangular-workspace\.cursor\skills\triangular-engine\SKILL.md`
- `angular.json`

If Three.js changes the location or packaging of Draco assets, update all of those together.

## Recommended upgrade workflow

1. Pick the target `three` version.
2. Check compatibility for `@types/three` and `three-mesh-bvh`.
3. Update `package.json` and `projects/triangular-engine/package.json`.
4. Run `npm install` at the workspace root to refresh `package-lock.json`.
5. Build the library with `npm run build:triangular-engine`.
6. Build or run the demo app and verify post-processing, GLTF loading, Draco decoding, CSS renderers, orbit controls, and WebGPU/WebGL startup.
7. Update docs and skill references so the recorded supported version matches reality.

## Useful search patterns

Use these searches when upgrading:

- `three/examples/jsm`
- `three/webgpu`
- `from 'three'`
- `@types/three`
- `three-mesh-bvh`
- `0.181.0`
- `0.182.0`
- `0.183.0`
- `0.183.2`

## Current repo note

Last updated: Three.js `0.183.2`.

- `package.json` uses `three` `0.183.2`, `@types/three` `^0.183.1`, `three-mesh-bvh` `^0.9.9`
- `projects/triangular-engine/package.json` declares peer `three` `^0.183.0`
- All docs and skill text updated to reflect `^0.183.0`

When doing a future version bump, update the search patterns below by adding the new version number, and update this note.
