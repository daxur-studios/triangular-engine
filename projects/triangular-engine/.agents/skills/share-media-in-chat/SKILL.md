---
name: share-media-in-chat
description: Present generated videos, audio, GIFs and stills in Codex, Antigravity, or Claude app chats, including remote review. Use for delivering existing media to the user; delivery alone does not inspect or verify its contents.
---

# Share media in chat

Choose the current client's method. Keep the source artifact in a retained run folder and confirm the file exists before sharing. Report what the clip shows, duration, size and whether audio is present when known. Sharing for human playback does not require loading the media into model context.

## Codex desktop app, Antigravity, and remote chats

Put a Markdown image/media embed in the assistant's response, using the actual **absolute filesystem path**:

```markdown
![Button walkthrough](D:/workspace/app/artifacts/demos/run-123/demo.mp4)
```

Replace the example with the returned video path. Use forward slashes on Windows; for paths containing spaces, wrap the destination in angle brackets: `![Demo](<D:/workspace/My App/artifacts/demo.mp4>)`. The leading `!` requests inline media. A plain `[video](...)` link or a printed path is only a fallback, and a relative path is insufficient. Use the same embed syntax for local audio, GIFs and stills when supported. For Antigravity inline audio, use `.ogg` (Opus), `.m4a` (AAC), or `.wav` — Antigravity renders `Preview unavailable` for the `.opus` file extension. No separate upload tool, public host, replay app or local HTTP server was used for the confirmed MP4 handoff.

On 2026-11-05 the owner confirmed playback on a phone of an MP4 embedded in a Codex chat from the Windows laptop. The clip was approximately 12.5 seconds, 1280x800, H.264 with AAC audio, about 199 kB. On 2026-11-06 the owner confirmed inline playback in Antigravity chat using the same Markdown embed (`file:///...` or absolute path). This updates earlier reports of phone playback failing; it establishes this workflow, not every codec/client/version. Phone listening quality was not separately confirmed.

If the current Codex surface cannot render it, retain the MP4 and provide an absolute file link plus a contact sheet/transcript when useful. State the limitation. Do not treat a localhost URL or printed laptop path as confirmed remote delivery. Do not publish or tunnel files just to work around a display problem without authorization.

## Claude Code in the Claude app

Use `SendUserFile` when that tool is available:

- `files`: array of absolute paths, in session folders or the scratchpad as required by the tool.
- `display: "render"` for inline playback, or `"attach"` for a download card.
- `status: "normal"`.
- `caption`: what the artifact shows and any necessary timestamps/tile labels.

The existing Claude workflow reports inline H.264 MP4 playback on the owner's phone. Use its tool's actual contract; Codex does not use `SendUserFile`. A delivery confirmation is not content review. Do not read the media afterwards solely to deliver it.

## Formats and verification

For a broadly usable video derivative, prefer MP4 with H.264, `yuv420p`, AAC when audio exists, and `+faststart`. Preserve the original recording and identify any converted derivative. These settings describe the successful MP4; they are not proven necessary limits. A GIF is a silent motion preview; a contact sheet shows selected frames. Neither verifies sound or full-motion quality.

Only claim visual or audio acceptance after the relevant inspection. Record user-confirmed playback separately from automated checks and performance measurements. Keep the local source until review is finished; cross-device playback does not establish indefinite attachment retention.

## Make this discoverable in other repositories

The engine package ships this skill at `node_modules/triangular-engine/skills/share-media-in-chat/SKILL.md`. A consuming AGENTS.md can point there without a sibling checkout. Codex-only use does not require installing the engine: install this skill in the user's Codex skills directory and reference it from the user-level AGENTS.md. Repeat that setup on other agent machines; a repository-local skill alone does not reach unrelated repos.
