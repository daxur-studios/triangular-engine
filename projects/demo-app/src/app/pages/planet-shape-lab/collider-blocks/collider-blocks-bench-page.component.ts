import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, isDevMode, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TestRunnerComponent } from 'triangular-engine/testing';
import { ColliderBlockWorkerPool } from './block-worker-pool';
import { RADIUS_M } from './block-fixtures';
import { COLLIDER_BLOCKS_TEST_HISTORY, createColliderBlocksTestAdapter } from './collider-blocks-tests';
import { createGpuDensityBlockGenerator, type GpuDensityBlockGenerator } from './gpu-density-block';

/**
 * Plan 055 D2 bench: runs the collider-block timings on the machine's real GPU through the test panel. No scene: the
 * compute pass owns its own WebGPU renderer, and the CPU path is a worker pool.
 */
@Component({
  selector: 'app-collider-blocks-bench-page',
  imports: [RouterLink, TestRunnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <a routerLink="/">← Examples</a>
      <h2>Collider blocks: GPU density vs CPU workers</h2>
      <p>Plan 055 D2. {{ status() }}</p>
      <tri-test-runner [suites]="suites" [adapter]="adapter" [available]="ready()" [allowAutoStart]="allowAutoStart" [resultSink]="true" />
    </main>
  `,
  styles: ['main { max-width: 56rem; margin: 0 auto; padding: 16px; } a { color: inherit; }'],
})
export class ColliderBlocksBenchPageComponent implements OnInit, OnDestroy {
  readonly suites = COLLIDER_BLOCKS_TEST_HISTORY;
  readonly allowAutoStart = isDevMode();
  readonly ready = signal(false);
  readonly status = signal('Starting WebGPU…');
  private gpu: GpuDensityBlockGenerator | null = null;
  private readonly workers = new ColliderBlockWorkerPool(Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)));
  readonly adapter = createColliderBlocksTestAdapter({ generator: () => this.gpu, pool: () => this.workers });

  async ngOnInit(): Promise<void> {
    try {
      this.gpu = await createGpuDensityBlockGenerator(RADIUS_M);
    } catch (error) {
      console.warn('collider blocks bench: GPU generator failed', error);
    }
    this.status.set(this.gpu
      ? `Adapter: ${this.gpu.adapter}. ${this.workers.size} CPU workers.`
      : `WebGPU is not available; only the CPU rows can run. ${this.workers.size} CPU workers.`);
    this.ready.set(true);
  }

  ngOnDestroy(): void {
    this.gpu?.dispose();
    this.workers.dispose();
  }
}
