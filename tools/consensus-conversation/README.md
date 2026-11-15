# Conversation coordinator prototype

Runs separate Claude Haiku, Codex Luna, OpenCode DeepSeek V4.1 Flash, and Antigravity Hydrogen Low sessions and saves a JSON transcript after each turn.

**Ownership:** This is a prototype temporarily hosted in the engine workspace. The intended owner is
the agentic environment, so discussions and consensus tooling can serve any repository. The capsule
replay is an optional engine-based presentation. Migration and integration have not happened yet; the
commands below still run the prototype from this checkout.

## Starting a discussion in a future session

Ask an agent: **“Use the conversation coordinator to explore [question].”** The agent should infer
the relevant repositories from the current task and explicitly select their paths; ask only if the
selection is genuinely unclear. Use no repositories if the question does not need them.
Unless the owner specifies otherwise, select Luna, Haiku, DeepSeek Flash and Hydrogen Low as in the
example below, with two rounds and a maximum of 10 coordinator calls. If no repository is selected,
omit Luna: the current Codex adapter requires one. Report the evidence, blind spots,
disagreement and unresolved questions; don't treat a summary as the owner's decision.
For a session outside this repository, point the agent at this guide in the local checkout. The agent
should check that the requested providers are available and follow the owner's model and usage rules.
Do not invoke a metered frontier model without the owner's explicit authorization.

1. Freeze one clear question and the same opening context for every participant. Select repository
   directories explicitly; use only the files needed. The selected directories are not a read-security
   boundary. Avoid putting secrets in the question or transcript.
2. Copy the example below to a new local JSON config, change the question and participants, and set
   `repositories` to the absolute directories to inspect (or `[]` without Codex). Use a new output
   file under `artifacts/consensus-conversation/`. Two rounds allow one opening and one follow-up
   each; the 10-call cap leaves room for two corrections, which also consume calls. Set a shared
   input threshold and time limit appropriate to the task. If you enable the separate facilitator,
   reserve an additional call; it may be skipped if another limit is reached.
3. Run the command below from this workspace. Check the saved status, rejected replies, token data,
   questions, turns and outcome. Limits can interrupt a discussion, including before final replies;
   the partial record is still useful. Whole-run restart is not implemented.
4. Give the owner a concise recommendation or options, evidence, useful challenges, unresolved
   questions and attributed dissent. Make clear whether a summary is an interpretation and whether
   all participants actually endorsed it. Voting is not required. For a consequential decision, use
   the existing `triangular docs consensus` workflow to preserve the frozen brief, attributed opening
   answers and outcome manually; automatic export is not implemented.
5. When a video is requested, use the installed `share-media-in-chat` skill. Generating a video for an
   arbitrary conversation is not yet an automated part of this workflow; do not require the owner to
   choose a transcript in a file picker as the normal delivery path.

These are experimental instructions, not evidence that a four-provider run has already established
better answers. To evaluate value, compare the independent openings with the follow-up and final
outcome, identifying a specific issue caught or correction made and any error introduced. Prefer
checkable evidence over agreement alone.

## Current limits and future consultation

The existing call and input thresholds apply to each run only. They do not enforce per-model or
rolling five-hour/weekly allowances across conversations, and they do not check remaining subscription
quota. Token counters can be incomplete or have provider-specific meanings; an in-flight call can
cross the threshold. A future shared ledger could count calls and reported tokens per provider/model
over configurable windows, including retries and failed attempts, but cannot account for activity
outside the ledger. Provider account quota is a separate signal and must be verified per provider;
unknown or stale quota must stay unknown. Claude's API budget flag is not a verified subscription
limit. Codex's locally generated app-server schema exposes an account rate-limit read, but this
prototype has not integrated or validated it. OpenCode advertises local usage statistics; that is not
verified as remaining subscription quota.

A future companion could let a working agent ask a focused question of another provider, or let a
stronger lead request independent low-cost critiques. The reverse—lower-cost investigation followed
by one targeted stronger review—and one-time guests are also candidates. None is implemented yet;
choose roles for the task, retain actual attributed answers and use configurable budgets. Do not run
expensive guests merely to test the idea.

## Coordinator behavior

This is a local prototype with a manual capsule replay. The opening is independent; later turns receive
all other participants' turns since their last turn, in order. Participants can speak or pass, ask
named questions, answer or decline questions addressed to them, and report agreement and readiness.
Open questions prevent an early finish. The final round requests wrap-up and forbids new questions.
Hard limits can interrupt before everyone has a final turn; unresolved questions remain in the output.
If a participant returns invalid JSON or metadata, the coordinator saves the rejected response and
asks that participant once to correct it in the same session. The correction consumes a normal call
and counts against the same time and usage limits. If it also fails, the run stops with its partial
transcript intact. A retry can leave fewer calls for discussion or synthesis.
Each prompt includes a minimal JSON example. The console and saved `responseQuality` report rejected
replies, correction calls and successful corrected turns in total and grouped by model (including
multiple participants using the same model). Rejections include invalid metadata as well as invalid
JSON, and a second rejected reply counts separately. The original responses and validation errors
remain in `rejectedTurns`; a rejected response does not necessarily lead to a retry if a limit is hit.
These counts help spot recurring problems; they do not establish whether the example improves reliability.

Experimental `"schemaOutput": true` requests a response schema from Codex, Claude and Antigravity
on each participant turn, including resumed turns. OpenCode's `run` CLI has no schema option, so
DeepSeek continues to use the prompt and coordinator validation. The facilitator also remains unchanged.
Unknown agreement scores are represented as null for the schema and removed from the saved scores.
The coordinator still validates meaning and retains its bounded correction for rejected replies.
Provider-side schema failures stop the run, and internal provider retries are not included in the
coordinator's correction counts. Usage for failed CLI calls may be unavailable. Schema mode is opt-in;
do not interpret a clean run as proof that a provider never retried or that the discussion is correct.

Claude can manage its own session context with its native automatic compaction. Optionally set
`"claudeAutoCompactWindowTokens": 100000` (100000–1000000) to pass Claude's `--autocompact`
window setting on every turn, including resumed turns. This is a context-window setting, not a
total-usage budget or an exact coordinator-controlled trigger. When Claude returns a completed
`compact_boundary`, the run records its participant, round, trigger and reported before/after token
counts in `compactions`; a start or a model's claim is not treated as completion. This applies even
to rejected replies. The shared transcript is not compacted. A failed CLI call may lose its events,
and compaction usage may not be fully represented by the existing usage totals.

Optionally set `"observeOpenCodeCompaction": true` to inspect the OpenCode session export after each
DeepSeek reply. This local check makes no model call and does not trigger compaction. It records a
completed summary linked to a compaction marker once, and saves each check's status in
`compactionObservations`. The recorded round is when the coordinator first observed it, not
necessarily when it happened. Exports are bounded by the turn's remaining time, five seconds and
the output-size limit; failure is recorded as unavailable and does not discard the reply. The export
may contain private session content; it is inspected in memory and not added to the run. Sizes and
compaction usage are not inferred from it.

Optionally set `"observeCodexCompaction": true` to inspect Codex's persisted session history after
each reply, using its local app-server. This does not call a model or trigger compaction. Completed
compaction items in completed turns are recorded once; each check is marked `checked` or
`unavailable` in `compactionObservations`. The round is when first observed. Inspection uses at most
five seconds of remaining turn time, a 1 MB response limit and one page of 100 turns. A larger or
incomplete history is marked unavailable, and a valid reply is retained. Session content is processed
in memory, not added to the run. The event does not establish the trigger, context sizes or usage.
Automatic triggering in a live discussion has not been verified. Codex and Antigravity may compact
on their own, but the coordinator does not configure their compaction. Missing events do not prove
compaction did not occur. None of these settings limit cumulative usage.

Optionally set `"observeHydrogenCompaction": true` to retain possible Antigravity compaction signals
from the existing reply stream, with no extra model call. A same-session completed checkpoint is
recorded as `signal_observed` in `compactionObservations`, with its step number. Our manual `/compact`
spike emitted a checkpoint, but checkpoints are not proven exclusive to compaction, so this is not
added to confirmed `compactions`. `no_signal` only means no such checkpoint appeared in that reply;
it does not establish whether compaction occurred. Observation is unavailable if the stream's session
IDs conflict. Failed CLI calls may lose the stream, and neither token savings nor cost is inferred.
The coordinator does not request compaction or inspect Antigravity's private session database.

```json
{
  "question": "What should we check before changing this feature?",
  "participants": [
    {"name": "Ada", "model": "gpt-6-luna"},
    {"name": "Bea", "model": "claude-haiku-5-5"},
    {"name": "Cal", "model": "opencode-go/deepseek-v4.1-flash"},
    {"name": "Dee", "model": "gemini-4-hydrogen-low"}
  ],
  "rounds": 2,
  "minRounds": 2,
  "maxTotalCalls": 10,
  "secondsPerTurn": 120,
  "maxMinutes": 15,
  "maxInputTokens": 300000,
  "synthesize": false,
  "identityMode": "models",
  "sourceFiles": ["projects/triangular-engine/README.md"]
}
```

Run `node tools/consensus-conversation/coordinator.mjs config.json artifacts/consensus-conversation/run.json`.
The output path must be new. The four-model selection above is a workflow recommendation, not a
coordinator default: participants must be specified in the configuration. Plain string participants
remain supported and use Haiku. The 10-call limit is a ceiling on coordinator calls, not a promise of
10 discussion turns: corrections and an enabled facilitator consume it, and two rounds permit at most
eight participant turns. Other limits or early readiness may stop the discussion sooner. This cap is
per run, not a rolling quota or a count of provider-internal requests.
`identityMode` defaults to `models`: duplicate instances have their configured name in parentheses;
different models use their model names alone. Set `names` to show configured names only. Names mode
cannot guarantee anonymity: provider environment, prompts and content can reveal model identities.

The optional facilitator is a separate non-voting Haiku session. It summarizes common ground,
disagreement and next steps, without making a developer decision. It shares the call, elapsed-time
and token limits; set `synthesize` to `false` to disable it. If it is skipped or fails, positions and
the transcript remain available. A model summary is an interpretation, not proof of consensus.

By default the current workspace is the primary repository. Provide `repositories` as an array of
absolute directory paths to select a primary and supporting directories, or an empty array when no
repositories are selected. Codex currently requires a repository. Optional
`sourceFiles` are relative to the primary repository and at most 20 KB each. Claude uses restricted
Read, Glob and Grep tools, and supporting directories are passed with `--add-dir`. Codex runs with its
read-only sandbox and can use shell commands to inspect files. DeepSeek uses OpenCode's plan agent
with read/search permissions and denied mutation/command tools. Hydrogen uses Antigravity's per-run
deny rules for writes, commands, MCP and web, with supporting directories passed via `--add-dir`.
OpenCode's permitted external-directory reads and Codex's sandbox do not confine reads to selected
directories. With no selected repositories, the new adapters deny model file tools; this is not a
verified filesystem isolation boundary. Participants are instructed not to modify anything; recorded tool calls provide
evidence of observed activity, not a complete audit. CLI hooks and other processes are outside this
prototype's control, and sandbox enforcement depends on the local CLI and platform. Repository
selection is not a confidentiality boundary. Automatic project discovery is not integrated.

Calls, rounds, turn time and total elapsed time have bounded defaults and maximums. `minRounds`
prevents readiness from ending the run before that many rounds, subject to hard limits. The optional
input-token threshold stops subsequent calls after reported usage reaches it; a call may exceed it.
Failed or timed-out calls may not report usage. The transcript records per-participant and total input
and output tokens, including cached input where reported. Claude's dollar figure is an estimate, not
subscription billing; the other adapters do not report a cost here, so mixed totals are flagged `costIsPartial`.
DeepSeek's input includes cached reads and writes; its output includes reported reasoning tokens.
Hydrogen reports input and output according to Antigravity's counters. Provider counters differ.
Neither cost nor remaining subscription quota is guaranteed. The transcript can contain sensitive
material. Coordinator-controlled compaction for all providers, whole-run restart, per-model budget,
proposal voting and consensus document export are not implemented yet. The provider guards do not isolate hooks, plugins or other
local processes; a scratch-file probe is not proof that every write route is blocked.

To replay a saved JSON transcript, open the existing demo app at `/consensus-debrief?replay=1`, choose
**Open transcript**, and step through its turns. The file is read locally by the page. Capsule spacing
approximates the average of reported directional scores, while the panel keeps each score separate;
positions are not a precise map of all relationships. Floating question cards and readiness update as
turns appear, including when stepping backwards. Open `/consensus-debrief?replay=1&sample=questions`
for an illustrative example of open, answered and declined questions; its dialogue is invented, not a model transcript.
This is a manual replay, not live playback or a voting interface.
