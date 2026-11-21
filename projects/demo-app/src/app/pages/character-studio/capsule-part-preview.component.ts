import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, effect, inject, input, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PortalRegistryService } from '@daxur-studios/portal-layout';
import { Box3, Color, Group, MathUtils, Mesh, MeshBasicMaterial, Plane, Raycaster, SphereGeometry, Vector2, Vector3, WebGLRenderer } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { FacialAnimationController } from 'triangular-engine/characters';
import { buildExperimentalPigtailBody } from './experimental-pigtail-body';
import { buildExperimentalHairPreview, buildExperimentalPigtailHead } from './experimental-pigtail-head';
import type { CapsuleHairStyle } from './experimental-capsule-hair';
import { boundStacheOffset, DEFAULT_STACHE_SHAPE, stacheTip, type StacheHandle, type StacheShape } from './classic-stache-shapes';

type PreviewPart = 'hair' | 'face' | 'suit' | 'stache';

@Component({
  selector: 'app-capsule-part-preview',
  imports: [EngineModule],
  providers: [EngineService.provide({ showFPS: true, pixelRatio: 1 }), PortalRegistryService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.shape-editor]': "part() === 'stache'",
    '(pointerdown)': 'beginDrag($event)',
    '(pointermove)': 'moveDrag($event)',
    '(lostpointercapture)': 'endDrag($event)',
  },
  template: `
    <scene [showFps]="true" [renderOnlyWhenThisIsTriggered]="true">
      <camera [isActive]="true" [position]="[0, part() === 'stache' ? 0 : 0.16, 2.65]" [lookAt]="[0, 0, 0]" />
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
    :host(.shape-editor) ::ng-deep canvas { touch-action: none; cursor: grab; }
    :host(.shape-editor:active) ::ng-deep canvas { cursor: grabbing; }
  `,
})
export class CapsulePartPreviewComponent {
  readonly part = input.required<PreviewPart>();
  readonly hairStyle = input<CapsuleHairStyle>('pigtails');
  readonly lockLength = input(1);
  readonly yawDegrees = input(35);
  readonly stacheShape = input(DEFAULT_STACHE_SHAPE);
  readonly withMustache = input(true);
  readonly stacheShapeChange = output<StacheShape>();

  private readonly engine = inject(EngineService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly turntable = new Group();
  private displayedPart?: ReturnType<typeof this.part>;
  private model?: ReturnType<typeof createPreviewModel>;
  private readonly markers = {
    fringe: new Mesh(new SphereGeometry(.075, 12, 8), new MeshBasicMaterial({ color: 0xffcf86, depthTest: false, depthWrite: false })),
    mustache: new Mesh(new SphereGeometry(.075, 12, 8), new MeshBasicMaterial({ color: 0x87e0d5, depthTest: false, depthWrite: false })),
  };
  private drag?: { pointerId: number; handle: StacheHandle; side: number; grab: Vector3 };

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
        model.setHair(this.hairStyle(), this.lockLength(), this.stacheShape().fringe);
      }
      if ('setStache' in model && model.setStache) {
        const shape = this.stacheShape();
        model.setStache(shape, this.withMustache());
        for (const handle of ['fringe', 'mustache'] as const) {
          const marker = this.markers[handle];
          const tip = stacheTip(handle, shape[handle]);
          marker.position.set(tip[0] * this.handleSide(handle), tip[1], tip[2]);
          marker.visible = handle === 'fringe' || this.withMustache();
          marker.renderOrder = 10;
          if (marker.parent !== model.root) model.root.add(marker);
        }
      }

      // Fit in local coordinates so turning the miniature keeps the camera still.
      this.turntable.rotation.y = 0;
      this.turntable.position.set(0, 0, 0);
      this.turntable.scale.setScalar(1);
      this.turntable.updateMatrixWorld(true);
      const bounds = new Box3().setFromObject(model.root.getObjectByName('capsule-hair') ?? model.root);
      // Keep the camera fixed while editing so a drag cannot move its own reference frame.
      const center = part === 'stache' ? new Vector3(0, .86, .11) : bounds.getCenter(new Vector3());
      const size = bounds.getSize(new Vector3());
      const scale = part === 'stache' ? 1.14 : 1.74 / Math.max(size.x, size.y, size.z);
      this.turntable.scale.setScalar(scale);
      this.turntable.rotation.y = MathUtils.degToRad(this.yawDegrees());
      this.turntable.position.copy(center).multiplyScalar(-scale).applyEuler(this.turntable.rotation);
      if (this.engine.camera) this.engine.requestSingleRender();
    });

    destroyRef.onDestroy(() => {
      this.releaseModel();
      for (const marker of Object.values(this.markers)) {
        marker.geometry.dispose();
        marker.material.dispose();
      }
      this.turntable.removeFromParent();
      this.engine.onComponentDestroy();
      if (this.engine.renderer instanceof WebGLRenderer) this.engine.renderer.forceContextLoss();
    });
  }

  beginDrag(event: PointerEvent): void {
    if (this.part() !== 'stache' || this.drag || event.button !== 0 || event.target !== this.engine.canvas) return;
    const canvas = this.engine.canvas.getBoundingClientRect();
    const camera = this.engine.camera;
    if (!camera) return;
    const local = new Vector2(event.clientX - canvas.left, event.clientY - canvas.top);
    for (const handle of ['fringe', 'mustache'] as const) {
      const marker = this.markers[handle];
      if (!marker.visible) continue;
      const projection = marker.getWorldPosition(new Vector3()).project(camera);
      const pixel = new Vector2((projection.x + 1) * canvas.width / 2, (1 - projection.y) * canvas.height / 2);
      if (pixel.distanceTo(local) > 18) continue;
      const grab = this.pointOnHandlePlane(event, handle);
      if (!grab) return;
      this.drag = { pointerId: event.pointerId, handle, side: this.handleSide(handle), grab: marker.position.clone().sub(grab) };
      this.element.setPointerCapture(event.pointerId);
      return;
    }
  }

  moveDrag(event: PointerEvent): void {
    if (this.drag?.pointerId !== event.pointerId) return;
    const { handle, side, grab } = this.drag;
    const point = this.pointOnHandlePlane(event, handle);
    if (!point) return;
    point.add(grab);
    const base = stacheTip(handle, DEFAULT_STACHE_SHAPE[handle]);
    this.changeOffset(handle, point.x * side - base[0], point.y - base[1]);
  }

  endDrag(event: PointerEvent): void {
    if (this.drag?.pointerId === event.pointerId) this.drag = undefined;
  }

  nudgeHandle(handle: StacheHandle, event: KeyboardEvent): void {
    const increments: Record<string, readonly [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1],
    };
    const step = increments[event.key];
    if (!step) return;
    event.preventDefault();
    const [x, y] = this.stacheShape()[handle];
    this.changeOffset(handle, x + step[0] * .055 * this.handleSide(handle), y + step[1] * .055);
  }

  private handleSide(handle: StacheHandle): number {
    return handle === 'mustache' && this.yawDegrees() > 0 ? -1 : 1;
  }

  private pointOnHandlePlane(event: PointerEvent, handle: StacheHandle): Vector3 | null {
    const camera = this.engine.camera;
    const model = this.model;
    if (!camera || !model) return null;
    const { left, top, width, height } = this.engine.canvas.getBoundingClientRect();
    const ndc = new Vector2(2 * (event.clientX - left) / width - 1, 1 - 2 * (event.clientY - top) / height);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const ray = raycaster.ray.applyMatrix4(model.root.matrixWorld.clone().invert());
    return ray.intersectPlane(new Plane(new Vector3(0, 0, 1), -this.markers[handle].position.z), new Vector3());
  }

  private changeOffset(handle: StacheHandle, x: number, y: number): void {
    const shape = this.stacheShape();
    const offset = boundStacheOffset(handle, x, y);
    if (offset[0] !== shape[handle][0] || offset[1] !== shape[handle][1]) {
      this.stacheShapeChange.emit({ ...shape, [handle]: offset });
    }
  }

  private releaseModel(): void {
    for (const marker of Object.values(this.markers)) marker.removeFromParent();
    this.model?.root.removeFromParent();
    this.model?.dispose();
  }
}

function createPreviewModel(part: PreviewPart) {
  if (part === 'hair') return buildExperimentalHairPreview();
  if (part === 'suit') return buildExperimentalPigtailBody();
  const controller = new FacialAnimationController();
  controller.setExpression('happy', 1, 0);
  if (part === 'stache') {
    const head = buildExperimentalPigtailHead(controller);
    return {
      root: head.head,
      setStache: (shape: StacheShape, withMustache: boolean) => {
        head.setHair('classic-stache', 1, shape, withMustache);
        head.update(0);
      },
      dispose: head.dispose,
    };
  }
  const face = buildExperimentalPigtailHead(controller, undefined, false);
  face.update(0);
  return { root: face.head, dispose: face.dispose };
}
