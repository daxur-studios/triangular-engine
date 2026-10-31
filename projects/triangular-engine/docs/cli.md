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
triangular docs archive docs/plans/043_optional_scene_tree.md
triangular docs map
```

`docs records new` and its `docs plan new` alias create the reciprocal pair and update its indexes.
`docs archive` archives a completed or superseded plan and its paired Engineering Record by saving
the final commit hash, updating index statuses to `archived`, and replacing their full text with clean stubs.
`docs map` generates `public/development-map/manifest.json`.
If a project has no plan or Engineering Record index yet, creation scaffolds both from the packaged
templates; existing indexes are preserved and extended. Other record operations (`next`, `review`,
`baseline`, `archive`, `manifest`, `map`) are forwarded to the existing helper. Its retention and explicit-baseline rules
still apply.

The testing commands delegate to the package's existing tools:

```sh
triangular testing run --url http://localhost:4200/lab --suite my-suite --version 1
triangular testing summary --suite my-suite --last 3
triangular testing receiver
triangular testing baseline saved-result.json > baseline.json
triangular testing media gif --source artifacts/test-runs/my-suite@v1/run-1/walk.webm
triangular testing media contact-sheet --source artifacts/test-runs/my-suite@v1/run-1/walk.webm \
  --title "Walk cycle views" \
  --capture "0.2=Front view · walk cycle" \
  --capture "2.0=Rear view · walk cycle" \
  --capture "6.0=High angle · walk cycle"
triangular testing media contact-sheet --title "Capsule facial expressions" --cell-width 640 --image "artifacts/test-runs/my-suite@v1/run-1/human-happy.webp=Human happy" --image "artifacts/test-runs/my-suite@v1/run-1/cat-skeptical.webp=Cat skeptical"
triangular testing media list --suite my-suite --json
triangular testing review add --run artifacts/test-runs/my-suite@v1/run-1.json \
  --artifact artifacts/test-runs/my-suite@v1/run-1/walk.contact.svg \
  --reviewer-kind human --reviewer owner --verdict pass \
  --claim "The walk cycle remains readable through the camera sweep"
triangular testing review list --run artifacts/test-runs/my-suite@v1/run-1.json --json
triangular testing review overlay --run artifacts/test-runs/my-suite@v1/run-1.json --review-id REVIEW_ID --frame 2 --role target --shape box --coords "0.2,0.1,0.5,0.7" --label "Head silhouette"
triangular testing review view --run artifacts/test-runs/my-suite@v1/run-1.json --review-id REVIEW_ID
```

`testing media gif` uses FFmpeg from `PATH` to write an optional, silent GIF preview beside a
saved WebM recording. It leaves the video intact and writes `media-manifest.json` in that run's
folder, linking the derivative to the source and recording both file sizes and the GIF settings.
The source must be inside the project's configured test artifact directory. Use `--force` to
replace a preview; the default is 8 fps, 480 pixels wide and a 96-color palette. `--json` prints
machine-readable paths and sizes. `testing media list` reads the result index and media manifests
only, reporting derivative paths and byte counts without reading their image or video contents.
Creating a GIF can use more storage than its WebM source.

`testing media contact-sheet` accepts either video timestamps or saved case stills. For a video,
FFmpeg samples the requested timestamps and writes one self-contained SVG next to the WebM. Repeat
`--capture "<seconds>=<label>"` at least twice; labels can describe the camera view and animation
phase. For expression or other detail reviews, repeat `--image "<path>=<label>"` with two to sixteen
saved JPEG, PNG or WebP test stills. Image inputs must be in the same run sidecar directory under the
configured artifact root. The output embeds the original stills (up to 640 pixels wide per cell)
without re-encoding them. Video sheets default to 320-pixel cells and three columns; still sheets
default to 480-pixel cells and two columns. Set `--cell-width` or `--columns` to adjust either
layout. The run's `media-manifest.json` stores the output size and source paths/sizes. Use `--force`
to replace an existing sheet. The manifest update is locked so parallel derivative generation for
one run retains all entries.

`testing review add` appends a visual assessment to a `.reviews.json` file beside the saved test
result. The claim, reviewer kind and ID, verdict, artifact path, MIME type, size and modification
time are stored separately from automated test results. Agent reviews may include `--model`; no
AI provider is called. Supported verdicts are `pass`, `fail`, `needs-work` and `inconclusive`.
Review artifacts must be files inside the matching run's artifact folder. The command reads only
the test result path and artifact file metadata, never the media contents. The review record stays
beside the run JSON if its media folder is later pruned. Use `testing review list --run <path>` to
read the records without opening media.

`testing review overlay` adds a vector box or arrow to one contact-sheet frame. Coordinates are
normalized from 0 to 1 within that frame; boxes use `x,y,width,height` and arrows use
`startX,startY,endX,endY`. Amber dashed `target` overlays mean “inspect this area.” Green `passed`
overlays are accepted only for a review whose verdict is `pass`. `testing review view` writes a
small HTML viewer beside the media, with independent checkboxes for inspection targets and passed
markers. It references the unchanged contact sheet and records the viewer size in the media
manifest. Changing or replacing a reviewed sheet invalidates the old review for new overlays.
Neither marking a target nor drawing an overlay changes the verdict.

The existing `triangular-test-run`, `triangular-test-summary`, `triangular-test-receiver`, and
`triangular-test-baseline` binaries remain available. `triangular-test-media` and
`triangular-test-review` provide the media derivative and review commands directly.

## Current command coverage

The `docs` family currently supports consensus reviews and the paired Plan/Engineering Record helper.
The namespace is designed to add other document types, such as spikes and examples, after their
shared format is defined. Use `triangular --help` for the installed command set.
