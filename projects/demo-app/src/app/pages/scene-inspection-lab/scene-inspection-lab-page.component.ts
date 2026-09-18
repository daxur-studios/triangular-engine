import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  isDevMode,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { OrbitControlsComponent } from 'triangular-engine';
import { SceneTestAdapter, type SceneTestBridge, type SceneTestCameraController, type SceneTestObject } from '../../testing/scene-test-adapter/scene-test-adapter';
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
  readonly visualDefect = signal<'none' | 'z-fighting' | 'inverted-normals' | 'terrain-gap'>('none');
  readonly defectActive = signal(true);
  readonly snapshot = signal<SceneSnapshot | null>(null);

  private readonly sceneRoot = new Group();
  private readonly defectGroup = new Group();
  private readonly serviceArmSecondary = new Group();
  private readonly hiddenHangar = new Group();
  private readonly diagnosticMarker = new Mesh(
    new SphereGeometry(1.2, 20, 12),
    new MeshStandardMaterial({ color: '#f59e0b' }),
  );
  private testAdapter?: SceneTestAdapter;
  private testObjects: SceneTestObject[] = [];
  private testClickHandler?: (event: PointerEvent) => void;
  private readonly testFixtureEnabled = isDevMode() && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('sceneTest') === 'agent-reference-v1';
  private readonly agentOrbitControls = viewChild(OrbitControlsComponent);

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

    this.defectGroup.name = 'visual-defect-group';
    this.sceneRoot.add(this.defectGroup);

    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const defect = urlParams.get('defect') as 'z-fighting' | 'inverted-normals' | 'terrain-gap' | null;
      if (defect && ['z-fighting', 'inverted-normals', 'terrain-gap'].includes(defect)) {
        this.visualDefect.set(defect);
        if (urlParams.get('defectActive') === 'false') {
          this.defectActive.set(false);
        }
        this.updateDefectGeometry();
      }
    }

    const keyLight = new DirectionalLight('#ffffff', 2.5);
    keyLight.name = 'inspection-key-light';
    this.engine.scene.add(this.sceneRoot, keyLight);

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
      ...(this.visualDefect() !== 'none'
        ? [{ id: 'defect-target', label: 'Visual defect target', object: this.defectGroup }]
        : []),
    ];
    this.testAdapter = new SceneTestAdapter(
      this.engine.scene,
      () => this.engine.camera,
      this.engine.renderer,
      this.testObjects,
      () => this.waitForRender(),
      this.createCameraController(),
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
    if (this.testFixtureEnabled) this.installAgentReference();
    queueMicrotask(() => this.refreshSnapshot());
  }

  private createCameraController(): SceneTestCameraController {
    return {
      isEnabled: () => this.agentOrbitControls()?.orbitControls()?.enabled ?? true,
      setEnabled: (enabled) => {
        const controls = this.agentOrbitControls()?.orbitControls();
        if (controls) controls.enabled = enabled;
      },
      setTarget: (target: Vector3) => {
        this.agentOrbitControls()?.orbitControls()?.target.copy(target);
      },
      update: () => {
        this.agentOrbitControls()?.orbitControls()?.update();
      },
    };
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

  setVisualDefect(defect: 'none' | 'z-fighting' | 'inverted-normals' | 'terrain-gap'): void {
    this.visualDefect.set(defect);
    this.updateDefectGeometry();
    this.refreshSnapshot();
  }

  onDefectChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as 'none' | 'z-fighting' | 'inverted-normals' | 'terrain-gap';
    this.setVisualDefect(value);
  }

  toggleDefectActive(): void {
    this.defectActive.update((value) => !value);
    this.updateDefectGeometry();
    this.refreshSnapshot();
  }

  private updateDefectGeometry(): void {
    this.defectGroup.clear();
    const mode = this.visualDefect();
    const isBroken = this.defectActive();
    if (mode === 'none') return;

    if (mode === 'z-fighting') {
      const base = new Mesh(
        new PlaneGeometry(4, 4),
        new MeshStandardMaterial({ color: '#2563eb', roughness: 0.4 }),
      );
      base.name = 'z-fight-base';
      base.rotation.x = -Math.PI / 2;

      const overlay = new Mesh(
        new PlaneGeometry(3, 3),
        new MeshStandardMaterial({ color: '#dc2626', roughness: 0.4 }),
      );
      overlay.name = 'z-fight-overlay';
      overlay.rotation.x = -Math.PI / 2;
      overlay.position.y = isBroken ? 0.0 : 0.05;

      this.defectGroup.position.set(0, 1.5, 4);
      this.defectGroup.add(base, overlay);
    } else if (mode === 'inverted-normals') {
      const geom = new SphereGeometry(2.5, 32, 16);
      if (isBroken) {
        const normals = geom.attributes['normal'];
        for (let i = 0; i < normals.count; i++) {
          normals.setXYZ(i, -normals.getX(i), -normals.getY(i), -normals.getZ(i));
        }
        normals.needsUpdate = true;
      }
      const mat = new MeshStandardMaterial({
        color: '#38bdf8',
        roughness: 0.3,
        metalness: 0.1,
      });
      const sphere = new Mesh(geom, mat);
      sphere.name = 'normals-sphere';
      this.defectGroup.position.set(0, 3, 4);
      this.defectGroup.add(sphere);
    } else if (mode === 'terrain-gap') {
      const width = 3;
      const height = 3;
      const left = new Mesh(
        new PlaneGeometry(width, height, 8, 8),
        new MeshStandardMaterial({ color: '#15803d', roughness: 0.8 }),
      );
      left.name = 'terrain-left';
      left.rotation.x = -Math.PI / 2;
      left.position.set(-width / 2, 0, 0);

      const right = new Mesh(
        new PlaneGeometry(width, height, 8, 8),
        new MeshStandardMaterial({ color: '#16a34a', roughness: 0.8 }),
      );
      right.name = 'terrain-right';
      right.rotation.x = -Math.PI / 2;
      if (isBroken) {
        right.position.set(width / 2 + 0.35, -0.4, 0);
      } else {
        right.position.set(width / 2, 0, 0);
      }

      this.defectGroup.position.set(0, 1, 4);
      this.defectGroup.add(left, right);
    }
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
