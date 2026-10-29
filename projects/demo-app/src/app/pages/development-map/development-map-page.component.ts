import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  DEFAULT_TEST_SINK_PATH,
  indexUrl,
  parseTestRunIndex,
  type TestRunIndexEntry,
} from 'triangular-engine/testing';
import { DevelopmentMapComponent } from 'triangular-engine/development-map';
import { CatalogThumbnailService } from '../../shared/catalog-thumbnails/catalog-thumbnail.service';
import { DEMOS } from '../demo-index/demo-index.component';
import {
  buildDevelopmentMapProject,
  type EngineeringRecordsManifest,
  type MapExampleSource,
  type MapProjectSource,
} from './development-map-source';

const PAGE_BINDINGS: Readonly<Record<string, { documentIds?: readonly string[]; evidence?: MapExampleSource['evidence'] }>> = {
  water: { documentIds: ['plan-057'] },
  'water-lod-poc': { documentIds: ['plan-057'] },
  'water-surface-spike': { documentIds: ['plan-057'] },
  'water-sphere-poc': { documentIds: ['plan-057'] },
  'water-material-poc': { documentIds: ['plan-057'] },
  'planet-shape-lab': {
    documentIds: ['plan-055'],
    evidence: [{ suite: 'planet-shape-baseline', metrics: ['frameInterval (ms)', 'gpuRender (ms)'] }],
  },
  'illustrative-cell-planet': {
    documentIds: ['plan-054'],
    evidence: [{ suite: 'illustrative-terrain-look', metrics: ['completed-frame-interval (ms)', 'draw-calls (count)', 'triangles (count)'] }],
  },
  'cell-planet-globe': { documentIds: ['plan-065'] },
  'cdlod-planet-lab': { documentIds: ['plan-063'] },
  'lod-surface-lab': {
    documentIds: ['plan-059'],
    evidence: [{ suite: 'lod-surface-baseline', scenarios: ['zoom-plane-100km'], metrics: ['frameInterval (ms)', 'gpuScenePass (ms)', 'surfaceTriangles (count)'] }],
  },
  'planet-scene': {
    documentIds: ['plan-059'],
    evidence: [{ suite: 'planet-scene', metrics: ['frameInterval (ms)', 'gpuScenePass (ms)', 'selectionCpu (ms)'] }],
  },
  'test-results': { documentIds: ['plan-058'] },
  'development-map': { documentIds: ['plan-066'] },
};

function example(id: string, thumbnailSources: Readonly<Record<string, string>>): MapExampleSource | undefined {
  const demo = DEMOS.find((item) => item.id === id);
  if (!demo) return undefined;
  const bindings = PAGE_BINDINGS[id];
  return {
    id: demo.id,
    title: demo.title,
    href: demo.route,
    ...(demo.description ? { description: demo.description } : {}),
    ...(thumbnailSources[demo.route] ? { thumbnailUrl: thumbnailSources[demo.route] } : {}),
    ...(bindings?.documentIds ? { documentIds: bindings.documentIds } : {}),
    ...(bindings?.evidence ? { evidence: bindings.evidence } : {}),
  };
}

const MAP_SOURCE: MapProjectSource = {
  title: 'Triangular Engine Development Map',
  description: 'Explore feature branches, the plans behind their examples, unresolved decisions, and saved test evidence.',
  branches: [
    {
      id: 'water', title: 'Water',
      description: 'Surface models, domains and water rendering experiments.',
      examples: ['water', 'water-lod-poc', 'water-surface-spike', 'water-sphere-poc', 'water-material-poc'].map((id) => id),
    },
    {
      id: 'scatter', title: 'Scatter',
      description: 'Procedural placement, flora and vegetation experiments.',
      examples: ['scatter-lab', 'flora-scatter-lab', 'meadow-lab'],
    },
    {
      id: 'terrain', title: '3D Terrain and Planets',
      description: 'Compare terrain and planet approaches while preserving each experiment as history.',
      examples: ['cdlod-planet-lab', 'planet-shape-lab', 'cell-planet-globe', 'illustrative-cell-planet', 'lod-surface-lab', 'planet-scene'],
    },
    {
      id: 'planning', title: 'Planning and Evidence',
      description: 'The engineering-record format and test-result browser that support the feature branches.',
      examples: ['development-map', 'test-results'],
    },
  ].map((branch) => ({
    ...branch,
    examples: branch.examples.flatMap((id) => {
      const item = example(id, {});
      return item ? [item] : [];
    }),
  })),
};

@Component({
  selector: 'app-development-map-page',
  standalone: true,
  imports: [RouterLink, DevelopmentMapComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <a class="back-link" routerLink="/">← Demo Hub</a>
      <tri-development-map [project]="project()" />
    </main>
  `,
  styles: `
    :host { display: block; min-height: 100%; color: var(--mat-sys-on-surface); background: var(--mat-sys-surface); }
    main { min-height: 100vh; }
    .back-link { display: inline-block; margin: 1rem 0 0 1.25rem; color: var(--mat-sys-primary); }
    tri-development-map {
      --dev-map-text: var(--mat-sys-on-surface);
      --dev-map-bg: var(--mat-sys-surface);
      --dev-map-accent: var(--mat-sys-primary);
      --dev-map-muted: var(--mat-sys-on-surface-variant);
      --dev-map-border: var(--mat-sys-outline-variant);
    }
  `,
})
export class DevelopmentMapPageComponent {
  private readonly thumbnails = inject(CatalogThumbnailService);
  private readonly manifest = signal<EngineeringRecordsManifest | null>(null);
  private readonly runs = signal<readonly TestRunIndexEntry[]>([]);
  private readonly loadErrors = signal<string[]>([]);

  readonly project = computed(() => {
    const sources = this.thumbnails.sources();
    const source: MapProjectSource = {
      ...MAP_SOURCE,
      branches: MAP_SOURCE.branches.map((branch) => ({
        ...branch,
        examples: branch.examples.map((item) => ({
          ...item,
          ...(sources[item.href] ? { thumbnailUrl: sources[item.href] } : {}),
        })),
      })),
      diagnostics: this.loadErrors(),
    };
    const manifest = this.manifest();
    if (!manifest) return {
      title: MAP_SOURCE.title,
      description: MAP_SOURCE.description,
      branches: [],
      timeline: [],
      diagnostics: ['Loading the engineering-record manifest.'],
    };
    return buildDevelopmentMapProject(source, manifest, this.runs());
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    await Promise.all([this.loadManifest(), this.loadRuns()]);
    await this.thumbnails.loaded;
  }

  private async loadManifest(): Promise<void> {
    try {
      const response = await fetch('/development-map/manifest.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Manifest request returned HTTP ${response.status}.`);
      const manifest = await response.json() as EngineeringRecordsManifest;
      if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.documents)) throw new Error('Unsupported development-map manifest.');
      this.manifest.set(manifest);
    } catch (error) {
      this.loadErrors.update((items) => [...items, error instanceof Error ? error.message : 'Could not load the manifest.']);
    }
  }

  private async loadRuns(): Promise<void> {
    try {
      const response = await fetch(indexUrl(DEFAULT_TEST_SINK_PATH), { cache: 'no-store' });
      if (!response.ok) throw new Error(`Test receiver returned HTTP ${response.status}.`);
      this.runs.set(parseTestRunIndex(await response.json()));
    } catch {
      this.loadErrors.update((items) => [...items, 'Saved test evidence is unavailable; start the demo app with its result receiver to load metrics and screenshots.']);
    }
  }
}
