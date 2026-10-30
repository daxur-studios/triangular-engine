import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CatalogThumbnailComponent } from '../../shared/catalog-thumbnails/catalog-thumbnail.component';
import { ThemeService } from '../../theme/theme.service';

export type SpikeStatus = 'passed' | 'failed' | 'pending' | 'inconclusive';

export interface ISpikeItem {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly route: string;
  readonly status: SpikeStatus;
  readonly hypothesis: string;
  readonly description: string;
  readonly runbookPath: string;
  readonly dateISO: string;
}

/**
 * Falsifiable spikes (see docs/runbook/028_planet_terrain_attempt_history.md
 * "Falsifiable spike suite"): each entry is disposable, timeboxed, and either
 * passes its stated pass/fail threshold or kills a specific architecture —
 * distinct from the Demo Hub's polished/ongoing demos.
 */
export const SPIKES: readonly ISpikeItem[] = [
  {
    id: 'gpu-morph-lod-spike',
    number: '1',
    title: 'GPU Morph LOD (shared buffer + per-vertex world-space morph)',
    route: '/gpu-morph-lod-spike',
    status: 'passed',
    hypothesis:
      'One shared vertex buffer + per-mip index buffers + per-vertex world-space height/morph, with a neighbour-LOD-aware border clamp closing the T-junction at ring boundaries, can replace CDLOD\'s CPU-remeshed patches: crack-free by construction, draw calls bounded to one InstancedMesh per LOD level, and no geometry cache to evict or race — the failure class behind CS-019\'s flicker.',
    description:
      'Uses the shared triangular-engine/terrain clipmap implementation in an engine scene. Toggle morph off to see the cracks it normally hides; freeze the camera to repeat the attempt-2 static-camera flicker check.',
    runbookPath: 'docs/runbook/028_planet_terrain_attempt_history.md',
    dateISO: '2026-09-06',
  },
  {
    id: 'clipmap-far-coverage-spike',
    number: '2',
    title: 'Clipmap far coverage (horizon-scale LOD ring extension)',
    route: '/clipmap-far-coverage-spike',
    status: 'passed',
    hypothesis:
      'Extending gpu-morph-lod-spike\'s shared-vertex-buffer + per-mip-index-buffer clipmap rings outward with several more LOD levels reaching horizon-scale radii keeps draw calls bounded to one InstancedMesh per LOD level (not growing with ring count) and keeps outer-ring visual detail acceptable — the untested "far coverage" half of runbook 028\'s Candidate B / Spike 4, distinct from the near-boundary case the passed spike already covers.',
    description:
      'Built on the shared triangular-engine/terrain clipmap builder, extended to 12 levels (~131km outer ring). Draw calls stayed bounded at one InstancedMesh per level (12 total) across the full sweep from 30m to past the outer ring, with no per-frame flicker on a frozen camera. Found and fixed two real bugs along the way: (1) analytic hash-noise terrain loses float precision at horizon-scale coordinates — defaults to wave-based terrain for legible far-field visuals, noise kept as a toggle to demonstrate the limit; (2) the border-blend T-junction fix assumed unbounded stride doubling (4^level), which broke once far levels\' stride got clamped to GRID_RESOLUTION — collapsed far-tile vertices onto a shared coarse grid. Fixed with a realVertexSpacingM() helper mirroring the CPU-side clamp.',
    runbookPath: 'docs/runbook/028_planet_terrain_attempt_history.md',
    dateISO: '2026-09-13',
  },
  {
    id: 'cell-subdivision-lod-lab',
    number: '3',
    title: 'Cell Subdivision LOD (joint interior Voronoi diagram)',
    route: '/cell-subdivision-lod-lab',
    status: 'failed',
    hypothesis:
      'Region-scoped Voronoi cell subdivision (mutually in-range coarse cells sharing one joint interior Voronoi diagram while keeping outer boundaries straight) can eliminate LOD crack artifacts without skirts across arbitrary elevation scales while meeting real-time rendering performance.',
    description:
      'Boundary proof-of-concept for buildSubdividedRegionMeshData(). Falsified on performance: while geometrically crack-free without skirts, CPU-side Voronoi diagram construction, Delaunay triangulation, and dynamic re-meshing are not performant for real-time terrain, causing severe frame-time spikes during camera movement and LOD swaps.',
    runbookPath: 'docs/runbook/028_planet_terrain_attempt_history.md',
    dateISO: '2026-09-19',
  },
  {
    id: 'planet-surface-detail-spike',
    number: '4',
    title: 'Planet surface detail LOD (S1: flat runway in the material)',
    route: '/planet-surface-detail-spike',
    status: 'pending',
    hypothesis:
      'A 2 km x 45 m runway drawn by an analytic SDF layer in the planet surface material, on terrain flattened under it by a height stamp in the height source, stays on the ground with no gap or cut at every terrain LOD, and its markings stay sharp up close (Plan 063 Q2). Q1/Q3 (forest far form) follow if Q2 holds.',
    description:
      'Clone of /cell-planet-tsl with a spike worker that stamps the runway into the terrain heights and a TSL runway layer. ?runway=on|paint|stamp|off.',
    runbookPath: 'docs/runbook/063_planet_surface_detail_lod.md',
    dateISO: '2026-10-25',
  },
  {
    id: 'lod-surface-morph-spike',
    number: '5',
    title: 'LOD surface globe-to-map morph (precision and the map cut)',
    route: '/lod-surface-morph-spike',
    status: 'passed',
    hypothesis:
      'Bending the Plan 059 LOD terrain from globe to map, with the CPU bending each leaf\'s origin in doubles and the GPU bending only the offset inside the leaf, keeps vertex jitter under a pixel 2 m above the ground at morph 0.5 and 1 on the 600 km and 6,371 km spheres, and the fragment cull at the map\'s cut leaves no visible gap (Plan 059 D11 risks 1 and 2, before G6).',
    description:
      'The lod-surface terrain with the bend from planet-material in its vertex stage; compares the per-leaf bend against a full float bend and masks the cut.',
    runbookPath: 'docs/runbook/059_lod_surface_core.md',
    dateISO: '2026-10-29',
  },
];

const STATUS_LABEL: Record<SpikeStatus, string> = {
  passed: 'Passed',
  failed: 'Failed',
  pending: 'Pending',
  inconclusive: 'Inconclusive',
};

@Component({
  selector: 'app-spikes-index',
  imports: [RouterLink, CatalogThumbnailComponent],
  templateUrl: './spikes-index.component.html',
  styleUrl: './spikes-index.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex-page' },
})
export class SpikesIndexComponent {
  readonly spikes = SPIKES;
  readonly statusLabel = STATUS_LABEL;

  /** Active theme, driven by the app-wide ThemeService. */
  protected readonly themeService = inject(ThemeService);

  /** Switch the demo app between light and dark themes. */
  toggleTheme(): void {
    this.themeService.toggle();
  }

  readonly searchQuery = signal('');
  readonly selectedStatus = signal<'visible' | 'all' | SpikeStatus>('visible');

  readonly totalCount = SPIKES.length;
  readonly passedCount = SPIKES.filter((s) => s.status === 'passed').length;
  readonly failedCount = SPIKES.filter((s) => s.status === 'failed').length;
  readonly pendingCount = SPIKES.filter((s) => s.status === 'pending').length;
  readonly inconclusiveCount = SPIKES.filter((s) => s.status === 'inconclusive').length;
  readonly visibleCount = SPIKES.filter((s) => s.status === 'passed' || s.status === 'pending').length;

  readonly filteredSpikes = computed<readonly ISpikeItem[]>(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const status = this.selectedStatus();

    return this.spikes.filter((spike) => {
      if (status === 'visible') {
        if (spike.status === 'failed' || spike.status === 'inconclusive') return false;
      } else if (status !== 'all' && spike.status !== status) return false;
      if (!q) return true;
      return (
        spike.title.toLowerCase().includes(q) ||
        spike.hypothesis.toLowerCase().includes(q) ||
        spike.description.toLowerCase().includes(q) ||
        spike.number.includes(q)
      );
    });
  });

  readonly hasActiveFilters = computed<boolean>(
    () => this.searchQuery().trim().length > 0 || this.selectedStatus() !== 'visible',
  );

  setSearchQuery(query: string): void {
    this.searchQuery.set(query);
  }

  selectStatus(status: 'visible' | 'all' | SpikeStatus): void {
    this.selectedStatus.set(status);
  }

  clearFilters(): void {
    this.searchQuery.set('');
    this.selectedStatus.set('visible');
  }
}
