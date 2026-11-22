# CAD agent brief — modelling parts for a game

A self-contained briefing for an agent session (Codex, Claude Code, OpenCode,
Antigravity, anything with a shell) that has to model a part for a game built
on Triangular Engine. Hand it the file, or paste the kickoff prompt and point at
the paths below.

## Kickoff prompt

> You are modelling a manufacturable part for a game. Use `brepjs` on an exact
> B-Rep kernel, author it as a `.brep.ts` part, and verify it with the `brep`
> CLI. Judge your work by the JSON report the kernel returns, never by how the
> code reads — you cannot see geometry. Read
> `projects/brep-poc/AGENT-BRIEF.md` in this repo for the contract, the commands
> and the known failure modes, and `projects/brep-poc/src/app/part/bracket.brep.ts`
> for a complete example. Do not finish until `brep verify` reports `ok: true`
> and prints a measured volume and bounds.

## The contract

A part is one TypeScript module. Three exports, one default:

```ts
import { box, cylinder, cut, defineParams, unwrap } from 'brepjs';

export const params = defineParams({
  width: { type: 'number', default: 120, min: 60, max: 200, step: 1, unit: 'mm', label: 'Width' },
});

export const expected = (p = params.values) => ({
  bounds: { xMin: -p.width / 2, xMax: p.width / 2, yMin: -40, yMax: 40, zMin: -4, zMax: 4 },
  tolerancePct: 0.5,
});

export default (p = params.values) => {
  const plate = box(p.width, 80, 8, { centered: true });
  // A 20 mm drill based at z = -10 pokes out both faces, so the bore goes through.
  return unwrap(cut(plate, cylinder(4, 20, { at: [0, 0, -10] })));
};
```

- **Units are millimetres, and the build is Z-up.** Convert at the engine
  boundary, not inside the part.
- `box(width, depth, height)` — depth is Y, height is Z. Bare `box` is
  corner-at-origin; `{ centered: true }` centres on the origin; `{ at: [x,y,z] }`
  centres there. `cylinder` `at` is the base centre; `sphere` `at` is its centre.
- Booleans and measurements return `Result`: `unwrap()` them, at every step
  including the final return.
- Transforms are free functions, shape-first: `translate(shape, [x,y,z])`,
  `rotate(shape, degrees, { axis })`.
- `params` exists so a tool can build sliders and `--param width=80` without
  touching the file. `expected` is the test: `bounds` and/or `volume`, plus
  `tolerancePct`. Prefer `bounds` — a hand-computed `volume` fails a correct part.
- A fillet only removes material, so it never moves a bounding face.

## Commands

```bash
npm i -D brepjs-cad                      # the `brep` CLI + API reference + MCP server
npx brep init bracket                    # scaffold a parameterised part
npx brep verify bracket.brep.ts --check  # type-check, then run on the kernel
npx brep watch bracket.brep.ts           # re-verify on save
npx brep verify bracket.brep.ts --param width=80 --json report.json
npx brep verify bracket.brep.ts --step bracket.step   # exact CAD deliverable
npx brep export bracket.brep.ts --all --out dist/     # STEP + GLB + STL, gated
npx brep verify bracket.brep.ts --snapshot shots/     # iso/front/top/right PNGs
```

The report is the truth:

- `ok` — false means not done, even if the part builds.
- `checks` — kernel validity (manifold, positive volume). A failed check means
  broken geometry, not wrong size.
- `measurements` — volume, area, bounds, centre of mass.
- `assertions` — your declared intent against what was measured.
- `hints` / `errorInfos` — the error code and its fix. Read these before guessing.

Change the smallest responsible thing, re-verify, repeat. A part that runs but
reports `ok: false` is a failure, not a warning.

## References, in order of usefulness

| What | Where |
| --- | --- |
| Full API, every export with signatures | `node_modules/brepjs-cad/reference/llms-full.txt` |
| Authoring skills (`brainstorm`, `design`, `implement`, `verify`, `polish`) | `packages/brepjs-cad/skills/` in [andymai/brepjs](https://github.com/andymai/brepjs) — not in the npm package |
| Worked examples, one per shape family | same folder, `brepjs-implement/examples/*.brep.ts` and `.expected.json` |
| Verify loop, report format, repair discipline | [brepjs.dev/agent/the-loop](https://brepjs.dev/agent/the-loop) |
| CLI flags and exit codes | [brepjs.dev/agent/cli](https://brepjs.dev/agent/cli) |
| MCP server (`run_program`, `export_part`) | `npx -y --package brepjs-cad brep-mcp` |

Skills install per provider and per machine, never into the game repo:

- **Claude Code:** `claude plugin marketplace add andymai/brepjs` then
  `claude plugin install brepjs@brepjs`.
- **OpenCode:** a local, uncommitted `opencode.jsonc` with
  `{ "skills": ["<path-to-brepjs>/packages/brepjs-cad/skills"] }`.
- **Codex / Antigravity:** no skill loader — give them the file paths above, or
  rely on this brief plus the CLI.

An installed skill costs one description line of prompt until invoked.

## Known failure modes (measured, not guessed)

- **Filleting "every edge in a direction" is a trap.** `edgeFinder().inDirection('Z')`
  also matches bore seam edges and neighbouring bodies' corners; blending them
  returns a solid that fails `isValidSolid` while looking perfect. Select the
  exact edges by position with `getBounds`, and check the report.
- **Fillet radius has a ceiling of roughly one local wall thickness** (7 mm on
  an 8 mm plate validates, 8 mm does not). Try the requested radius, then fall
  back and say so.
- **A through-hole needs a tool proud of both faces**, or you get a blind pocket
  that still validates.
- **`chamfer` is fragile.** Prefer `fillet`, or model the bevel additively.
- **Shapes are WASM memory; the GC does not free them.** In a long-running or
  rebuild-on-input path use `withScope` for intermediates and `delete()` the
  shape you drop.
- **`brepjs` 20.x is not the 4.x API.** `init()` + `box()`/`cut()` vs
  `initFromOC()` + `makeBaseBox()`/`cutShape()`. Pin the version.

## Decorative assemblies

- **Reuse a few sculpted pieces.** The space buns use lofts through oriented
  sections for the fringe, locks and buns. Mirror paired pieces and adjust their
  placement independently. Overlapping decorative solids can stay separate in
  the CAD assembly. Fit them on the actual character and inspect the front,
  side and back before tuning variants.
- **Check the baked mesh as well as the CAD bodies.** One meshing setting
  reduced valid buns to tiny patches. Compare each body's mesh bounds with its
  CAD bounds, then load the saved GLB on the actual head. The bake retries with
  a finer setting if a body loses coverage.
- **Use the attachment's local coordinates.** The space-buns bake uses 100 CAD
  mm per unscaled workshop head unit. Its GLB exporter already adds the Y-up
  rotation.

See the [space-buns bake](studies/capsule-space-buns/build.mjs) and the
[study notes and commands](../../docs/engineering-records/074_procedural-character-studio.md#2026-11-22--parametric-brep-space-buns).

## What the game needs back

The part must hand over to the engine, which works in **metres, Y-up**:

- `rotateX(-π/2)` then `scale(0.001)` — that is the whole conversion, do it once
  at the boundary.
- Deliver a triangulated mesh (`--glb` for the engine, `--stl` for a slicer,
  `--step` as the exact source of truth) plus measured `bounds`, `volume` and
  centre of mass for colliders and mass.
- **The 20 MB OpenCascade kernel is a build-machine dependency, not a runtime
  one.** For a shipped game, bake parts to GLB and load the asset; only load the
  kernel in-app if the player is genuinely authoring geometry live.

Reference numbers from a POC part (120×80×8 mm plate, flange, two 9 mm holes,
4 mm fillets): ~100 ms per rebuild, ~1,700 triangles at 0.08 mm tolerance,
STEP 57 kB, STL 325 kB.

## Brief template — fill this in before modelling

```
Part:            <name, what it is for in the game>
Overall size:    <mm, or the range if it should be parametric>
Features:        <every feature, with a count — "two M4 through-holes", not "some holes">
Interface:       <what it mates with: hole sizes/spacing, flat faces, datums>
Units/axes:      mm and Z-up while building
Style:           <filleted? chamfered? minimal? matches an existing asset?>
Export needed:   glb for the engine, step for the record, stl for print checks
Must be true:    <the assertions: overall bounds, volume, hole spacing>
Out of scope:    <what not to model>
```

## Done checklist

- [ ] `brep verify <part>.brep.ts --check` reports `ok: true`.
- [ ] Report shows the expected bounds (and volume, if declared) and a positive
      volume. Verify the intended body count and validity of each body.
- [ ] Green at the parameter extremes, not only at defaults.
- [ ] `--snapshot` viewed: it is the part the brief describes, not a generic blob.
- [ ] Exported the formats the game needs, and reported their paths.
