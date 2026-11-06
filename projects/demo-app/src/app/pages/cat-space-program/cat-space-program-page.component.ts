import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  isDevMode,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Box3,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  Material,
  MeshStandardMaterial,
  Raycaster,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { ALL_CAPSULE_CHARACTER_PRESETS } from 'triangular-engine/characters';
import {
  CapsuleCatActor,
  CapsuleCharacterActor,
} from 'triangular-engine/procedural';
import {
  TestRunnerComponent,
  type TestProgress,
  type TestRunAdapter,
  type TestSuite,
} from 'triangular-engine/testing';
import {
  MoonBoopGame,
  MOON_GOAL,
  SOURCE_PERIOD,
  SOURCE_POSITION,
  SCENARIOS,
  type BoopScenario,
  type CatSource,
} from './moon-boop-game';

type CameraView = 'overview' | 'collector' | 'tower';
type GameAction =
  | 'stack'
  | 'collector'
  | 'pause'
  | 'shoes'
  | 'basket'
  | 'food'
  | 'nursery'
  | 'reset'
  | 'select'
  | 'camera'
  | 'highlights';
interface TargetBounds {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface PageSnapshot {
  game: ReturnType<MoonBoopGame['snapshot']>;
  view: CameraView;
  selected: string;
  highlights: boolean;
  camera: [number, number, number];
  target: [number, number, number];
}
/** Deliberately page-owned: agents use this supported surface, never a Three.js traversal. */
export interface MoonBoopDemo {
  ready(): boolean;
  read(): ReturnType<MoonBoopGame['snapshot']>['state'];
  selection(): string;
  act(action: GameAction, value?: string): boolean;
  targets(): readonly TargetBounds[];
  actions: readonly GameAction[];
}
declare global {
  interface Window {
    moonBoopDemo?: MoonBoopDemo;
  }
}

const LABELS: Record<string, string> = {
  catnip: 'Catnip garden',
  food: 'Wet-food bowl',
  nursery: 'Kitten nursery',
  collector: 'Mission specialist',
  tower: 'Cat launch tower',
  moon: 'The Moon',
};
const TOWER_STEP = 0.53;
const MOON_Y = 11.35;
const COLORS = [
  '#f4bc77',
  '#c5cff7',
  '#f5eee5',
  '#8b8d9a',
  '#cda4e8',
  '#dd9b78',
];

@Component({
  selector: 'app-cat-space-program-page',
  standalone: true,
  imports: [EngineModule, RouterLink, DecimalPipe, TestRunnerComponent],
  providers: [EngineService.provide({ showFPS: true })],
  templateUrl: './cat-space-program-page.component.html',
  styleUrl: './cat-space-program-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex-page' },
})
export class CatSpaceProgramPageComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  readonly game = new MoonBoopGame();
  readonly ui = signal(this.game.snapshot().state);
  readonly goal = MOON_GOAL;
  readonly scenarios = SCENARIOS;
  readonly stacked = computed(
    () => this.ui().cats.filter((c) => c.place === 'stacked').length,
  );
  readonly waiting = computed(
    () => this.ui().cats.filter((c) => c.place === 'waiting').length,
  );
  readonly selected = signal('tower');
  readonly highlights = signal(false);
  readonly view = signal<CameraView>('overview');
  readonly ready = signal(false);
  readonly testBusy = signal(false);
  readonly allowAutoStart = isDevMode();
  readonly cameraPosition = signal<[number, number, number]>([15, 12, 19]);
  readonly cameraTarget = signal<[number, number, number]>([0, 4.3, 0]);
  readonly highlight = signal<TargetBounds | null>(null);
  readonly viewport = signal({ width: 800, height: 600 });
  readonly counts = signal({ calls: 0, triangles: 0 });
  private readonly root = new Group();
  private readonly cats = new Map<number, CapsuleCatActor>();
  private readonly objects = new Map<string, Group | Mesh>();
  private readonly human = new CapsuleCharacterActor({
    dna: ALL_CAPSULE_CHARACTER_PRESETS[0],
    autoBlink: true,
  });
  private readonly towerTarget = new Group();
  private readonly raycaster = new Raycaster();
  private readonly pointerDown = new Vector2();
  private pointerHeld = false;
  private uiElapsed = 0;
  private frames = 0;
  private animationTime = 0;
  private readonly sourceMaterials = new Map<CatSource, MeshStandardMaterial>();
  private readonly api: MoonBoopDemo = {
    ready: () => this.ready(),
    read: () => this.game.snapshot().state,
    selection: () => this.selected(),
    act: (action, value) => this.act(action, value),
    targets: () =>
      [...this.objects.keys()]
        .map((id) => this.bounds(id))
        .filter((b): b is TargetBounds => b !== null),
    actions: [
      'stack',
      'collector',
      'pause',
      'shoes',
      'basket',
      'food',
      'nursery',
      'reset',
      'select',
      'camera',
      'highlights',
    ],
  };
  readonly suites: readonly TestSuite<{
    kind: 'collection' | 'pause' | 'nursery';
  }>[] = [
    {
      id: 'moon-boop-functional',
      version: 1,
      title: 'Moon Boop · collector, pause and kitten batch',
      purpose: 'functional',
      requiresVisualReview: true,
      scenarios: [
        {
          id: 'collector-delivery',
          label: 'One human collects and stacks a cat',
          durationMs: 20000,
          settings: { kind: 'collection' },
        },
        {
          id: 'pause-production',
          label: 'Pause freezes production and movement',
          durationMs: 700,
          settings: { kind: 'pause' },
        },
        {
          id: 'six-kittens',
          label: 'Nursery produces six kittens after its countdown',
          durationMs: 22000,
          settings: { kind: 'nursery' },
        },
      ],
    },
  ];
  readonly adapter: TestRunAdapter<
    { kind: 'collection' | 'pause' | 'nursery' },
    PageSnapshot
  > = {
    capture: () => this.snapshot(),
    apply: (scenario) => {
      this.game.reset(
        scenario.settings.kind === 'nursery' ? 'kittens' : 'garden',
      );
      if (scenario.settings.kind === 'collection') this.game.toggleAuto();
      if (scenario.settings.kind === 'pause') this.game.state.paused = true;
      this.sync();
    },
    ready: (context) => this.waitRendered(context.signal),
    measure: async (scenario, context) => {
      const before = this.game.snapshot();
      if (scenario.settings.kind === 'pause')
        await context.wait(scenario.durationMs);
      else
        await this.waitGame(
          () =>
            scenario.settings.kind === 'collection'
              ? this.game.stacked > 0
              : this.game.state.cats.filter((c) => c.source === 'nursery')
                  .length === 6,
          context.signal,
          scenario.durationMs,
        );
      const s = this.game.state,
        kind = scenario.settings.kind;
      return {
        metrics: [],
        checks: [
          {
            name: 'Expected game transition',
            passed:
              kind === 'collection'
                ? this.game.stacked > 0
                : kind === 'pause'
                  ? JSON.stringify(before) ===
                    JSON.stringify(this.game.snapshot())
                  : s.cats.filter((c) => c.source === 'nursery').length === 6,
            detail:
              kind === 'collection'
                ? `${this.game.stacked} delivered`
                : kind === 'pause'
                  ? 'Full model snapshot unchanged while paused'
                  : `${s.cats.filter((c) => c.source === 'nursery').length} nursery cats`,
          },
          {
            name: 'One collector and bounded population',
            passed: this.human.root.parent === this.root && s.cats.length <= 30,
          },
        ],
        limitations: [
          'Functional game checks; no GPU performance or appearance acceptance.',
        ],
      };
    },
    restore: async (snapshot, context) => {
      this.restore(snapshot);
      await this.waitRendered(context.signal);
    },
  };

  constructor() {
    this.engine.scene.background = new Color('#101b2d');
    this.engine.scene.add(this.root);
    this.createWorld();
    this.human.root.scale.setScalar(0.75);
    this.root.add(this.human.root);
    this.objects.set('collector', this.human.root);
    this.objects.set('tower', this.towerTarget);
    this.root.add(this.towerTarget);
    this.sync();
    if (isDevMode()) window.moonBoopDemo = this.api;
    this.engine.tick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((dt) => this.tick(dt));
    this.engine.renderComplete$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const canvas = this.engine.canvas;
        if (
          !this.ready() &&
          canvas?.isConnected &&
          canvas.width > 1 &&
          canvas.height > 1
        )
          this.ready.set(true);
        if (++this.frames % 10 === 0) {
          this.viewport.set({
            width: canvas.clientWidth,
            height: canvas.clientHeight,
          });
          const r = this.engine.renderer.info.render;
          this.counts.set({ calls: r.calls, triangles: r.triangles });
        }
        if (this.highlights()) this.highlight.set(this.bounds(this.selected()));
        else if (this.highlight()) this.highlight.set(null);
      });
    this.engine.mousedown$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((e) => {
        if (!e || e.button !== 0 || this.testBusy()) return;
        this.pointerDown.set(e.clientX, e.clientY);
        this.pointerHeld = true;
      });
    this.engine.mouseup$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((e) => {
        if (!e || !this.pointerHeld) return;
        this.pointerHeld = false;
        if (
          !this.testBusy() &&
          this.pointerDown.distanceTo(new Vector2(e.clientX, e.clientY)) < 5
        )
          this.pick(e);
      });
    this.destroyRef.onDestroy(() => {
      if (window.moonBoopDemo === this.api) delete window.moonBoopDemo;
      for (const actor of this.cats.values()) {
        actor.root.removeFromParent();
        actor.dispose();
      }
      this.cats.clear();
      this.human.root.removeFromParent();
      this.human.dispose();
      const geometries = new Set<BufferGeometry>(),
        materials = new Set<Material>();
      this.root.traverse((o) => {
        if (o instanceof Mesh) {
          geometries.add(o.geometry);
          for (const m of Array.isArray(o.material) ? o.material : [o.material])
            materials.add(m);
        }
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      this.root.removeFromParent();
    });
  }

  /** Shared by Angular buttons, picked scene objects and the dev-only agent interface. */
  act(action: GameAction, value?: string): boolean {
    if (this.testBusy()) return false;
    let result = true;
    if (action === 'stack')
      result = this.game.stackCat(value ? Number(value) : undefined);
    else if (action === 'collector') this.game.toggleAuto();
    else if (action === 'pause')
      this.game.state.paused = !this.game.state.paused;
    else if (['shoes', 'basket', 'food', 'nursery'].includes(action))
      result = this.game.buy(action as 'shoes' | 'basket' | 'food' | 'nursery');
    else if (action === 'reset') {
      if (value && !SCENARIOS.some((s) => s.id === value)) return false;
      this.game.reset(value as BoopScenario | undefined);
      this.selected.set('tower');
      this.setCamera('overview');
    } else if (action === 'select') {
      if (!value || !this.objects.has(value)) return false;
      this.selected.set(value);
    } else if (action === 'camera') {
      if (!['overview', 'collector', 'tower'].includes(value ?? ''))
        return false;
      this.setCamera(value as CameraView);
    } else if (action === 'highlights') this.highlights.set(!this.highlights());
    else return false;
    this.sync();
    return result;
  }
  onProgress(progress: TestProgress | null): void {
    this.testBusy.set(progress !== null);
  }
  remaining(source: CatSource): number {
    this.ui();
    return Math.max(0, SOURCE_PERIOD[source] - this.game.state.clocks[source]);
  }
  cost(upgrade: 'shoes' | 'basket' | 'food' | 'nursery'): number {
    this.ui();
    return this.game.cost(upgrade);
  }
  label(id: string): string {
    return LABELS[id] ?? `Cat ${id.replace('cat-', '')}`;
  }

  private tick(dt: number): void {
    // Avoid a background-tab jump; this POC reports simulation time separately from wall time.
    const step = Math.min(0.1, Math.max(0, dt));
    this.game.advance(step);
    this.animationTime += this.game.state.paused ? 0 : step;
    this.syncActors(step);
    if (this.view() === 'collector') {
      const c = this.game.state.collector;
      if (this.frames % 6 === 0) {
        this.cameraTarget.set([c.x, 0.8, c.z]);
        this.cameraPosition.set([c.x + 5, 4, c.z + 6]);
      }
    }
    this.uiElapsed += step;
    if (this.uiElapsed >= 0.1) {
      this.uiElapsed = 0;
      this.ui.set(this.game.snapshot().state);
    }
  }
  private sync(): void {
    this.syncActors(0);
    this.ui.set(this.game.snapshot().state);
  }
  private syncActors(dt: number): void {
    const s = this.game.state;
    // IDs are reused after reset; discard actors whose source changed with the fixture.
    for (const [id, actor] of this.cats) {
      const cat = s.cats.find((c) => c.id === id);
      if (!cat || actor.root.userData['source'] !== cat.source) {
        actor.root.removeFromParent();
        actor.dispose();
        this.cats.delete(id);
        this.objects.delete(`cat-${id}`);
      }
    }
    let towerIndex = 0,
      carriedIndex = 0;
    for (const cat of s.cats) {
      let actor = this.cats.get(cat.id);
      if (!actor) {
        actor = new CapsuleCatActor({
          seed: cat.id,
          dna: {
            furColor: COLORS[(cat.id - 1) % COLORS.length],
            helmet: false,
            pack: 'none',
            harness: false,
            suitBooties: false,
            bodyPattern: 'natural_two_tone',
            gait: 'idle',
          },
          autoBlink: false,
        });
        actor.root.scale.setScalar(0.62);
        actor.root.userData['source'] = cat.source;
        actor.update(0.01);
        this.cats.set(cat.id, actor);
        this.root.add(actor.root);
        this.objects.set(`cat-${cat.id}`, actor.root);
      }
      const previous = actor.root.userData['place'];
      actor.root.userData['place'] = cat.place;
      if (cat.place === 'stacked') {
        const index = towerIndex++;
        const goal = new Vector3(
          Math.sin(index * 2) * 0.045,
          0.35 + index * TOWER_STEP,
          2.4,
        );
        // A short visible settle, then no per-frame rig update for stacked cats.
        if (previous !== 'stacked')
          actor.root.position.copy(goal.clone().add(new Vector3(0, 0.6, 0)));
        actor.root.position.lerp(goal, dt ? Math.min(1, dt * 10) : 1);
        actor.root.rotation.y = index % 2 ? Math.PI / 2 : -Math.PI / 2;
      } else if (cat.place === 'carried') {
        const index = carriedIndex++;
        actor.root.position.set(
          s.collector.x,
          1.55 + index * 0.43,
          s.collector.z,
        );
        actor.root.rotation.y = this.human.root.rotation.y + Math.PI / 2;
      } else {
        const same = s.cats.filter(
          (c) => c.source === cat.source && c.place === 'waiting',
        );
        const index = same.findIndex((c) => c.id === cat.id),
          angle = index * 2.4;
        const [x, z] = SOURCE_POSITION[cat.source],
          radius = 0.85 + Math.floor(index / 5) * 0.6;
        actor.root.position.set(
          x + Math.cos(angle) * radius,
          0,
          z + Math.sin(angle) * radius,
        );
        actor.root.rotation.y = angle + this.animationTime * 0.1;
        if (!s.paused && !s.won && this.frames % 3 === cat.id % 3)
          actor.update(dt * 3);
      }
    }
    const c = s.collector;
    const dx = c.x - this.human.root.position.x,
      dz = c.z - this.human.root.position.z;
    if (Math.hypot(dx, dz) > 0.0001)
      this.human.root.rotation.y = Math.atan2(dx, dz);
    this.human.root.position.set(c.x, 0, c.z);
    const walking = c.phase === 'outbound' || c.phase === 'returning';
    this.human.setLocomotion(walking ? 'walk' : 'idle', this.game.speed / 1.6);
    if (!s.paused && !s.won) this.human.update(dt);
    this.towerTarget.position.set(
      0,
      Math.max(0.3, (this.game.stacked * TOWER_STEP) / 2),
      2.4,
    );
    this.towerTarget.scale.set(
      1,
      Math.max(0.8, this.game.stacked * TOWER_STEP),
      1,
    );
    for (const [source, material] of this.sourceMaterials)
      material.emissiveIntensity = source === this.selected() ? 0.6 : 0.15;
  }

  private createWorld(): void {
    const material = (color: string, emissive?: string) =>
      new MeshStandardMaterial({
        color,
        roughness: 0.8,
        emissive: emissive ?? '#000000',
        emissiveIntensity: 0.15,
      });
    const add = (
      geometry: BufferGeometry,
      color: string,
      position: [number, number, number],
      scale?: [number, number, number],
    ) => {
      const mesh = new Mesh(geometry, material(color));
      mesh.position.set(...position);
      if (scale) mesh.scale.set(...scale);
      this.root.add(mesh);
      return mesh;
    };
    add(new CylinderGeometry(8, 7.5, 0.65, 64), '#354c53', [0, -0.38, 0]);
    add(new CylinderGeometry(8.05, 8.05, 0.06, 64), '#6b8e79', [0, -0.02, 0]);
    add(new CylinderGeometry(1.1, 1.25, 0.3, 32), '#b6b9d2', [0, 0.13, 2.4]);
    const towerProxy = new Mesh(
      new CylinderGeometry(0.8, 0.8, 1, 12),
      new MeshStandardMaterial({ visible: false }),
    );
    this.towerTarget.add(towerProxy);
    for (const source of ['catnip', 'food', 'nursery'] as const) {
      const group = new Group(),
        [x, z] = SOURCE_POSITION[source];
      group.position.set(x, 0, z);
      const colors = { catnip: '#a8d877', food: '#efae83', nursery: '#b3a0e8' };
      const mat = material(colors[source], colors[source]);
      this.sourceMaterials.set(source, mat);
      const pad = new Mesh(new CylinderGeometry(1.25, 1.4, 0.18, 32), mat);
      pad.position.y = 0.05;
      group.add(pad);
      if (source === 'catnip') {
        for (let i = 0; i < 7; i++) {
          const leaf = new Mesh(
            new SphereGeometry(0.25, 8, 6),
            material('#69b878'),
          );
          leaf.position.set(
            Math.cos(i * 2.4) * 0.55,
            0.35 + (i % 2) * 0.15,
            Math.sin(i * 2.4) * 0.55,
          );
          leaf.scale.y = 1.5;
          group.add(leaf);
        }
      } else if (source === 'food') {
        const bowl = new Mesh(
          new TorusGeometry(0.65, 0.18, 8, 24),
          material('#f5d5a9'),
        );
        bowl.rotation.x = Math.PI / 2;
        bowl.position.y = 0.3;
        group.add(bowl);
        const food = new Mesh(
          new SphereGeometry(0.53, 12, 8),
          material('#aa6853'),
        );
        food.scale.y = 0.25;
        food.position.y = 0.23;
        group.add(food);
      } else {
        const bed = new Mesh(
          new TorusGeometry(0.65, 0.2, 8, 24),
          material('#d9b5df'),
        );
        bed.rotation.x = Math.PI / 2;
        bed.position.y = 0.28;
        group.add(bed);
        for (let i = 0; i < 3; i++) {
          const pillow = new Mesh(
            new SphereGeometry(0.25, 10, 8),
            material('#efdfed'),
          );
          pillow.position.set((i - 1) * 0.35, 0.3, 0);
          group.add(pillow);
        }
      }
      this.root.add(group);
      this.objects.set(source, group);
    }
    const moon = new Group();
    moon.position.set(0, MOON_Y, 2.4);
    const body = new Mesh(
      new SphereGeometry(1.45, 32, 24),
      material('#f4e5bb', '#c0a875'),
    );
    moon.add(body);
    for (const [x, y, radius] of [
      [-0.55, 0.55, 0.28],
      [0.65, 0.35, 0.2],
      [-0.15, -0.75, 0.24],
    ]) {
      const crater = new Mesh(
        new SphereGeometry(radius, 12, 8),
        material('#c4b99e'),
      );
      crater.scale.z = 0.22;
      crater.position.set(x, y, Math.sqrt(1.45 ** 2 - x ** 2 - y ** 2));
      moon.add(crater);
    }
    for (const x of [-0.32, 0.32]) {
      const eye = new Mesh(
        new SphereGeometry(0.075, 10, 8),
        material('#384153'),
      );
      eye.position.set(x, 0, 1.42);
      moon.add(eye);
    }
    const mouth = new Mesh(
      new TorusGeometry(0.16, 0.025, 6, 16, Math.PI),
      material('#384153'),
    );
    mouth.position.set(0, -0.25, 1.43);
    mouth.rotation.z = Math.PI;
    moon.add(mouth);
    this.root.add(moon);
    this.objects.set('moon', moon);
    // Fixed decorative stars; no extra rig or animation workload.
    const starGeometry = new SphereGeometry(0.045, 5, 4),
      starMaterial = material('#b5c8e4', '#b5c8e4');
    for (let i = 0; i < 55; i++) {
      const star = new Mesh(starGeometry, starMaterial);
      star.position.set(
        Math.sin(i * 17.3) * 22,
        2 + (i % 11) * 1.5,
        -8 - Math.abs(Math.cos(i * 7.1)) * 8,
      );
      this.root.add(star);
    }
  }
  private setCamera(view: CameraView): void {
    this.view.set(view);
    if (view === 'overview') {
      this.cameraPosition.set([15, 12, 19]);
      this.cameraTarget.set([0, 4.3, 0]);
    } else if (view === 'tower') {
      this.cameraPosition.set([8, 8, 17]);
      this.cameraTarget.set([0, 5.7, 2.4]);
    }
  }
  private bounds(id: string): TargetBounds | null {
    const object = this.objects.get(id),
      camera = this.engine.camera$.value,
      canvas = this.engine.canvas;
    if (!object || !camera || !canvas?.clientWidth) return null;
    object.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(object),
      points: Vector3[] = [];
    if (box.isEmpty()) return null;
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z])
          points.push(new Vector3(x, y, z).project(camera));
    // Hide targets crossing the clip planes; this rectangle is a focus aid, not an occlusion verdict.
    if (points.some((p) => p.z < -1 || p.z > 1)) return null;
    const left = Math.max(0, Math.min(...points.map((p) => (p.x + 1) * 50))),
      right = Math.min(100, Math.max(...points.map((p) => (p.x + 1) * 50)));
    const top = Math.max(0, Math.min(...points.map((p) => (1 - p.y) * 50))),
      bottom = Math.min(100, Math.max(...points.map((p) => (1 - p.y) * 50)));
    return right > left && bottom > top
      ? {
          id,
          label: this.label(id),
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
        }
      : null;
  }
  private pick(event: MouseEvent): void {
    const rect = this.engine.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.engine.camera,
    );
    const hits = [...this.objects]
      .flatMap(([id, object]) =>
        this.raycaster
          .intersectObject(object, true)
          .map((hit) => ({ id, distance: hit.distance })),
      )
      .sort((a, b) => a.distance - b.distance);
    const hit = hits[0];
    if (!hit) return;
    if (
      hit.id.startsWith('cat-') &&
      this.game.state.cats.find((c) => c.id === Number(hit.id.slice(4)))
        ?.place === 'waiting'
    )
      this.act('stack', hit.id.slice(4));
    else this.act('select', hit.id);
  }
  private snapshot(): PageSnapshot {
    return {
      game: this.game.snapshot(),
      view: this.view(),
      selected: this.selected(),
      highlights: this.highlights(),
      camera: [...this.cameraPosition()],
      target: [...this.cameraTarget()],
    };
  }
  private restore(snapshot: PageSnapshot): void {
    this.game.restore(snapshot.game);
    this.view.set(snapshot.view);
    this.selected.set(snapshot.selected);
    this.highlights.set(snapshot.highlights);
    this.cameraPosition.set(snapshot.camera);
    this.cameraTarget.set(snapshot.target);
    this.sync();
  }
  private waitRendered(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const subscription = this.engine.renderComplete$.subscribe(() => {
        cleanup();
        resolve();
      });
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      const cleanup = () => {
        subscription.unsubscribe();
        signal.removeEventListener('abort', abort);
      };
      signal.addEventListener('abort', abort, { once: true });
    });
  }
  private waitGame(
    condition: () => boolean,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      if (condition()) {
        resolve();
        return;
      }
      const subscription = this.engine.renderComplete$.subscribe(() => {
        if (condition()) {
          cleanup();
          resolve();
        }
      });
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error('Game condition did not complete within its bounded wait'),
        );
      }, timeoutMs);
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      const cleanup = () => {
        subscription.unsubscribe();
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      };
      signal.addEventListener('abort', abort, { once: true });
    });
  }
}
