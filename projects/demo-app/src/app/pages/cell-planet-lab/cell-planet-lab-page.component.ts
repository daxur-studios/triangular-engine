import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { buildPlanetGraphCore, IPlanetGraphCore, IVec3 } from 'triangular-engine/worldgen';

@Component({
  selector: 'app-cell-planet-lab-page',
  imports: [RouterLink, EngineModule],
  templateUrl: './cell-planet-lab-page.component.html',
  styleUrl: './cell-planet-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class CellPlanetLabPageComponent implements AfterViewInit {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly mapCanvas = viewChild<ElementRef<HTMLCanvasElement>>('mapCanvas');

  readonly cellCount = signal(180);
  readonly seed = signal(42);
  readonly relax = signal(2);
  readonly jitter = signal(15);
  readonly showSites = signal(true);
  readonly showEdges = signal(true);

  readonly cellTotal = signal(0);
  readonly edgeTotal = signal(0);
  readonly degreeRange = signal('—');
  readonly buildMs = signal('—');

  private readonly root = new Group();
  private readonly sitesMaterial = new PointsMaterial({
    color: '#f4b860',
    size: 0.022,
    sizeAttenuation: true,
  });
  private readonly edgesMaterial = new LineBasicMaterial({
    color: '#6fe3c0',
    transparent: true,
    opacity: 0.85,
  });
  private sitesPoints: Points | null = null;
  private edgesLines: LineSegments | null = null;

  constructor() {
    this.engine.scene.background = new Color('#050810');
    this.root.name = 'cell-planet-graph';
    this.engine.scene.add(this.root);

    this.destroyRef.onDestroy(() => {
      this.engine.scene.remove(this.root);
      this.sitesPoints?.geometry.dispose();
      this.edgesLines?.geometry.dispose();
      this.sitesMaterial.dispose();
      this.edgesMaterial.dispose();
    });
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => this.regenerate());
  }

  onCellCount(event: Event): void {
    this.cellCount.set(Number((event.target as HTMLInputElement).value));
    this.regenerate();
  }

  onSeed(event: Event): void {
    this.seed.set(Number((event.target as HTMLInputElement).value) || 0);
    this.regenerate();
  }

  shuffleSeed(): void {
    this.seed.set(Math.floor(Math.random() * 999999));
    this.regenerate();
  }

  onRelax(event: Event): void {
    this.relax.set(Number((event.target as HTMLInputElement).value));
    this.regenerate();
  }

  onJitter(event: Event): void {
    this.jitter.set(Number((event.target as HTMLInputElement).value));
    this.regenerate();
  }

  toggleSites(): void {
    this.showSites.update((value) => !value);
    if (this.sitesPoints) this.sitesPoints.visible = this.showSites();
    this.drawMap();
  }

  toggleEdges(): void {
    this.showEdges.update((value) => !value);
    if (this.edgesLines) this.edgesLines.visible = this.showEdges();
    this.drawMap();
  }

  jitterValue(): string {
    return (this.jitter() / 100).toFixed(2);
  }

  private graph: IPlanetGraphCore | null = null;

  private regenerate(): void {
    const t0 = performance.now();
    const graph = buildPlanetGraphCore({
      cellCount: this.cellCount(),
      seed: this.seed(),
      relaxationIterations: this.relax(),
      jitter: this.jitter() / 100,
    });
    const t1 = performance.now();

    this.graph = graph;
    this.buildMs.set(`${(t1 - t0).toFixed(1)} ms`);
    this.rebuildSites(graph);
    this.rebuildEdges(graph);
    this.updateStats(graph);
    this.drawMap();
  }

  private rebuildSites(graph: IPlanetGraphCore): void {
    const positions = new Float32Array(graph.cells.length * 3);
    graph.cells.forEach((cell, i) => {
      positions[i * 3] = cell.center.x;
      positions[i * 3 + 1] = cell.center.y;
      positions[i * 3 + 2] = cell.center.z;
    });

    if (this.sitesPoints) {
      this.root.remove(this.sitesPoints);
      this.sitesPoints.geometry.dispose();
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.sitesPoints = new Points(geometry, this.sitesMaterial);
    this.sitesPoints.visible = this.showSites();
    this.root.add(this.sitesPoints);
  }

  private rebuildEdges(graph: IPlanetGraphCore): void {
    const segments: number[] = [];
    for (const cell of graph.cells) {
      const n = cell.corners.length;
      for (let k = 0; k < n; k++) {
        const a = cell.corners[k];
        const b = cell.corners[(k + 1) % n];
        segments.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }

    if (this.edgesLines) {
      this.root.remove(this.edgesLines);
      this.edgesLines.geometry.dispose();
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(segments, 3));
    this.edgesLines = new LineSegments(geometry, this.edgesMaterial);
    this.edgesLines.visible = this.showEdges();
    this.root.add(this.edgesLines);
  }

  private updateStats(graph: IPlanetGraphCore): void {
    let edgeSum = 0;
    let min = Infinity;
    let max = 0;
    for (const cell of graph.cells) {
      edgeSum += cell.neighbors.length;
      min = Math.min(min, cell.neighbors.length);
      max = Math.max(max, cell.neighbors.length);
    }
    this.cellTotal.set(graph.cells.length);
    this.edgeTotal.set(edgeSum / 2);
    this.degreeRange.set(`${min} / ${max}`);
  }

  private drawMap(): void {
    const graph = this.graph;
    const canvasRef = this.mapCanvas();
    if (!graph || !canvasRef) return;

    const canvas = canvasRef.nativeElement;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.width * 0.5 * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#1b2330';
    ctx.lineWidth = Math.max(1, dpr);
    for (let i = 1; i < 4; i++) {
      const x = (width / 4) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    const midY = height / 2;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    const lonLat = (p: IVec3) => ({
      lon: Math.atan2(p.z, p.x),
      lat: Math.asin(Math.max(-1, Math.min(1, p.y))),
    });
    const mapPoint = (ll: { lon: number; lat: number }) => ({
      x: ((ll.lon / Math.PI) * 0.5 + 0.5) * width,
      y: (1 - ((ll.lat / (Math.PI / 2)) * 0.5 + 0.5)) * height,
    });

    if (this.showEdges()) {
      ctx.strokeStyle = '#6fe3c0';
      ctx.lineWidth = Math.max(1, dpr * 0.8);
      ctx.globalAlpha = 0.8;
      for (const cell of graph.cells) {
        const n = cell.corners.length;
        if (n < 3) continue;
        const lls = cell.corners.map(lonLat);
        for (let k = 0; k < n; k++) {
          const a = lls[k];
          const b = lls[(k + 1) % n];
          if (Math.abs(a.lon - b.lon) > Math.PI * 0.9) continue;
          const pa = mapPoint(a);
          const pb = mapPoint(b);
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    if (this.showSites()) {
      ctx.fillStyle = '#f4b860';
      for (const cell of graph.cells) {
        const p = mapPoint(lonLat(cell.center));
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.6 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
