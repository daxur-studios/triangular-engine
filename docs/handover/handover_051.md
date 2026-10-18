# Handover: Plan 051 Cloud Volumes, Phase 3b (haze)

**Repo:** `D:\code\triangular-workspace`. Branch `master`. Nothing is committed by the agent; the user commits.

## Standing rules
- Never `git commit`.
- Never name private or consumer apps.
- Tests run headless and non-watching only.
- Do NOT edit `clouds/`, `takram/`, `atmosphere/`, `planet-material/`, `cell-planet-tsl`, `atmosphere-lab`, `atmosphere-planet`, or Plans/Runbooks 049/050/052.
- Only additive wiring in shared config files.
- Refer to the user as they/them.
- Record results in `docs/runbook/051_cloud_volumes.md`.
- Keep answers short.
- The lab has ONE green button that runs whatever is tested next, driven by `projects/demo-app/src/app/pages/cloud-volumes-lab/next-test.ts`. Never require more than one click.
- Adding missing items to Plan 051 as suggestions is fine. Wiring the planet-material (cloud shadows on the ground) needs a separate go-ahead.

## Phase 3 gate
Orange-lit clouds at dusk, blue-hazed far clouds, a dark night side and no white glow, at <= 0.1 ms added cost. The by-eye part is the user's job.

## Done
- **3a lighting:** `CloudVolumeAtmosphereLighting` writes `uSunColor` and `uAmbient` per volume on the CPU. GPU cost is zero (3.90 vs 3.91 ms).
- **Lab:** camera toggle (fly/orbit); default is box proxies; sky backdrop toggle (user said "Looks ok").
- **3b haze (built):**
  - `CloudVolume.haze` is a hook `(rgb, alpha, distanceUnits) => hazedRgb`.
  - `CloudVolumeScreenPass.setHaze(CloudVolumeHaze | null)` builds the function and sets it on all volumes.
  - `CloudVolumeHaze` is a structural interface (`lookup`, `metersPerUnit`, `scale`), so `cloud-volumes` doesn't import `atmosphere`.
  - The lab button `cloud haze: on/off` uses `AtmosphereAerialPerspectiveLut`.
  - The lookup now runs only for rays that hit cloud.
- **Tests:** `npm run test:triangular-engine:cloud-volumes` was 12/12 before the last hit-only edit; lib and app `tsc` were clean after it. Tests not re-run since that edit.

## Haze cost, measured (canvas 2560x1308, 12 volumes, proxies, 1 band/frame)

| Scenario | Haze off | Haze on | Added |
|---|---|---|---|
| fly-by (avg) | 3.86 ms | 6.31 ms | +2.45 ms |
| fly-by p95 | 5.24 ms | 8.13 ms | +2.89 ms |
| inside | 3.98 ms | 4.30 ms | +0.32 ms |
| horizon | 2.80 ms | 2.92 ms | +0.12 ms |

Far over the 0.1 ms goal. Moving the lookup into the hit branch barely helped, so the cost is the lookup itself. Recorded in Runbook 051.

## Next step (awaiting the user's go)
Build **per-volume CPU haze** at the volume centre, like the lighting:
- Zero GPU cost; each cloud gets one haze amount for its whole body.
- Keep the per-pixel path behind the toggle so the two can be compared by eye.
- Add the new scenarios to `next-test.ts`: fly-by plus the `inside` and `horizon` static spots, haze off vs on.
- Re-measure with the green button and record the result in Runbook 051.

## Still open
- By-eye look and `scale` tuning of the haze (cloud colour and atmosphere radiance are different units; the lab's `scale` is `exposure * sunVisibility * hazeStrength`).
- Optional per-pixel sun colour (terminator flip).
- Plan 051 text updates: Phase 3 status, and the 3c and G6 12-volume status.
- Phase 6 cloud shadows on the ground (needs a separate go-ahead).

## Key files
- `projects/triangular-engine/cloud-volumes/cloud-volume.ts` (`haze` field, applied in `buildMarchNode`).
- `projects/triangular-engine/cloud-volumes/cloud-volume-screen-pass.ts` (`setHaze`, `HAZE_TEXTURES`, `volumesPerTarget`).
- `projects/triangular-engine/cloud-volumes/cloud-volume-atmosphere-lighting.ts` (the pattern for the CPU version).
- `projects/demo-app/src/app/pages/cloud-volumes-lab/cloud-volumes-lab-page.component.ts` (`ensureSky`, `syncSky`, `applyHaze`, `runNext`).
- `projects/demo-app/src/app/pages/cloud-volumes-lab/next-test.ts` (the green button's test).
- `docs/runbook/051_cloud_volumes.md`.
