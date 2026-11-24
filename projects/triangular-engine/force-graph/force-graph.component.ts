import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ForceGraphRenderer } from './force-graph-renderer';
import type {
  ForceGraphConfig,
  ForceGraphLink,
  ForceGraphNode,
  ForceGraphPulse,
} from './force-graph.types';

/** Interactive Three.js force-directed graph supporting width-aware text pills and edge pulses. */
@Component({
  selector: 'tri-force-graph',
  standalone: true,
  templateUrl: './force-graph.component.html',
  styleUrl: './force-graph.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForceGraphComponent {
  readonly nodes = input<readonly ForceGraphNode[]>([]);
  readonly links = input<readonly ForceGraphLink[]>([]);
  readonly pulses = input<readonly ForceGraphPulse[]>([]);
  readonly selectedNodeId = input<string | null>(null);
  readonly config = input<ForceGraphConfig>({});

  readonly nodeSelected = output<string | null>();
  readonly nodeHovered = output<string | null>();

  protected readonly webglFailed = signal(false);

  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly destroyRef = inject(DestroyRef);
  private renderer: ForceGraphRenderer | null = null;

  constructor() {
    afterNextRender(() => {
      const canvas = this.canvasRef()?.nativeElement;
      if (!canvas) return;
      const renderer = new ForceGraphRenderer(canvas, this.config());
      renderer.onNodeSelected = (id) => this.nodeSelected.emit(id);
      renderer.onNodeHovered = (id) => this.nodeHovered.emit(id);
      if (!renderer.init()) {
        this.webglFailed.set(true);
        return;
      }
      this.renderer = renderer;
      renderer.setGraph(this.nodes(), this.links(), this.selectedNodeId());
      renderer.enqueuePulses(this.pulses());
    });

    effect(() => {
      const cfg = this.config();
      this.renderer?.updateConfig(cfg);
    });

    effect(() => {
      const nodes = this.nodes();
      const links = this.links();
      const selected = this.selectedNodeId();
      this.renderer?.setGraph(nodes, links, selected);
    });

    effect(() => {
      const pulses = this.pulses();
      if (pulses.length > 0) {
        this.renderer?.enqueuePulses(pulses);
      }
    });

    this.destroyRef.onDestroy(() => {
      this.renderer?.dispose();
      this.renderer = null;
    });
  }

  /** Center and zoom the camera so every active node fits comfortably in the viewport. */
  fitView(padding = 64): void {
    this.renderer?.fitToView(padding);
  }
}
