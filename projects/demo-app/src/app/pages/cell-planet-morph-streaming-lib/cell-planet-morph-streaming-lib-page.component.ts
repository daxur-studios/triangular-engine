import { Component, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EngineModule, RaycastOrbitControlsComponent } from 'triangular-engine';
import type {
  ITerrainPatchMesh,
  ITerrainSurfaceGenerationRequest,
  ITerrainSurfaceLodStats,
  ILatLonTerrainPatchAddress,
} from 'triangular-engine/terrain';
import {
  CellPlanetMorphStreamingViewComponent,
  WORLD_SIZE_TIER_RADIUS_M,
} from 'triangular-engine/worldgen/render';
import { CELL_PLANET_U0_FIXTURE } from '../cell-planet-u0-fixture';
import { getTerrainHeightScaleM } from '../cell-planet-25d-map/cell-planet-terrain-scale';
import type {
  CellPlanetMorphWorkerRequest,
} from '../cell-planet-morph-streaming/cell-planet-morph-streaming.worker';

/**
 * Sanity-check page for `CellPlanetMorphStreamingViewComponent`: the library's reusable
 * extraction of this same sublibrary's `cell-planet-morph-streaming` demo. Deliberately reuses
 * that demo's worker unmodified (mesh generation is app-owned by design - see the component's
 * doc comment) to prove the extracted LOD selector, raycaster and default material produce the
 * same behaviour through the new component as the original page did directly.
 */
@Component({
  standalone: true,
  selector: 'app-cell-planet-morph-streaming-lib-page',
  imports: [EngineModule, RouterLink, RaycastOrbitControlsComponent, CellPlanetMorphStreamingViewComponent],
  host: { class: 'flex-page' },
  template: `
    <scene [showFps]="true" [logarithmicDepthBuffer]="true">
      <raycastOrbitControls
        [cameraPosition]="[0, 0, radius * 2.6]"
        [target]="[0, 0, 0]"
        [near]="0.5"
        [far]="10000000"
        [raycastFocusResolver]="planetView.raycastFocusResolver"
      />
      <ambientLight [intensity]="1.2" />
      <directionalLight [position]="[2500, 3500, 3000]" [intensity]="2.2" />

      <cellPlanetMorphStreamingView
        #planetView
        [radiusM]="radius"
        [meshGenerator]="meshGenerator"
        [morphProgress]="morphProgress()"
        [maxLod]="6"
        [resolution]="32"
        (lodChange)="onLodChange($event)"
      />
    </scene>

    <aside class="panel">
      <a routerLink="/">← Examples</a>
      <h2>Cell Planet · Morph Streaming (library component)</h2>
      <p>Verifies the extracted <code>CellPlanetMorphStreamingViewComponent</code> against the
      proven demo's own worker.</p>
      <input
        type="range"
        min="0"
        max="1"
        step="0.005"
        [value]="morphProgress()"
        (input)="setMorph($event)"
      />
      <p>Resident: {{ stats().resident }} · Triangles: {{ stats().triangles }}</p>
    </aside>
  `,
  styles: `
    :host { position: relative; }
    .panel { position: absolute; top: 1rem; left: 1rem; background: rgba(10,14,20,0.85); color: #eee; padding: 1rem; border-radius: 8px; max-width: 320px; font: 13px/1.4 system-ui; z-index: 20; }
    .panel input { width: 100%; }
  `,
})
export class CellPlanetMorphStreamingLibPageComponent {
  private readonly destroyRef = inject(DestroyRef);
  readonly radius = WORLD_SIZE_TIER_RADIUS_M.medium;
  readonly morphProgress = signal(0);
  readonly stats = signal<ITerrainSurfaceLodStats>({
    desired: 0,
    resident: 0,
    queued: 0,
    drawCalls: 0,
    triangles: 0,
    geometryBytes: 0,
    levels: {},
  });

  private readonly worker = new Worker(
    new URL(
      '../cell-planet-morph-streaming/cell-planet-morph-streaming.worker',
      import.meta.url,
    ),
    { type: 'module' },
  );
  private nextRequestId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (patch: ITerrainPatchMesh<ILatLonTerrainPatchAddress>) => void; reject: (e: Error) => void }
  >();

  constructor() {
    this.worker.onmessage = ({ data }: MessageEvent<{ id: number; patch?: ITerrainPatchMesh<ILatLonTerrainPatchAddress>; error?: string }>) => {
      const entry = this.pending.get(data.id);
      if (!entry) return;
      this.pending.delete(data.id);
      if (data.error) entry.reject(new Error(data.error));
      else if (data.patch) entry.resolve(data.patch);
    };
    this.destroyRef.onDestroy(() => this.worker.terminate());
  }

  readonly meshGenerator = (
    request: ITerrainSurfaceGenerationRequest<ILatLonTerrainPatchAddress>,
  ): Promise<ITerrainPatchMesh<ILatLonTerrainPatchAddress>> => {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const workerRequest: CellPlanetMorphWorkerRequest = {
        id,
        address: request.address,
        radius: this.radius,
        baseResolution: request.baseResolution ?? request.resolution,
        resolution: request.resolution,
        edgeRefinementMask: request.edgeRefinementMask,
        edgeRefinementLevel: request.edgeRefinementLevel,
        edgeRefinementLevels: request.edgeRefinementLevels,
        edgeRefinementSegments: request.edgeRefinementSegments,
        reduction: 0.35,
        targetError: 0.08,
        projectionKind: 'equalEarth',
        colorMode: 'material',
        heightScale: getTerrainHeightScaleM(this.radius, 4),
        worldProfile: CELL_PLANET_U0_FIXTURE.worldProfile,
        seed: CELL_PLANET_U0_FIXTURE.seed,
      };
      this.worker.postMessage(workerRequest);
    });
  };

  setMorph(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) this.morphProgress.set(Math.max(0, Math.min(1, value)));
  }

  onLodChange(stats: ITerrainSurfaceLodStats): void {
    this.stats.set(stats);
  }
}
