# triangular-engine/terrain

Domain-aware terrain sampling, patch generation, LOD streaming, and reusable
plane/sphere terrain primitives.

Import terrain APIs from `triangular-engine/terrain`; do not reach into the
package's internal folders.

The entry point is independent from physics. Add the Jolt adapter from
`triangular-engine/jolt` only when terrain colliders are required.

Current design and implementation gates are tracked in
[`docs/runbook/004_multi_surface_terrain.md`](../../../docs/runbook/004_multi_surface_terrain.md).
