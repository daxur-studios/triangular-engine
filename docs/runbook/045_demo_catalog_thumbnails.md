---
type: Runbook
title: Demo Catalog Thumbnails
description: Decisions and implementation evidence for the demo preview catalog and engine portal capture control.
timestamp: 2026-10-13T00:00:00Z
plans: [/docs/plans/045_demo_catalog_thumbnails.md]
tags: [demo, thumbnails, portal]
---

# Demo Catalog Thumbnails

## 2026-10-13

- **[decision]** Use the same thumbnail/outcome approach as the game starter for the existing demo and spike indexes; retain their existing metadata and filters.
- **[decision]** Register one route-aware capture template in the engine's `overlay` / `bottomEnd` portal lane. Capture explicitly targets the live scene engine; no app-level engine provider or fixed browser overlay is added.
- **[action]** Added shared route-keyed Dexie storage, 480-pixel WebP previews, static fallbacks, empty-frame rejection and session fallback when persistence fails. Route changes clear capture timers/subscriptions and unregister the portal; the database closes with the app.
- **[action]** Demo cards in spotlight, categorized and sorted views, plus spike cards, use one thumbnail component. Failed/inconclusive spikes are hidden by default and available through status filters; existing search/sort and metadata remain in place.
- **[verification]** The Daxur live demo compiled successfully. Browser checks confirmed automatic capture and manual recapture on the camera demo, a saved preview surviving reload, and capture on the GPU morph spike. DOM inspection placed both controls inside `engine-ui`'s bottom-end portal outlet and confirmed removal on catalog navigation. The spike index showed two passed entries by default and one rejected entry through the Failed filter.
- **[finding]** A concurrent world-profile edit temporarily broke compilation at `cell-planet-morph-streaming-page.component.ts:248`; its owner resolved the error, and the live build is green again. Those edits were preserved.
- **[verification]** Screenshots are in `tmp/demo-catalog-20261013/engine-portal.png`, `catalog-preview.png` and `spike-catalog.png`. Legacy pages with no engine scene retain a fallback; the helper stops waiting for an engine on those routes.
