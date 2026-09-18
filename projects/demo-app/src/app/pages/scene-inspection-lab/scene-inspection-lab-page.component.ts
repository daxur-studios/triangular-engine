import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  isDevMode,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import { SceneTestAdapter, type SceneTestBridge, type SceneTestObject } from '../../testing/scene-test-adapter/scene-test-adapter';
import {
  EngineModule,
  EngineService,
  inspectScene,
  type SceneInspectionDetail,
  type SceneSnapshot,
} from 'triangular-engine';

@Component({
  selector: 'app-scene-inspection-lab-page',
  imports: [RouterLink, EngineModule],
  templateUrl: './scene-inspection-lab-page.component.html',
  styleUrl: './scene-inspection-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class SceneInspectionLabPageComponent implements AfterViewInit {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  readonly detail = signal<SceneInspectionDetail>('standard');
  readonly maxObjects = signal(12);
  readonly duplicateNames = signal(false);
  readonly hiddenObject = signal(false);
  readonly zeroScaleObject = signal(false);
  readonly snapshot = signal<SceneSnapshot | null>(null);

  private readonly sceneRoot = new Group();
  private readonly serviceArmSecondary = new Group();
  private readonly hiddenHangar = new Group();
  private readonly diagnosticMarker = new Mesh(
    new SphereGeometry(1.2, 20, 12),
    new MeshStandardMaterial({ color: '#f59e0b' }),
  );
  private testAdapter?: SceneTestAdapter;
  private testObjects: SceneTestObject[] = [];
  private testClickHandler?: (event: PointerEvent) => void;

  constructor() {
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#09111f');
    this.engine.camera.name = 'inspection-camera';

    this.sceneRoot.name = 'inspection-scene';
    this.sceneRoot.add(this.createTower(), this.createVehicle(), this.createCargo());

    const serviceArm = new Group();
    serviceArm.name = 'service-arm';
    this.serviceArmSecondary.name = 'service-arm-secondary';
    this.sceneRoot.add(serviceArm, this.serviceArmSecondary);

    this.hiddenHangar.name = 'hidden-hangar';
    this.hiddenHangar.add(this.createBox('hangar-bay', 5, 2, 5, '#334155'));
    this.sceneRoot.add(this.hiddenHangar);

    this.diagnosticMarker.name = 'diagnostic-marker';
    this.diagnosticMarker.position.set(8, 1.2, 0);
    this.sceneRoot.add(this.diagnosticMarker);

    const keyLight = new DirectionalLight('#ffffff', 2.5);
    keyLight.name = 'inspection-key-light';
    this.engine.scene.add(this.sceneRoot, keyLight);

    if (isDevMode() && new URLSearchParams(window.location.search).get('sceneTest') === 'agent-reference-v1') {
      this.installAgentReference();
    }

    this.destroyRef.onDestroy(() => {
      this.engine.scene.remove(this.sceneRoot);
      this.engine.scene.background = previousBackground;
      if (this.testClickHandler) window.removeEventListener('pointerdown', this.testClickHandler, true);
      if (this.testAdapter) {
        this.engine.scene.remove(...this.testObjects.map(({ object }) => object));
        delete (window as Window & { __sceneTest?: SceneTestBridge }).__sceneTest;
      }
    });
  }

  private installAgentReference(): void {
    const reference = new Group();
    reference.name = 'agent-reference-v1';
    const sphere = new Mesh(new SphereGeometry(5, 32, 20), new MeshStandardMaterial({ color: '#38bdf8' }));
    sphere.name = 'large-sphere';
    sphere.position.set(-7, 5, 0);
    const box = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshStandardMaterial({ color: '#f97316' }));
    box.name = 'small-box';
    box.position.set(2, 0.25, 0);
    const transformedParent = new Group();
    transformedParent.name = 'transformed-box-parent';
    transformedParent.position.set(7, 1, -2);
    transformedParent.rotation.y = Math.PI / 5;
    const transformedBox = new Mesh(new BoxGeometry(1, 2, 0.75), new MeshStandardMaterial({ color: '#a78bfa' }));
    transformedBox.name = 'transformed-box';
    transformedParent.add(transformedBox);
    reference.add(sphere, box, transformedParent);
    this.engine.scene.add(reference);
    this.testObjects = [
      { id: 'large-sphere', label: 'Large sphere', object: sphere },
      { id: 'small-box', label: 'Small box', object: box },
      { id: 'transformed-box', label: 'Transformed box', object: transformedParent },
    ];
    this.testAdapter = new SceneTestAdapter(
      this.engine.scene,
      () => this.engine.camera,
      this.engine.renderer,
      this.testObjects,
      () => this.waitForRender(),
    );
    const testWindow = window as Window & { __sceneTest?: SceneTestBridge };
    testWindow.__sceneTest = this.testAdapter;
    this.testClickHandler = (event) => {
      const target = this.testAdapter?.hit(event.clientX, event.clientY);
      if (target) window.dispatchEvent(new CustomEvent('scene-test-hit', { detail: { target } }));
    };
    window.addEventListener('pointerdown', this.testClickHandler, true);
  }

  private waitForRender(): Promise<{ frameId: number; renderedAt: number }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const subscription = this.engine.renderComplete$.subscribe((frame) => {
        if (settled) return;
        settled = true;
        subscription.unsubscribe();
        resolve(frame);
      });
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        subscription.unsubscribe();
        reject(new Error('TIMEOUT: engine render did not complete'));
      }, 2000);
      this.engine.requestSingleRender();
      subscription.add(() => window.clearTimeout(timeout));
    });
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => this.refreshSnapshot());
  }

  refreshSnapshot(): void {
    this.snapshot.set(
      inspectScene(
        { scene: this.engine.scene, camera: this.engine.camera, renderer: this.engine.renderer },
        { detail: this.detail(), maxObjects: this.maxObjects(), includeBounds: this.detail() !== 'brief' },
      ),
    );
  }

  setDetail(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'brief' || value === 'standard' || value === 'deep') {
      this.detail.set(value);
      this.refreshSnapshot();
    }
  }

  setMaxObjects(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isInteger(value) && value > 0) {
      this.maxObjects.set(value);
      this.refreshSnapshot();
    }
  }

  toggleDuplicateNames(): void {
    this.duplicateNames.update((value) => !value);
    this.serviceArmSecondary.name = this.duplicateNames() ? 'service-arm' : 'service-arm-secondary';
    this.refreshSnapshot();
  }

  toggleHiddenObject(): void {
    this.hiddenObject.update((value) => !value);
    this.hiddenHangar.visible = !this.hiddenObject();
    this.refreshSnapshot();
  }

  toggleZeroScale(): void {
    this.zeroScaleObject.update((value) => !value);
    this.diagnosticMarker.scale.setScalar(this.zeroScaleObject() ? 0 : 1);
    this.refreshSnapshot();
  }

  async copySnapshot(): Promise<void> {
    const snapshot = this.snapshot();
    if (snapshot) await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
  }

  snapshotJson(): string {
    const snapshot = this.snapshot();
    return snapshot ? JSON.stringify(snapshot, null, 2) : 'Refresh to inspect the scene.';
  }

  private createTower(): Group {
    const tower = new Group();
    tower.name = 'launch-tower';
    tower.add(this.createBox('tower-body', 2, 12, 2, '#64748b'));
    tower.add(this.createBox('tower-platform', 5, 0.5, 5, '#94a3b8'));
    tower.position.set(-6, 6, 0);
    return tower;
  }

  private createVehicle(): Group {
    const vehicle = new Group();
    vehicle.name = 'vehicle-stack';
    vehicle.add(this.createBox('vehicle-core', 2.5, 8, 2.5, '#e2e8f0'));
    vehicle.add(this.createBox('vehicle-nose', 1.8, 2, 1.8, '#38bdf8'));
    vehicle.position.set(0, 5, 0);
    return vehicle;
  }

  private createCargo(): Group {
    const cargo = new Group();
    cargo.name = 'cargo-rack';
    for (let index = 0; index < 10; index++) {
      const crate = this.createBox(`cargo-${index + 1}`, 1.2, 1.2, 1.2, '#22c55e');
      crate.position.set((index % 5) * 1.8 - 3.6, 0.6, Math.floor(index / 5) * 1.8 - 1);
      cargo.add(crate);
    }
    cargo.position.set(7, 0, 0);
    return cargo;
  }

  private createBox(name: string, x: number, y: number, z: number, color: string): Mesh {
    const mesh = new Mesh(new BoxGeometry(x, y, z), new MeshStandardMaterial({ color }));
    mesh.name = name;
    return mesh;
  }
}
