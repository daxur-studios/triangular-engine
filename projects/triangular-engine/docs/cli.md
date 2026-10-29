# Triangular CLI

The `triangular` command groups project-document tools and the existing browser-testing tools. It
operates on the current working directory by default; use `--root <directory>` to target another
project. The documentation commands use Node.js and Markdown files and do not require Angular or
Three.js to run.

## Install and run

After a release that includes the CLI, install the package globally:

```sh
npm install --global triangular-engine
triangular --help
```

Inside this source workspace, run the same command through npm:

```sh
npm run triangular -- docs consensus new --slug terrain-rendering --title "Terrain rendering" --question "Which approach should we test?"
```

To operate on another project, pass its root:

```sh
triangular docs consensus list --root D:\code\some-project
```

## Consensus reviews

Create one numbered review per engineering decision. Reviews use a separate `C001` sequence under
`docs/consensus/`; a stable slug makes creation idempotent. Link a review to a Plan or Engineering
Record when one exists. Multiple agents and rounds belong in the same review file.

```sh
triangular docs consensus new \
  --slug terrain-rendering \
  --title "Terrain rendering" \
  --question "Which approach should we prototype?" \
  --plan /docs/plans/071_example.md
```

Creation adds an entry to `docs/consensus/index.md`. Repeating the same command returns the existing
file unchanged. Reusing its slug with a different title or question reports a conflict; it never
replaces recorded contributions.

Complete the shared brief in the generated file before asking agents. The first generated prompt
freezes its SHA-256 fingerprint. Later prompts use the same brief; if it changes, start a new review
so the original responses remain attached to the context they received.

```sh
triangular docs consensus prompt C001 --participant sol --round 1 > sol-prompt.md
triangular docs consensus add-response C001 --participant sol --model gpt-6.1-sol --round 1 --response-file sol-response.md
triangular docs consensus prompt C001 --participant terra --round 2
triangular docs consensus check C001
```

Round-one prompts contain only the shared brief. Round two is available after at least two first-round
responses and includes those responses for targeted critique. Repeating an identical response update
is a no-op. A changed response requires explicit `--replace`.

A review may conclude with `recommended`, `contenders`, `needs-evidence`, or `unresolved`. When an
experiment or spike is needed, record its owner and success/failure criteria in the review. Agent
agreement is not a developer decision; record the developer decision separately.

The CLI creates prompts and records responses; it does not launch AI models. Use the
[`triangular-cli` skill](../skills/triangular-cli/SKILL.md) for the agent workflow.

## Plans, Engineering Records and testing

The existing document helper is available under the same command:

```sh
triangular docs records new --title "Water scattering" --slug water-scattering
triangular docs records check
triangular docs plan new --title "Water scattering" --slug water-scattering
```

`docs records new` and its `docs plan new` alias create the reciprocal pair and update its indexes.
If a project has no plan or Engineering Record index yet, creation scaffolds both from the packaged
templates; existing indexes are preserved and extended. Other record operations (`next`, `review`,
`baseline`, `manifest`) are forwarded to the existing helper. Its retention and explicit-baseline rules
still apply.

The testing commands delegate to the package's existing tools:

```sh
triangular testing run --url http://localhost:4200/lab --suite my-suite --version 1
triangular testing summary --suite my-suite --last 3
triangular testing receiver
triangular testing baseline saved-result.json > baseline.json
```

The existing `triangular-test-run`, `triangular-test-summary`, `triangular-test-receiver`, and
`triangular-test-baseline` binaries remain available.

## Current command coverage

The `docs` family currently supports consensus reviews and the paired Plan/Engineering Record helper.
The namespace is designed to add other document types, such as spikes and examples, after their
shared format is defined. Use `triangular --help` for the installed command set.
