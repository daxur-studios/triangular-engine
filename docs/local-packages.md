---
type: Standard
title: Local package archives
description: Store all locally produced or consumed package tarballs under the ignored package folder.
timestamp: 2026-10-18T00:00:00+01:00
tags: [packages, npm, local-development]
---

# Local package archives

**Owner standard, 2026-10-18:** all local `.tgz` archives belong under the repository's
`/ignore/packages/`. Keep `/ignore/` in the root `.gitignore`; never add a tarball
exception or force-add archives. A multi-application repository uses its repository
root and package-relative dependency paths. Separate library repositories each own
their own ignored package folder.

- Build the library first, then use `npm pack <built-package> --pack-destination ./ignore/packages`.
  Create the destination folder if needed. Keep generated library output in `dist/`;
  archives are stored separately so a later pack cannot accidentally include an older archive.
- Consuming packages use an appropriate relative path, for example
  `file:ignore/packages/example-0.0.1.tgz` at the root or
  `file:../ignore/packages/example-0.0.1.tgz` in a nested application.
  A sibling library reference may point to that library's `ignore/packages/`.
- Update package manifests and lockfile `file:` paths together. A location-only move
  preserves the archive bytes, version and integrity; it does not upgrade dependencies.
- Keep measured/shared snapshots identifiable by version or a unique filename/hash.
  A deliberate rebuild of a mutable alias requires reinstalling it and updating its
  integrity. Do not silently overwrite a snapshot used as evidence.
- Fresh clones do not contain these ignored archives. Restore the required local
  snapshots or run the library's documented build/pack workflow before installing.
- Vendor package-manager directories/caches are not local archive storage to reorganize.
  Preserve historical duplicates under `ignore/packages/archive/` rather than deleting them.

This standard governs future scripts and agent instructions as well as manual copies.
Registry publication is a separate action.
