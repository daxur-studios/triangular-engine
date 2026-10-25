# API Reference: Selectors

List of component selectors you can use in templates.

## Core

- `scene` — Scene host
- `object3d` — Base class (not used directly)
- `group` — Group container
- `mesh` — Mesh node
- `points` — Points node
- `sprite` — Sprite node
- `primitive` — Low-level primitive wrapper
- `gridHelper`, `arrowHelper`

## Camera & Controls

- `camera` — Perspective camera
- `orbitControls` — Orbit controls with internal camera

## Geometry

- `bufferGeometry` — Base geometry
- `boxGeometry`, `sphereGeometry`, `planeGeometry`
- `capsuleGeometry`
- `bufferAttribute`

## Materials

- `material` — Base material
- `meshStandardMaterial`, `meshNormalMaterial`, `meshBasicMaterial`
- `shaderMaterial`, `rawShaderMaterial`
- `pointsMaterial`, `spriteMaterial`

## Lights

- `light` — Base light
- `ambientLight`, `directionalLight`, `pointLight`

## GLTF

- `gltf`

## CSS Renderers

- `css2d`, `css3d`

## Physics

- `physics` — Physics world wrapper
- `rigidBody` — Rapier rigid body
- `collider` — Base collider
- `cuboidCollider`, `ballCollider`, `capsuleCollider`, `cylinderCollider`, `coneCollider`
- `fixedJoint`, `sphericalJoint`
- `instancedRigidBody`

## Post-Processing

- `effect-composer` — EffectComposer wrapper
- `unrealBloomPass`, `glitchPass`, `outputPass`, `smaaPass`, `shaderPass`

## Features

- `skyBox`, `ocean`
- `performanceMonitor`
- `sceneTree` — optional Material UI from `triangular-engine/scene-tree`; use `provideSceneTree()` for the scene's built-in inspection panel.

## Engine UI

- `engine-ui`, `engine-stats`, `telemetry-sparkline`
- `[engineSlot]`, `[raycast]`

Notes:

- All components are standalone; import `EngineModule` for core components and the relevant secondary entry point for optional integrations.
- Many components accept common Object3D inputs: `position`, `rotation`, `scale`, `name`.

## Quick reference: template selectors


List of selectors available in templates (not exhaustive):

- Core: `scene`, `group`, `mesh`, `points`, `sprite`, `primitive`, `gridHelper`, `arrowHelper`
- Post-processing: `effect-composer`, `unrealBloomPass`, `glitchPass`, `outputPass`, `smaaPass`, `shaderPass`
- Camera & Controls: `camera`, `orbitControls`
- Geometry: `bufferGeometry`, `bufferAttribute`, `boxGeometry`, `sphereGeometry`, `planeGeometry`, `capsuleGeometry`
- Materials: `material`, `meshStandardMaterial`, `meshNormalMaterial`, `meshBasicMaterial`, `shaderMaterial`, `rawShaderMaterial`, `pointsMaterial`, `spriteMaterial`
- Lights: `light`, `ambientLight`, `directionalLight`, `pointLight`
- GLTF: `gltf`
- Audio: `audioListener`, `positionalAudio`, `ambientAudio`, `audioSource`
- CSS Renderers: `css2d`, `css3d`
- Physics: `physics`, `rigidBody`, `collider` family, `cuboidCollider`, `ballCollider`, `capsuleCollider`, `cylinderCollider`, `coneCollider`, `fixedJoint`, `sphericalJoint`, `instancedRigidBody`
- Features & UI: `skyBox`, `ocean`, `performanceMonitor`, `sceneTree`, `engine-ui`, `engine-stats`, `portalOutlet`, `[portalTarget]`, `[raycast]`

