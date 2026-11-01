import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, isDevMode, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import type { Vector3Tuple } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { JoltPhysicsComponent, JoltPhysicsModule, type IJoltMetadata } from 'triangular-engine/jolt';
import { TestRunnerComponent, type TestRunAdapter } from 'triangular-engine/testing';
import { JOLT_PERF_IDLE_SETTINGS, JOLT_PERF_TEST_HISTORY, type JoltPerfSettings } from './jolt-perf-cases';
import { createJoltPerfTestAdapter, type JoltPerfTestHost } from './jolt-perf-test-adapter';

/** Boxes per row in the dynamic box grid, and the spacing between them, metres. */
const BOX_COLUMNS = 10;
const BOX_SPACING_M = 1.5;
/** Compound bodies per row, and the spacing between them, metres. */
const COMPOUND_COLUMNS = 5;
const COMPOUND_SPACING_M = 4;
/** Frames before the runner may start: the world must exist and a few frames must have drawn. */
const RUNNER_READY_FRAMES = 3;
/** The HUD refreshes this often, in frames. */
const HUD_EVERY_FRAMES = 15;

interface BoxSpec {
  readonly id: number;
  readonly position: Vector3Tuple;
}

/** Four 0.5 m boxes of one compound body: two per side of the centre, at its origin. */
const COMPOUND_CHILDREN: readonly Vector3Tuple[] = [
  [-0.5, 0, -0.5],
  [0.5, 0, -0.5],
  [-0.5, 0, 0.5],
  [0.5, 0, 0.5],
];

function boxPosition(index: number): Vector3Tuple {
  const column = index % BOX_COLUMNS;
  const row = Math.floor(index / BOX_COLUMNS);
  return [(column - (BOX_COLUMNS - 1) / 2) * BOX_SPACING_M, 2 + (index % 5) * 0.6, (row - 4.5) * BOX_SPACING_M];
}

function compoundPosition(index: number): Vector3Tuple {
  const column = index % COMPOUND_COLUMNS;
  const row = Math.floor(index / COMPOUND_COLUMNS);
  return [(column - (COMPOUND_COLUMNS - 1) / 2) * COMPOUND_SPACING_M, 3 + (index % 3) * 0.8, (row - 0.5) * COMPOUND_SPACING_M];
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

/**
 * Performance page for the Jolt entry: a static ground box, then the case's dynamic bodies (boxes or four-box compounds)
 * under gravity. The test runner (suite `jolt-perf`) sets the scene; the page shows the live HUD and never sets numbers itself.
 */
@Component({
  selector: 'app-jolt-perf-page',
  imports: [RouterLink, EngineModule, JoltPhysicsModule, TestRunnerComponent],
  templateUrl: './jolt-perf-page.component.html',
  styleUrl: './jolt-perf-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class JoltPerfPageComponent {
  readonly engine = inject(EngineService);
  readonly destroyRef = inject(DestroyRef);
  readonly physics = viewChild.required(JoltPhysicsComponent);

  readonly testHistory = JOLT_PERF_TEST_HISTORY;
  readonly allowTestAutoStart = isDevMode();
  readonly runnerReady = signal(false);

  /** The scene the runner has set; the page shows it and builds nothing else. */
  readonly settings = signal<JoltPerfSettings>(JOLT_PERF_IDLE_SETTINGS);
  readonly boxes = computed<readonly BoxSpec[]>(() => {
    const current = this.settings();
    return current.scene === 'boxes' ? range(current.count).map((id) => ({ id, position: boxPosition(id) })) : [];
  });
  readonly compounds = computed<readonly BoxSpec[]>(() => {
    const current = this.settings();
    return current.scene === 'compound' ? range(current.count).map((id) => ({ id, position: compoundPosition(id) })) : [];
  });
  readonly compoundChildren = COMPOUND_CHILDREN;

  readonly hudBodies = signal(0);
  readonly hudPhysicsMs = signal(0);
  readonly hudFaults = signal(0);
  readonly sceneLabel = computed(() => {
    const current = this.settings();
    if (current.probe !== 'steps') return `${current.probe} probe`;
    return current.scene === 'empty' ? 'no bodies' : `${current.count} ${current.scene === 'boxes' ? 'boxes' : 'compound bodies'}`;
  });

  readonly #faultCount = signal(0);
  #frames = 0;

  readonly #testHost: JoltPerfTestHost = {
    read: () => this.settings(),
    apply: (settings) => this.settings.set(settings),
    metadata: (): IJoltMetadata | undefined => this.physics().physicsService.metaData$.value,
    dynamicBodies: () => this.physics().physicsService.bodies$.value.filter((body) => body.IsDynamic()).length,
    onFrame: (callback) => {
      const subscription = this.engine.beforeRender$.subscribe(() => callback());
      return () => subscription.unsubscribe();
    },
    onSubstep: (callback) => {
      const subscription = this.physics().physicsService.tick$.subscribe(() => callback());
      return () => subscription.unsubscribe();
    },
    physicsMs: () => this.engine.fpsController.physicsTime(),
    physicsFaults: () => this.#faultCount(),
  };

  readonly testAdapter: TestRunAdapter<JoltPerfSettings, JoltPerfSettings> = createJoltPerfTestAdapter(this.#testHost);

  constructor() {
    this.engine.beforeRender$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.#onFrame());
  }

  onPhysicsFault(): void {
    this.#faultCount.update((count) => count + 1);
  }

  #onFrame(): void {
    this.#frames++;
    if (!this.runnerReady() && this.#frames > RUNNER_READY_FRAMES && this.#testHost.metadata()) {
      this.runnerReady.set(true);
    }
    if (this.#frames % HUD_EVERY_FRAMES === 0) {
      this.hudBodies.set(this.#testHost.dynamicBodies());
      this.hudPhysicsMs.set(this.#testHost.physicsMs());
      this.hudFaults.set(this.#testHost.physicsFaults());
    }
  }
}
