import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, WebGLRenderer, type Vector3Tuple,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { CapsuleCrowdMotion, CROWD_COUNT, PLANTERS, PLAZA_SIZE } from './capsule-crowd-motion';
import { WALK_FRAMES } from './capsule-crowd-poses';
import { CapsuleCrowdView, type CrowdViewMode } from './capsule-crowd-view';

@Component({
  selector: 'app-capsule-crowd-page',
  imports: [EngineModule, RouterLink],
  templateUrl: './capsule-crowd-page.component.html',
  styleUrl: './capsule-crowd-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ preferredRenderer: 'webgl', showFPS: true })],
  host: { class: 'flex-page' },
})
export class CapsuleCrowdPageComponent {
  private readonly engine = inject(EngineService);
  private readonly motion = new CapsuleCrowdMotion();
  private readonly crowd = new CapsuleCrowdView(CROWD_COUNT);
  private readonly plaza = new Group();
  private baking = false;
  private frame = 0;

  protected readonly count = CROWD_COUNT;
  protected readonly walkFrames = WALK_FRAMES;
  protected readonly mode = signal<CrowdViewMode>('mesh');
  protected readonly paused = signal(false);
  protected readonly baked = signal(0);
  protected readonly bakeStatus = signal<'idle' | 'baking' | 'ready' | 'failed'>('idle');
  protected readonly stats = signal({ moving: 0, draws: 0, triangles: 0 });
  protected readonly cameraPosition = signal<Vector3Tuple>([27, 29, 38]);
  protected readonly cameraTarget = signal<Vector3Tuple>([0, 0, 0]);

  constructor() {
    this.engine.scene.background = new Color('#b7d0dc');
    this.buildPlaza();
    this.engine.scene.add(this.plaza, this.crowd.root);
    const destroyRef = inject(DestroyRef);
    this.engine.tick$.pipe(takeUntilDestroyed(destroyRef)).subscribe(dt => this.update(dt));
    destroyRef.onDestroy(() => {
      this.crowd.dispose();
      this.plaza.removeFromParent();
      this.plaza.traverse(object => {
        if (!(object instanceof Mesh)) return;
        object.geometry.dispose();
        (object.material as MeshStandardMaterial).dispose();
      });
    });
  }

  protected selectMode(mode: CrowdViewMode): void {
    if (mode === 'impostor' && this.baked() < WALK_FRAMES) {
      this.baking = true;
      this.bakeStatus.set('baking');
      return;
    }
    this.mode.set(mode);
  }

  protected focus(close: boolean): void {
    this.cameraPosition.set(close ? [10, 6, 14] : [27, 29, 38]);
    this.cameraTarget.set(close ? [0, 1, 0] : [0, 0, 0]);
  }

  private update(dt: number): void {
    if (this.baking) this.bakeFrame();
    const { x, z, yaw, phase } = this.motion;
    if (!this.paused()) this.motion.advance(dt);
    const costs = this.crowd.update(this.mode(), x, z, yaw, phase);
    if (++this.frame % 8 === 1) this.stats.set({ ...costs, moving: this.motion.moving });
  }

  private bakeFrame(): void {
    const renderer = this.engine.renderer;
    if (!(renderer instanceof WebGLRenderer)) {
      this.baking = false;
      this.bakeStatus.set('failed');
      return;
    }
    try {
      this.crowd.bakeNextFrame(renderer);
      this.baked.set(this.crowd.bakedFrames);
      if (this.crowd.bakedFrames === WALK_FRAMES) {
        this.baking = false;
        this.bakeStatus.set('ready');
        this.mode.set('impostor');
      }
    } catch (error) {
      this.baking = false;
      this.bakeStatus.set('failed');
      console.error('Could not bake the walking impostor', error);
    }
  }

  private buildPlaza(): void {
    const addBox = (width: number, height: number, depth: number, x: number, y: number, z: number, color: string) => {
      const mesh = new Mesh(new BoxGeometry(width, height, depth), new MeshStandardMaterial({ color, roughness: 1 }));
      mesh.position.set(x, y, z);
      this.plaza.add(mesh);
    };
    addBox(104, .3, 104, 0, -.22, 0, '#849d81');
    addBox(PLAZA_SIZE, .16, PLAZA_SIZE, 0, -.08, 0, '#c8bda7');
    for (const offset of [-16, 0, 16]) {
      addBox(.055, .008, PLAZA_SIZE - .5, offset, .004, 0, '#a7a190');
      addBox(PLAZA_SIZE - .5, .008, .055, 0, .005, offset, '#a7a190');
    }
    for (const { x, y, width, height } of PLANTERS) {
      const worldX = x + width / 2 - PLAZA_SIZE / 2;
      const worldZ = y + height / 2 - PLAZA_SIZE / 2;
      addBox(width, .44, height, worldX, .22, worldZ, '#8c826d');
      addBox(width - .28, .14, height - .28, worldX, .49, worldZ, '#6d8868');
    }
  }
}
