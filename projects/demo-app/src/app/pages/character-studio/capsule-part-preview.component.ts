import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PortalRegistryService } from '@daxur-studios/portal-layout';
import { Box3, Color, Group, MathUtils, Vector3, WebGLRenderer } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { FacialAnimationController } from 'triangular-engine/characters';
import { buildExperimentalPigtailBody } from './experimental-pigtail-body';
import { buildExperimentalHairPreview, buildExperimentalPigtailHead } from './experimental-pigtail-head';
import type { CapsuleHairStyle } from './experimental-capsule-hair';

@Component({
  selector: 'app-capsule-part-preview',
  imports: [EngineModule],
  providers: [EngineService.provide({ showFPS: true, pixelRatio: 1 }), PortalRegistryService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <scene [showFps]="true" [renderOnlyWhenThisIsTriggered]="true">
      <camera [isActive]="true" [position]="[0, 0.16, 2.65]" [lookAt]="[0, 0, 0]" />
      <ambientLight [intensity]="1.3" />
      <directionalLight [position]="[3.2, 5.4, 4.2]" [intensity]="2.5" />
      <directionalLight [position]="[-3.8, 3.2, 1.5]" [intensity]="1.35" />
      <directionalLight [position]="[0.5, 3.8, -4.5]" [intensity]="1.8" />
    </scene>
  `,
  styles: `
    :host { display: flex; position: relative; min-width: 0; min-height: 0; overflow: hidden; }
    scene { display: flex; flex: 1; min-width: 0; min-height: 0; height: 100%; }
    :host ::ng-deep engine-stats { transform: scale(0.48); transform-origin: top right; }
  `,
})
export class CapsulePartPreviewComponent {
  readonly part = input.required<'hair' | 'face' | 'suit'>();
  readonly hairStyle = input<CapsuleHairStyle>('pigtails');
  readonly lockLength = input(1);
  readonly yawDegrees = input(35);

  private readonly engine = inject(EngineService);
  private readonly turntable = new Group();
  private displayedPart?: ReturnType<typeof this.part>;
  private model?: ReturnType<typeof createPreviewModel>;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const studioEngine = inject(EngineService, { skipSelf: true });
    // The catalogue captures the active engine. Keep that pointed at the assembled preview.
    EngineService.activeInstance = studioEngine;
    this.engine.scene.background = new Color('#131720');
    this.engine.scene.add(this.turntable);

    this.engine.resolution$.pipe(takeUntilDestroyed(destroyRef)).subscribe(({ width, height }) => {
      if (width > 1 && height > 1) this.engine.requestSingleRender();
    });

    effect(() => {
      const part = this.part();
      if (part !== this.displayedPart) {
        this.releaseModel();
        this.model = createPreviewModel(part);
        this.turntable.add(this.model.root);
        this.displayedPart = part;
      }
      const model = this.model!;
      if ('setHair' in model) {
        model.setHair(this.hairStyle(), this.lockLength());
      }

      // Fit in local coordinates so turning the miniature keeps the camera still.
      this.turntable.rotation.y = 0;
      this.turntable.position.set(0, 0, 0);
      this.turntable.scale.setScalar(1);
      this.turntable.updateMatrixWorld(true);
      const subject = model.root.getObjectByName('capsule-hair') ?? model.root;
      const bounds = new Box3().setFromObject(subject);
      const center = bounds.getCenter(new Vector3());
      const size = bounds.getSize(new Vector3());
      const scale = 1.74 / Math.max(size.x, size.y, size.z);
      this.turntable.scale.setScalar(scale);
      this.turntable.rotation.y = MathUtils.degToRad(this.yawDegrees());
      this.turntable.position.copy(center).multiplyScalar(-scale).applyEuler(this.turntable.rotation);
      if (this.engine.camera) this.engine.requestSingleRender();
    });

    destroyRef.onDestroy(() => {
      this.releaseModel();
      this.turntable.removeFromParent();
      this.engine.onComponentDestroy();
      if (this.engine.renderer instanceof WebGLRenderer) this.engine.renderer.forceContextLoss();
    });
  }

  private releaseModel(): void {
    this.model?.root.removeFromParent();
    this.model?.dispose();
  }
}

function createPreviewModel(part: 'hair' | 'face' | 'suit') {
  if (part === 'hair') return buildExperimentalHairPreview();
  if (part === 'suit') return buildExperimentalPigtailBody();
  const controller = new FacialAnimationController();
  controller.setExpression('happy', 1, 0);
  const face = buildExperimentalPigtailHead(controller, undefined, false);
  face.update(0);
  return { root: face.head, dispose: face.dispose };
}
