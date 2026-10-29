---
name: triangular-cli
description: Use the triangular CLI for project documents, consensus reviews, and browser testing commands.
---

# Triangular CLI Skill

Use this skill when a project has the `triangular` command and the task involves creating Plans,
Engineering Records, consensus reviews, or running the engine's browser testing tools. The CLI can
target a non-Triangular project with `--root`; its Markdown authoring commands do not depend on
Angular or Three.js.

## Command families

- `triangular docs consensus ...` creates, prompts, updates and checks consensus review files.
- `triangular docs records ...` creates or validates paired Plans and Engineering Records.
- `triangular docs plan new` is an alias for creating a paired Plan and Engineering Record.
- `triangular testing ...` delegates to the existing test runner, summary, receiver and baseline tools.

Read `docs/cli.md` in the installed package for arguments and examples. Preserve direct
`triangular-test-*` aliases for existing workflows.

## Consensus review workflow

1. Create one review per significant decision with `triangular docs consensus new`. Supply a stable
   slug, title, precise question and any Plan/ER links. The command assigns a `Cnnn` ID and creates
   the index entry. If the slug already exists with the same title and question, it returns that
   file unchanged; if the inputs differ, stop and inspect the existing review.
2. Read relevant plans, Engineering Records, prior attempts, code and evidence. Fill the shared brief
   in the review before asking participants. Keep hard constraints, preferences, assumptions and
   non-goals distinct. Include source links and actual test evidence where available.
3. Generate each participant's round-one prompt from the same frozen brief. Ask participants to
   answer independently; do not show them other answers. Record the actual model identity or
   `unknown`. The CLI freezes the brief when the first round-one prompt is generated.
4. Record attributed answers with `triangular docs consensus add-response`. The command preserves
   each participant's response and refuses accidental replacement; exact repeats are no-ops.
5. Synthesize shared points, disagreements, assumptions and viable options. Only say participants
   agree on a point when their responses support that claim. Silence, similar language or a majority
   of models is not proof of correctness or developer approval.
6. Use round two only for material disagreements or consequential assumptions. It should identify
   evidence, changed minds and remaining dissent. If evidence is required, specify the smallest useful
   spike, its owner, and explicit success/failure criteria. Stop debating when an experiment is the
   next source of information.
7. Record one outcome: recommendation, contenders, needs-evidence, or unresolved. Keep the developer
   decision separate and pending until the developer makes it. Move accepted work into the Plan and
   dated decisions into the Engineering Record; link the review from them.

The CLI never launches provider APIs or decides that a consensus exists. The current AI session or
human coordinator gathers contributions and edits the synthesis. Do not let multiple agents edit the
same review file concurrently.
