---
type: Runbook
title: Test Runner Batch Runs and a Deterministic Stop Rule
description: Decisions, review outcomes and open questions for the batch runner, the stop rule and copy-all.
timestamp: 2026-10-24T00:00:00Z
tags: [testing, performance, tooling, runner]
plans: [/docs/plans/061_test_runner_batch_and_stop_rule.md]
performance: []
---

# Runbook 061: Test Runner Batch Runs and a Deterministic Stop Rule

Append-only record. The plan holds the current design: [plan 061](/docs/plans/061_test_runner_batch_and_stop_rule.md).

## 2026-10-24: direction set

- Decision: the batch runner runs an ordered array of tests, one at a time, with a per-test time limit only. No batch-wide time budget, since a combined cap adds nothing.
- Decision: fast by default, with no pacing option. Watching is covered by the `human-observed` profile.
- Decision: copy-all copies every test's summary, separated by a blank line, with a Copy button as fallback.
- Decision: agents do not pick durations. The stop rule decides from the data, and a cap only guards against hangs.

## 2026-10-24: survey of one consumer app's scenarios

- 274 unique scenarios: 259 steady, 15 scripted, 0 mixed.
- Only 3 scripted sweeps set `quickMs`. 57 steady scenarios have no settle series and run a fixed length.
- Count-based tests exist (collider blocks, CPU benches), and the session budget still treats their length as time.

## 2026-10-24: independent review

A read-only review approved the direction with eight adjustments, all now in the plan:
1. Compare at least 4 blocks, not two halves, because consecutive frames are correlated.
2. Discard a fixed warm-up before measuring.
3. Settled needs two passing checks in a row.
4. Keep the current relative tolerance with a timer-step floor, applied to median and p95. Report hitches as a metric only.
5. Model tests as phases, not fixed kinds.
6. Wait for queued GPU work and cool down between tests. Repeat a reference test at the start and end, and flag drift.
7. Drop pacing.
8. A failed test does not stop the batch. Each test restores state and saves its result. Summaries show their stop reason. Add a Copy button.

## Open questions

Decisions from the owner, 2026-10-24:

1. **Warm-up:** decided by an Opus review of 320 existing result files (2,020 raw series). Each test declares a warm-up floor (`warmupMs`, which exists today). The library then drops leading frames still over 2x the later median, up to a cap, and records how many it dropped. No fixed 60 frames or 500 ms rule. Risk: slow drift under 2x the median passes unseen. The data cannot show how short a warm-up can safely be, because almost all runs used long warm-ups (100 to 1500 ms).
2. **Reference test:** a fixed, simple test run at the start and end of a batch to detect drift, such as thermal throttling. Decided: one reference per batch, built into the library, so nobody picks it.
3. **Adoption:** BSP first. A read-only Haiku subsession checks whether Mycelia can adopt it later.
4. **Release:** none for now. The library is local and under heavy development while both repos are active, so consumers use it directly.

## Caveats

- Line references in the plan came from a survey and have not been re-verified against the code. Check them before implementation starts.
- Numbers approved by the owner, 2026-10-24: 5% median and 10% p95 tolerance, at least 4 blocks, 250 ms cooldown, 60 s per-test cap. Other numbers in the plan (for example the 60 frames / 500 ms warm-up text in §4) are superseded by the decided warm-up rule in Open questions, item 1.
- Nothing has been run. Verification is listed in the plan.
