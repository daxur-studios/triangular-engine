# triangular-engine/development-map

`triangular-engine/development-map` provides a standalone Angular view for a
project's examples, plans, open concerns, scope changes and saved test evidence.
It is data-in/data-out: the host project owns Markdown parsing, page links,
thumbnails, source navigation and test-result loading.

```ts
import { DevelopmentMapComponent, type DevelopmentMapProject } from 'triangular-engine/development-map';

readonly developmentMap: DevelopmentMapProject = loadProjectMap();
```

```html
<tri-development-map [project]="developmentMap" />
```

Build an adapter that converts your own versioned document manifest, example
catalog and result index to `DevelopmentMapProject`. Never derive developer
approval from a plan review marker or checked box. Set `baselineState` to
`confirmed` only after the developer explicitly confirms that exact snapshot;
otherwise use `unconfirmed` and omit baseline progress and growth. Keep proposed,
accepted, deferred and rejected scope changes visible as history, and do not
count unaccepted changes in the current-scope denominator.

Evidence contains summary values from the result index only. Keep raw result
samples and compatible-run comparisons in the project's test-results view. Mark
stale or context-limited evidence explicitly; a metric by itself is not a pass.

The entry has no router, result receiver, renderer or engine-runtime dependency.
Each host chooses links and loading behavior that fit its own application.
