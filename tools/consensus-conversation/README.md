# Conversation coordinator prototype

Runs separate Claude Haiku, Codex Luna, OpenCode DeepSeek V4.1 Flash, and Antigravity Hydrogen Low sessions and saves a JSON transcript after each turn.
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
and compaction usage may not be fully represented by the existing usage totals. Other CLIs may do
their own automatic compaction; the coordinator does not configure or verify that here. Missing
events do not prove compaction did not occur.

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
  "maxTotalCalls": 8,
  "secondsPerTurn": 120,
  "maxMinutes": 15,
  "maxInputTokens": 300000,
  "synthesize": false,
  "identityMode": "models",
  "sourceFiles": ["projects/triangular-engine/README.md"]
}
```

Run `node tools/consensus-conversation/coordinator.mjs config.json artifacts/consensus-conversation/run.json`.
The output path must be new. Plain string participants remain supported and use Haiku.
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
