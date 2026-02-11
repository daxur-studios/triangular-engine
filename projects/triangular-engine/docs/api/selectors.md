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
- `performanceMonitor`, `sceneTree`

## Engine UI

- `engine-ui`, `engine-stats`
- `[engineSlot]`, `[raycast]`

Notes:

- All components are standalone; import `EngineModule` for convenience.
- Many components accept common Object3D inputs: `position`, `rotation`, `scale`, `name`.
