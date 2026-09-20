# Triangular engine package boundaries

Code imported by a web worker must come from a framework-free secondary entry
point. Angular CLI's worker bundler uses synchronous esbuild and does not run the
Angular linker, so partially compiled Angular declarations from the root,
`terrain`, or `worldgen/render` entries can crash at worker module evaluation.

Keep worker-safe helpers physically inside their entry directory so ng-packagr's
per-entry `rootDir` owns them. The supported worker entries are:

- `triangular-engine/terrain/core`
- `triangular-engine/worldgen/render/core`

Those entries may depend on Three.js-free TypeScript and standard platform APIs,
but must not import Angular, the engine root, or their Angular-bearing parent
entry. Angular entries may depend on these pure entries. Existing parent exports
are compatibility exports; new worker code must use the pure subpaths directly.

When adding a helper used by a worker, add it to the appropriate pure entry,
preserve the dependency direction, and verify the packed package contains no
`ɵɵngDeclare*` declarations or Angular modules for a representative worker
import.
