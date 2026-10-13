---
type: Plan
title: Demo Catalog Thumbnails
description: Add persisted scene previews to demo and spike catalogs with capture controls in the engine portal.
timestamp: 2026-10-13T00:00:00Z
status: done
runbook: /docs/runbook/045_demo_catalog_thumbnails.md
tags: [demo, thumbnails, portal]
---

# Demo Catalog Thumbnails

- [x] Share route-keyed browser thumbnail storage between both catalogs.
- [x] Capture the rendered engine scene and expose recapture through its overlay portal.
- [x] Add thumbnail cards while preserving demo search/sorting and hide unsuccessful spikes by default.
- [x] Check compilation and the rendered portal/capture/catalog flow.

Thumbnails stay in browser storage, with a static fallback before capture. No engine component changes or added packages are needed.
