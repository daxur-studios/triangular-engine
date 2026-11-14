# Conversation coordinator prototype

Runs separate Claude Haiku and Codex Luna sessions and saves a JSON transcript after each turn.
This is a local prototype with a manual capsule replay. The opening is independent; later turns receive
all other participants' turns since their last turn, in order. Participants can speak or pass, ask
named questions, answer or decline questions addressed to them, and report agreement and readiness.
Open questions prevent an early finish. The final round requests wrap-up and forbids new questions.
Hard limits can interrupt before everyone has a final turn; unresolved questions remain in the output.

```json
{
  "question": "What should we check before changing this feature?",
  "participants": [
    {"name": "Ada", "model": "gpt-6-luna"},
    {"name": "Bea", "model": "claude-haiku-5-5"}
  ],
  "rounds": 2,
  "minRounds": 2,
  "maxTotalCalls": 5,
  "secondsPerTurn": 45,
  "maxMinutes": 4,
  "maxInputTokens": 100000,
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
absolute directory paths to select a primary and supporting directories, or an empty array for a
Claude-only conversation without repository tools. Codex currently requires a repository. Optional
`sourceFiles` are relative to the primary repository and at most 20 KB each. Claude uses restricted
Read, Glob and Grep tools, and supporting directories are passed with `--add-dir`. Codex runs with its
read-only sandbox and can use shell commands to inspect files. Its sandbox does not confine reads to
selected directories. Participants are instructed not to modify anything; recorded tool calls provide
evidence of observed activity, not a complete audit. CLI hooks and other processes are outside this
prototype's control, and sandbox enforcement depends on the local CLI and platform. Repository
selection is not a confidentiality boundary. Automatic project discovery is not integrated.

Calls, rounds, turn time and total elapsed time have bounded defaults and maximums. `minRounds`
prevents readiness from ending the run before that many rounds, subject to hard limits. The optional
input-token threshold stops subsequent calls after reported usage reaches it; a call may exceed it.
Failed or timed-out calls may not report usage. The transcript records per-participant and total input
and output tokens, including cached input where reported. Claude's dollar figure is an estimate, not
subscription billing; Codex does not report a cost here, so mixed totals are flagged `costIsPartial`.
Neither cost nor remaining subscription quota is guaranteed. The transcript can contain sensitive
material. No automatic compaction, whole-run restart, per-model budget, proposal voting or consensus
document export is implemented yet. DeepSeek and Hydrogen were tested manually but are not integrated.

To replay a saved JSON transcript, open the existing demo app at `/consensus-debrief?replay=1`, choose
**Open transcript**, and step through its turns. The file is read locally by the page. Capsule spacing
approximates the average of reported directional scores, while the panel keeps each score separate;
positions are not a precise map of all relationships. Floating question cards and readiness update as
turns appear, including when stepping backwards. Open `/consensus-debrief?replay=1&sample=questions`
for an illustrative example of open, answered and declined questions; its dialogue is invented, not a model transcript.
This is a manual replay, not live playback or a voting interface.
