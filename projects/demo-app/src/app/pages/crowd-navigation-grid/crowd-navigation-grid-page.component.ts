import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  LinearFilter,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  generateIslandHeightfield,
  NavFlag,
  NavGrid,
  NAV_CLEARANCE_THRESHOLDS,
  type NavUnitClass,
} from 'triangular-engine/crowd-navigation';
import { fillOverlay, NAV_OVERLAYS, type NavOverlayId } from './nav-overlays';

/** Cells along each side of the rendered demo island (1 m cells). */
const GRID_SIZE = 512;

/**
 * Plan 086, phase grid-layers. Builds a {@link NavGrid} from a generated island, stamps a few
 * example buildings, a wall with a gap and a gate, a road and two territories, and draws any layer
 * as a data texture on the terrain mesh. The grid is 512 x 512 cells at 1 m (the 2,048 x 2,048
 * size is only built in the spec/benchmark).
 */
@Component({
  selector: 'app-crowd-navigation-grid-page',
  imports: [EngineModule, RouterLink, DecimalPipe],
  templateUrl: './crowd-navigation-grid-page.component.html',
  styleUrl: './crowd-navigation-grid-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class CrowdNavigationGridPageComponent {
  private readonly engine = inject(EngineService);

  readonly overlays = NAV_OVERLAYS;
  readonly overlay = signal<NavOverlayId>('terrain');
  readonly legend = computed(() => NAV_OVERLAYS.find((o) => o.id === this.overlay())?.legend ?? []);
  readonly gateOpen = signal(false);
  readonly gridSize = GRID_SIZE;
  readonly buildMs = signal(0);
  readonly editMs = signal(0);
  readonly passable = signal<Record<NavUnitClass, number>>({ villager: 0, catapult: 0, creature: 0 });

  private readonly grid: NavGrid;
  private readonly pixels = new Uint8Array(GRID_SIZE * GRID_SIZE * 4);
  private readonly texture: DataTexture;
  private readonly gate = { x: 0, y: 0, width: 2, height: 3 };

  constructor() {
    this.engine.scene.background = new Color('#0e1620');

    const t0 = performance.now();
    const heightfield = generateIslandHeightfield({
      size: GRID_SIZE,
      maxHeight: 45,
      featureSize: 170,
      seed: 7,
    });
    this.grid = NavGrid.fromHeightfield(heightfield);
    this.buildMs.set(Math.round(performance.now() - t0));
    this.stampExamples();

    this.texture = new DataTexture(this.pixels, GRID_SIZE, GRID_SIZE, RGBAFormat, UnsignedByteType);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.redraw();

    const mesh = new Mesh(
      this.createTerrainGeometry(),
      new MeshLambertMaterial({ map: this.texture }),
    );
    this.engine.scene.add(mesh);
    inject(DestroyRef).onDestroy(() => {
      this.engine.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as MeshLambertMaterial).dispose();
      this.texture.dispose();
    });
  }

  selectOverlay(id: NavOverlayId): void {
    this.overlay.set(id);
    this.redraw();
  }

  toggleGate(): void {
    const open = !this.gateOpen();
    this.gateOpen.set(open);
    const t0 = performance.now();
    this.grid.setGateOpen(this.gate, open);
    this.editMs.set(performance.now() - t0);
    this.redraw();
  }

  private redraw(): void {
    fillOverlay(this.grid, this.overlay(), this.pixels);
    this.texture.needsUpdate = true;
    const counts: Record<NavUnitClass, number> = { villager: 0, catapult: 0, creature: 0 };
    const { flags, clearance } = this.grid;
    for (let i = 0; i < flags.length; i++) {
      if (flags[i] & NavFlag.BLOCKED) continue;
      for (const c of ['villager', 'catapult', 'creature'] as const) {
        if (clearance[i] >= NAV_CLEARANCE_THRESHOLDS[c]) counts[c]++;
      }
    }
    this.passable.set(counts);
  }

  /** Finds a flat walkable site nearest the island centre and stamps example content on it. */
  private stampExamples(): void {
    const w = 80;
    const h = 56;
    const c = GRID_SIZE / 2;
    let site = { x: c - w / 2, y: c - h / 2 };
    search: for (let r = 0; r < 200; r += 6) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(c + r * Math.cos((a / 16) * Math.PI * 2) - w / 2);
        const y = Math.round(c + r * Math.sin((a / 16) * Math.PI * 2) - h / 2);
        if (this.siteIsFlat(x, y, w, h)) {
          site = { x, y };
          break search;
        }
      }
    }
    const g = this.grid;
    const at = (x: number, y: number, width: number, height: number) => ({
      x: site.x + x,
      y: site.y + y,
      width,
      height,
    });
    // Two houses west of a wall, one barn east of it.
    g.stampStructure(at(4, 4, 12, 8));
    g.stampStructure(at(4, 36, 14, 9));
    g.stampStructure(at(58, 6, 10, 10));
    // A wall with a 2-cell gap (villager only) and a 3-cell gate (closed).
    g.stampStructure(at(36, 0, 2, h));
    g.clearStructure(at(36, 22, 2, 2));
    Object.assign(this.gate, at(36, 36, 2, 3));
    g.stampGate(this.gate, false);
    // A road from the west house through the gap to the barn.
    g.paintRoadLine(site.x + 10, site.y + 13, site.x + 35, site.y + 23, 1);
    g.paintRoadLine(site.x + 35, site.y + 23, site.x + 38, site.y + 23, 1);
    g.paintRoadLine(site.x + 38, site.y + 23, site.x + 62, site.y + 17, 1);
    // Territory: west half faction 1, a patch east faction 2.
    g.paintTerritory(at(0, 0, 36, h), 1);
    g.paintTerritory(at(50, 0, 30, h), 2);
  }

  private siteIsFlat(x: number, y: number, w: number, h: number): boolean {
    if (x < 8 || y < 8 || x + w > GRID_SIZE - 8 || y + h > GRID_SIZE - 8) return false;
    for (let yy = y; yy < y + h; yy += 2) {
      for (let xx = x; xx < x + w; xx += 2) {
        const i = yy * GRID_SIZE + xx;
        if (this.grid.flags[i] & NavFlag.BLOCKED || this.grid.terrain[i] > 40) return false;
      }
    }
    return true;
  }

  /** One vertex per cell centre, X/Z in metres centred on the island, Y from the heightfield. */
  private createTerrainGeometry(): BufferGeometry {
    const n = GRID_SIZE;
    const g = this.grid;
    const positions = new Float32Array(n * n * 3);
    const uvs = new Float32Array(n * n * 2);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        positions[i * 3] = (x - n / 2) * g.cellSize;
        positions[i * 3 + 1] = Math.max(g.heights[i], 0);
        positions[i * 3 + 2] = (y - n / 2) * g.cellSize;
        uvs[i * 2] = (x + 0.5) / n;
        uvs[i * 2 + 1] = (y + 0.5) / n;
      }
    }
    const index = new Uint32Array((n - 1) * (n - 1) * 6);
    let k = 0;
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const a = y * n + x;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        index[k++] = a;
        index[k++] = c;
        index[k++] = b;
        index[k++] = b;
        index[k++] = c;
        index[k++] = d;
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    geometry.setIndex(new BufferAttribute(index, 1));
    geometry.computeVertexNormals();
    return geometry;
  }
}
