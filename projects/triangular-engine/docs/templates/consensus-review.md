---
type: ConsensusReview
consensus_id: {{CONSENSUS_ID}}
consensus_key: {{CONSENSUS_KEY}}
title: {{TITLE_YAML}}
created: {{DATE}}
plan: {{PLAN_YAML}}
record: {{RECORD_YAML}}
brief_sha256: ""
status: draft
outcome: pending
---

# Consensus Review {{CONSENSUS_ID}}: {{TITLE}}

This file records one engineering decision. Agent recommendations are advisory; the developer decision is recorded separately.

## Shared brief

<!-- tri:consensus-brief -->

### Decision question

{{QUESTION}}

### Desired result and evaluation criteria

[TODO: State the desired result and the observable criteria for choosing an approach.]

### Constraints and non-goals

[TODO: List hard requirements, compatibility limits and out-of-scope work.]

### Prior attempts and evidence

[TODO: Summarize relevant previous attempts and link the source records, code, test results or measurements.]

### Known unknowns

[TODO: List important unknowns that may change the recommendation.]

<!-- /tri:consensus-brief -->

The brief is frozen when the first round-one prompt is generated. If it needs to change after that,
create a new review so earlier answers remain tied to the context they received.

## Participants

Record the actual model/version and the context each participant received. Use `unknown` when unavailable.

## Round 1 — independent proposals

Each participant receives the shared brief without other participants' answers. Add responses with
`triangular docs consensus add-response`.

<!-- tri:consensus-round round="1" -->
<!-- /tri:consensus-round -->

## Synthesis

### Areas of agreement

[Complete after reviewing the independent responses. Attribute agreement to participants who stated it.]

### Disagreements and assumptions

[Preserve material differences; identify which evidence could resolve them.]

### Options and recommendation

[Recommend one approach, retain contenders, or state that evidence is needed before choosing.]

## Round 2 — targeted cross-review (optional)

Use this only when important disagreements or unverified assumptions remain. Preserve round-one answers.

<!-- tri:consensus-round round="2" -->
<!-- /tri:consensus-round -->

## Experiment or spike needed before choosing

If evidence is needed, specify the smallest useful experiment, its owner, success criteria, failure
criteria, and which decision the result will inform. Otherwise write `None`.

## Outcome

Choose one: `recommended`, `contenders`, `needs-evidence`, or `unresolved`.

## Developer decision

Pending. Record the developer's chosen option, deferral, or decision to gather evidence here.
