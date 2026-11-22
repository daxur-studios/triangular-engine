# brep-poc — brepjs × triangular-engine

A parametric bracket built on an exact B-Rep kernel, rendered in an engine scene.
Sliders rebuild it, and the same solid exports as STEP and STL.

See [ER 089](../../docs/engineering-records/089_brepjs_poc.md) for findings and
[PLAN-089](../../docs/plans/089_brepjs_poc.md) for the intent.

**Handing this to another agent session?** Give it
[`AGENT-BRIEF.md`](AGENT-BRIEF.md) — contract, commands, references and the
known failure modes in one file.

```
npm run serve:brep-poc     # http://localhost:4228
npm run verify:brep-poc    # the CAD gate: kernel measurements, not the viewport
```

## The part is the artifact

`src/app/part/bracket.brep.ts` is a `brep` part, not an Angular module:

- `export default (p) => shape` — the function `brep` runs.
- `params` from `defineParams` — the sliders in this app are generated from it,
  so the panel cannot drift from the declaration.
- `expected` — the dimensions the part must measure. A part that builds but is
  the wrong size fails.

`src/app/part/bracket-render.ts` is the only app-side geometry work
(tessellation, volume, export closures). It consumes the verified solid, so the
part that renders and the part that is measured are the same object.

**Treat a `brep verify` report that is not `ok` as a failure even when the app
still renders.** The first version of this part drew perfectly and was not a
valid solid.

## Where the authoring material lives

Nothing here is vendored. All of it is upstream and public:

| What | Where |
| --- | --- |
| The five authoring skills (`brainstorm`, `design`, `implement`, `verify`, `polish`) | `packages/brepjs-cad/skills/` in [andymai/brepjs](https://github.com/andymai/brepjs) — not shipped in the npm package, only through the Claude Code plugin marketplace |
| Full API reference (every export, with signatures) | `node_modules/brepjs-cad/reference/llms-full.txt` after `npm install` |
| The verifier | `npx -y -p brepjs-cad brep verify <file> --check` (installed here as `npm run verify:brep-poc`) |
| MCP server (`run_program`, `export_part`) | `npx -y --package brepjs-cad brep-mcp` |
| Integration guide | [brepjs.dev/agent/overview](https://brepjs.dev/agent/overview) |

An installed skill costs one description line of prompt until it is invoked, so
the bodies only load on demand. Install them per provider, per machine — none
of that belongs in this repository.

### One-time setup, per provider

**Claude Code** (user-level, not repo-level):

```bash
claude plugin marketplace add andymai/brepjs
claude plugin install brepjs@brepjs
```

**OpenCode** — point a *local, uncommitted* config at a brepjs checkout:

```jsonc
// opencode.jsonc (git-ignored)
{ "skills": ["<path-to-brepjs>/packages/brepjs-cad/skills"] }
```

or copy the skill folders into `~/.config/opencode/skills/` for every project.

**Codex / Antigravity** have no skill loader. They read `AGENTS.md` and can be
pointed at the same files by path, which is why the part contract and the
verify command live in `AGENTS.md` rather than in a skill.

Keep `<path-to-brepjs>` out of anything committed: this repo is public, and a
machine-specific path is not part of the project.
