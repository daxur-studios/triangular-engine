---
description: Clone the demo-app spike template into a new falsifiable spike
---

Create a new demo-app spike from `projects/demo-app/src/app/_spike-template/`.

The spike name is: $ARGUMENTS

If no name was given, ask for one before doing anything else. The name must
be a short kebab-case description of the mechanism under test, WITHOUT a
trailing `-spike` (you add that yourself) — e.g. `voxel-chunk-mesher`, not
`voxel-chunk-mesher-spike` or `VoxelChunkMesher`.

Read `projects/demo-app/src/app/AGENTS.md` first — it explains why every
spike must start from this template instead of a blank component (a prior
spike hand-rolled its own renderer/camera/rAF loop instead of using
`<scene>`, which cost real debugging time). Do not skip or shortcut the
rules in that file.

## Steps

1. Derive names from the kebab-case input `<name>`:
   - Folder: `<name>-spike`
   - File basenames: `<name>-spike.component.ts` / `.html` / `.scss`
   - Component class: `<PascalCase(name)>SpikeComponent`
   - Selector: `app-<name>-spike`
   - `core/` factory file: `create-<name>-spike-scene.ts`
   - Factory function: `create<PascalCase(name)>SpikeScene`
   - Handle/diagnostics interfaces: `I<PascalCase(name)>SpikeSceneHandle`,
     `I<PascalCase(name)>SpikeDiagnostics`

2. Copy the whole `_spike-template/` folder to `projects/demo-app/src/app/<name>-spike/`,
   including `core/`. Do not copy the leading-underscore folder itself into
   the new name — only its contents.

3. Rename files and apply the token substitutions above across every copied
   file:
   - `spike-template` → `<name>-spike` (paths, imports, selector)
   - `SpikeTemplate` → `<PascalCase(name)>Spike`
   - `create-spike-template-scene` → `create-<name>-spike-scene`
   - `createSpikeTemplateScene` → `create<PascalCase(name)>SpikeScene`

4. Update the new component's class-doc comment: replace the generic
   "TEMPLATE — ..." header with a real one-line description of the
   hypothesis this spike falsifies (ask the user if it isn't already clear
   from the name/context — do not invent a hypothesis you're unsure about).

5. Register the route in `projects/demo-app/src/app/app.routes.ts`, mirroring
   the existing `gpu-morph-lod-spike` entry (lazy `loadComponent`), inserted
   near the other `*-spike` routes.

6. Add an entry to `SPIKES` in
   `projects/demo-app/src/app/pages/spikes-index/spikes-index.component.ts`:
   `id`, `number` (next sequential spike number), `title`, `route`,
   `status: 'pending'`, `hypothesis`, `description`, `runbookPath` (ask the
   user which runbook doc this spike belongs to, if any — do not guess),
   `dateISO` (today).

7. Replace the placeholder mechanism in the new `core/create-<name>-spike-scene.ts`
   with a short `TODO` comment describing what needs to be built, rather
   than leaving the rotating-box placeholder in place unremarked — the user
   will implement the actual mechanism next.

8. Verify with `npx ng build demo-app --configuration development`. Report
   the new folder path and route back to the user; do not start implementing
   the spike's actual mechanism unless asked.
