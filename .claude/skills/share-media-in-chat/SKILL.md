---
name: share-media-in-chat
description: Claude Code only. Send test captures (contact sheets, GIFs, MP4s, stills) to the owner so they play inline in the Claude app chat, without opening files and without spending your own context on the pixels. Use when showing visual or motion results.
---

# Share media in chat (Claude Code only)

This applies to Claude Code in the Claude desktop app and sessions the owner follows from another device. Other IDEs and agents have their own ways; do not assume this works there.

## How

1. Make the file (FFmpeg, or `triangular testing media gif | contact-sheet`). Save it inside the session folders or the scratchpad directory.
2. Call `SendUserFile` with absolute paths:
   - `files`: array of paths
   - `display: "render"` for inline view, `"attach"` for a download card
   - `status: "normal"`
   - `caption`: what the file shows, plus anything the picture cannot say (timestamps, which tile is which)
3. Stop there. Do not `Read` the file afterwards.

## Cost

- `SendUserFile` returns only a delivery confirmation (path and file id). You do not see the media, so it costs almost nothing.
- `Read` on a PNG loads the image into your context and costs tokens. Do it only to check a result, and scale it down first. A video cannot be read; pull a few frames with FFmpeg if you must look.

## Formats

- MP4 (H.264, `-pix_fmt yuv420p`, mobile encode) plays inline on the owner's phone. Prefer it for motion.
- GIF (`fps=8`, 360 px, `palettegen`/`paletteuse`) is the fallback.
- Contact sheets: tile frames with FFmpeg `tile`; give every input the same `scale=W:-1` and the same source size, or the grid misaligns. FFmpeg `drawtext` crashes on this Windows setup (fontconfig), so put labels in the caption.
