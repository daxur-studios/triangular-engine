# triangular-engine/development-map

`triangular-engine/development-map` provides a standalone Angular view for a
project's examples, plans, open concerns, scope changes and saved test evidence.
It is data-in/data-out: the host project owns Markdown parsing, page links,
thumbnails, source navigation and test-result loading.

The view renders relationship previews with `@daxur-studios/mermaid-runtime`.
Install that optional peer package and its Mermaid Runtime peer dependencies when using this entry point.
The project adapter supplies explicit page-to-document links, phase readiness, concern targets and
document relationships; the viewer does not infer edges from document order.

Cards with relationships can be opened from their graph preview or expand control. The expanded
Mermaid Runtime view supports pan/zoom, node selection and an inspector with the normalized node
details. Inline SVG icons and short kind labels distinguish example pages, plans/records, phases,
review items and related documents.

```ts
import {
  DevelopmentMapComponent,
  buildDevelopmentMapProject,
  type DevelopmentMapProject,
  type EngineeringRecordsManifest,
} from 'triangular-engine/development-map';

// Zero-config: auto-derives branches, examples, and test evidence from manifest documents
readonly developmentMap = computed<DevelopmentMapProject | null>(() => {
  const manifest = this.manifest();
  if (!manifest) return null;
  return buildDevelopmentMapProject(manifest, {
    projectTitle: 'My Project Development Map',
    runs: this.testRuns(),
  });
});
```

```html
@if (developmentMap(); as project) {
  <tri-development-map [project]="project" />
}
```

Use `buildDevelopmentMapProject(manifest, options)` to automatically map the repository manifest
and optional test results into `DevelopmentMapProject`. You can also supply custom `branches`
for manual control.

Plan documents can declare:
- `branch`: visual branch title (defaults to title-cased `initiative_id`).
- `example_id`, `example_title`, `example_href`: interactive example / lab route.
- `evidence_suites`: test suite names whose saved index entries attach to the example card.

Evidence contains summary values from the result index only. Keep raw result
samples and compatible-run comparisons in the project's test-results view. Mark
stale or context-limited evidence explicitly; a metric by itself is not a pass.

The entry has no router, result receiver, renderer or engine-runtime dependency.
Each host chooses links and loading behavior that fit its own application.
