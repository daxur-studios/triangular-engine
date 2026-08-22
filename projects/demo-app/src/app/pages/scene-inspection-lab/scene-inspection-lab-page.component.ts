import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
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

    this.destroyRef.onDestroy(() => {
      this.engine.scene.remove(this.sceneRoot);
      this.engine.scene.background = previousBackground;
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
