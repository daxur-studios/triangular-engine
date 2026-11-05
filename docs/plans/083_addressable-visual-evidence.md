---
type: Plan
title: "Addressable Visual Evidence and Shot Plans"
description: "Let an agent plan purposeful camera shots and let a reviewer discuss an exact frame of the resulting clip, without live remote control."
timestamp: 2026-11-05T00:00:00Z
tags: [engineering-records]
record: /docs/engineering-records/083_addressable-visual-evidence.md
map_schema: 1
document_id: plan-083
initiative_id: "addressable-visual-evidence"
performance: []
---

# Plan 083: Addressable Visual Evidence and Shot Plans

Status: **planned**. Evidence and decisions: [ER 083](/docs/engineering-records/083_addressable-visual-evidence.md).

<!-- tri:scope -->

## Intended outcome

A reviewer who cannot run a scene, for example away from the RTX machine with only a phone, can still review its motion usefully.
An agent proposes named camera shots aimed at what a change could break, and each clip identifies its own frames. The reviewer can
then say "shot `shoreline`, frame 96, left edge", and the agent can read the camera and scene state at that frame without guessing
from pixels. Notes on a frame stay with the run instead of vanishing with the chat.

### Constraints

- Build on the existing evidence path: `TestRunAdapter.recording`, the bounded receiver upload, `media-manifest.json`,
  `triangular testing media` and `triangular testing review`. Result JSON keeps metadata only, never pixels.
- Recording stays diagnostic. Performance and CPU suites still refuse it, and no clip counts as timing evidence.
- A generated clip or an agent's look at it is not a visual pass. A review still names a specific claim and the artifact inspected.
- The testing entry has no renderer. The adapter owns the camera, the canvas and the frame state it reports.
- Keep the entry free of scene-specific knowledge. Shot lists belong to the app or scene.
- Shots are declared by whichever app owns the scene: this repository's demo app, consumer apps in separate repositories, and games
  built on the engine. The engine defines the shot schema, the sidecar format, moment references and the CLI. It ships no shot
  lists for other repositories' scenes, and it names no consumer repository or scene in public docs or code.
- The CLI and receiver must work from any consumer workspace through the existing `--root` and `triangular-test.config.json` paths,
  not only inside this repository.

### Out of scope

- Comparing runs and cutting clips down to the changed ranges. This needs repeatable frames, and the engine advances by measured
  real time today (`EngineService.tick`), so identical runs do not produce identical frames. It needs its own plan.
- A phone summary card, chat-optimized encodes, automatic detection of visual faults, live streaming, remote control and touch input.
- Choosing shots with no human in the loop. The agent proposes and the reviewer approves.

## Phases and acceptance

- **aev-frame-map** — Burn a frame number and shot name into recorded clips and save a per-frame sidecar through the bounded upload path. Each row holds the frame number, clip time, frame time, camera position and target, plus host-supplied state such as quality tier or LOD. Acceptance: on a real recorded clip, frames sampled across its length show burned-in numbers that resolve to sidecar rows; the measured gap between requested clip time and the frame shown is recorded in the ER; a clip or run over its size limit still degrades to a visible limitation; specs cover the sidecar contract and receiver validation.
- **aev-moments** — Add a moment reference, `<run>/<recording>#<frame>`, and CLI support that resolves it to a still and its sidecar row, and that records a frame-scoped review note in `.reviews.json`. Acceptance: given a run and a frame number, one command prints the sidecar row and writes a labeled still without opening other media; a note saved against a moment appears in `npm run test:summary` and survives a later run; the media and review specs pass; the testing README, CLI guide, testing skill and CHANGELOG describe the feature.
- **aev-agent-links** — Let an explicit launch-link option start recordings for eligible suites, so unattended agent runs can produce clips. Acceptance: a link with the option records through `npm run test:run` with no click on the page; a link without it records nothing; a performance or CPU suite refuses it visibly; the launch and runner specs cover all three; the README's statement that links never record is updated.
- **aev-shot-plans** — Add a shot declaration (id, the claim it checks, what could go wrong, camera keys, length within the clip limit), with `water-lod-spike` as the pilot, and contact sheets built from the shot's own key beats. The testing skill gains the workflow: read the change, propose shots with reasons, wait for approval, run, report. Acceptance: at least three pilot shots run from one launch link and each saves a clip, a sidecar and a labeled sheet without hand-picked timestamps; the owner reviews a real run by naming a frame and the agent answers from that frame's sidecar row; the outcome, including whether this reduced re-watching, is recorded in the ER.

## Relationships

<!-- /tri:scope -->

## Current phase status

| Phase           | State   |
| --------------- | ------- |
| aev-frame-map   | in_progress |
| aev-moments     | planned |
| aev-agent-links | planned |
| aev-shot-plans  | planned |

<!-- tri:review version="1" scope-hash="26b6ba72557fe9f9fff7f74038a56eb9c099aacd4e81dd08873afb1d44a1adf0" reviewed="2026-11-05" reviewer="agent" -->
<!-- tri:item id="Q1" kind="intent" applies-to="aev-agent-links,aev-shot-plans" blocks="aev-agent-links" state="resolved" -->

- [x] May an explicit launch-link option start recordings?
  - Why it matters: the testing README deliberately says clips are never started implicitly by an agent link, and the runner forces recording off for launch links. While that stands, an unattended run produces no clips, so someone would have to tick the checkbox at the machine.
  - Next action: implement the option as explicit and opt-in per link, and update the README's statement that links never record.
  - Resolution: yes, the owner approved an explicit launch-link option. Links without it still record nothing. This reverses the documented rule for that option only.
    <!-- /tri:item -->

<!-- tri:item id="Q2" kind="investigation" applies-to="aev-frame-map,aev-moments" blocks="aev-moments" state="open" -->

- [ ] How accurately does a `MediaRecorder` clip's time map to the frames the page drew?
  - Why it matters: the recorder chooses its own frame timing, and the existing helper copies frames from an animation-frame callback at a capped rate. If clip time drifts, a time alone cannot identify a frame. The burned-in number is the planned source of truth for that reason, but it must stay legible at the clip's bitrate. If it does not, this needs stepped capture with explicit frame timestamps (for example WebCodecs), which is a larger change.
  - Next action: the implementing agent measures this on a real clip during `aev-frame-map` and records the result in the ER before `aev-moments` starts.
    <!-- /tri:item -->

<!-- tri:item id="Q3" kind="investigation" applies-to="aev-moments" blocks="none" state="open" -->

- [ ] Can a moment be re-rendered at full resolution, or only extracted from the clip?
  - Why it matters: clips are small (the pilot's helper uses 640x360 under a 1 MiB limit), so fine shimmer may not survive encoding. Restoring the camera is easy, but a matching re-render also needs the scene's time and streaming state to be restorable, and engine time comes from measured deltas.
  - Next action: ship extraction first, and check during `aev-moments` whether the pilot can restore its scene time. A re-render that cannot match must be labeled approximate, or left out and recorded as a follow-up.
    <!-- /tri:item -->

<!-- tri:item id="Q4" kind="assumption" applies-to="aev-shot-plans" blocks="none" state="resolved" -->

- [x] `water-lod-spike` is the right pilot.
  - Why it matters: it already has camera keys (`motionPose`), orbit cases and a labeled recording helper, so it is the cheapest proof.
  - Next action: build the pilot on it first; the owner expects more scenes later, from this repository and from consumer apps.
  - Resolution: confirmed by the owner as the pilot. Later scenes will come from this repository, from consumer apps in separate repositories and from games built on the engine, so the shot format must not depend on any one scene.
    <!-- /tri:item -->
    <!-- /tri:review -->

## Delivery progress

Record dated milestones, evidence and material changes in the linked Engineering Record.

Scope history in the Engineering Record is append-only. Confirm a specific baseline only after
explicit developer confirmation; document review and checked boxes do not imply confirmation.
