import { DecimalPipe } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ArrowHelper,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Plane,
  PlaneGeometry,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  SplineEditorHistory,
  moveSplinePoint,
  type SplineMoveConstraint,
} from 'triangular-engine/spline';
import {
  defaultComposerSettings,
  sampleHeightmap,
  TerrainComposerField,
  type ComposerFeature,
  type ComposerLayer,
  type ComposerSettings,
} from './terrain-composer';
import {
  createFlowMaterial,
  createRiverRibbon,
  RiverPath,
  type RiverControlPoint,
} from '../river-lab/river-system';

type ComposerPickTarget =
  | { kind: 'point'; featureId: string; index: number }
  | { kind: 'spline'; featureId: string }
  | { kind: 'axis'; axis: 'x' | 'y' | 'z' }
  | { kind: 'plane'; constraint: 'xy' | 'xz' | 'yz' };

@Component({
  selector: 'app-terrain-composer-lab-page',
  imports: [RouterLink, EngineModule, DecimalPipe],
  templateUrl: './terrain-composer-lab-page.component.html',
  styleUrl: './terrain-composer-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EngineService.provide({
      showFPS: true,
      webGLRendererParameters: { logarithmicDepthBuffer: true },
    }),
  ],
  host: { class: 'flex-page' },
})
export class TerrainComposerLabPageComponent implements AfterViewInit {
  @ViewChild('heightmap')
  private readonly heightmap?: ElementRef<HTMLCanvasElement>;
  @ViewChild('islandPreview')
  private readonly islandPreview?: ElementRef<HTMLCanvasElement>;
  @ViewChild('mountainPreview')
  private readonly mountainPreview?: ElementRef<HTMLCanvasElement>;
  @ViewChild('riverPreview')
  private readonly riverPreview?: ElementRef<HTMLCanvasElement>;
  readonly activeLayer = signal<ComposerLayer>('island');
  readonly editMode = signal(true);
  readonly settings = signal<ComposerSettings>(defaultComposerSettings());
  readonly features = signal<ComposerFeature[]>(createDemoFeatures());
  readonly field = signal(
    new TerrainComposerField(this.features(), this.settings()),
  );
  readonly moveConstraint = signal<SplineMoveConstraint>('xz');
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);
  readonly seedLabel = signal('7');
  readonly isDragging = signal(false);
  readonly featureCount = () => this.features().length;

  private readonly engine = inject(EngineService);
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly group = new Group();
  private readonly history = new SplineEditorHistory<ComposerFeature[]>(
    cloneFeatures,
  );
  private readonly ground = new Mesh(
    new PlaneGeometry(320, 320),
    new MeshBasicMaterial({ visible: false, side: DoubleSide }),
  );
  private readonly pointGeometry = new SphereGeometry(1.35, 14, 10);
  private readonly pointMaterial = new MeshBasicMaterial({ color: '#f4d35e' });
  private readonly selectedPointMaterial = new MeshBasicMaterial({
    color: '#ff5d5d',
  });
  private readonly waterMaterial = createFlowMaterial();
  private water?: Mesh;
  private readonly oceanMaterial = new MeshStandardMaterial({
    color: '#1c7085',
    roughness: 0.18,
    metalness: 0.05,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });
  private ocean?: Mesh;
  private currentFeatureId?: string;
  private selectedPoint?: { featureId: string; index: number };
  private drag?: {
    kind: 'point' | 'axis' | 'plane';
    featureId: string;
    index: number;
    axis?: SplineMoveConstraint;
    startHit: readonly [number, number, number];
    startPoint: readonly [number, number, number];
  };
  private lines: Line[] = [];
  private pointMeshes: Mesh[] = [];
  private gizmoArrows: ArrowHelper[] = [];
  private gizmoPlanes: Mesh[] = [];

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#071018');
    this.ground.rotation.x = -Math.PI / 2;
    this.engine.scene.add(this.group, this.ground);
    this.engine.mousedown$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((event) => this.onCanvasClick(event));
    this.engine.mousemove$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((event) => this.onCanvasMove(event));
    this.engine.mouseup$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() => this.onCanvasUp());
    this.engine.elapsedTime$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(
        (elapsedTime) =>
          (this.waterMaterial.uniforms['time'].value = elapsedTime),
      );
    this.rebuild();
    destroyRef.onDestroy(() => {
      this.group.removeFromParent();
      this.ground.removeFromParent();
      this.ground.geometry.dispose();
      (this.ground.material as MeshBasicMaterial).dispose();
      this.water?.removeFromParent();
      this.water?.geometry.dispose();
      this.waterMaterial.dispose();
      this.ocean?.removeFromParent();
      this.ocean?.geometry.dispose();
      this.oceanMaterial.dispose();
      this.disposeLines();
      this.disposePointMeshes();
      this.disposeTransformGizmo();
      this.pointGeometry.dispose();
      this.pointMaterial.dispose();
      this.selectedPointMaterial.dispose();
      this.engine.scene.background = previousBackground;
    });
  }

  ngAfterViewInit(): void {
    requestAnimationFrame(() => this.drawPreviews());
  }

  setLayer(layer: ComposerLayer): void {
    this.activeLayer.set(layer);
  }
  setEditMode(enabled: boolean): void {
    this.editMode.set(enabled);
    this.currentFeatureId = undefined;
    this.selectedPoint = undefined;
    this.drag = undefined;
    this.isDragging.set(false);
    this.rebuildLines();
  }
  addFeature(): void {
    if (this.activeLayer() === 'island') return;
    this.history.push(this.features());
    this.syncHistoryState();
    const id = `${this.activeLayer()}-${Date.now()}`;
    this.features.update((items) => [
      ...items,
      { id, layer: this.activeLayer(), points: [], closed: false },
    ]);
    this.currentFeatureId = id;
    this.rebuild();
  }
  clearLayer(): void {
    this.history.push(this.features());
    this.syncHistoryState();
    this.features.update((items) =>
      items.filter((feature) => feature.layer !== this.activeLayer()),
    );
    this.rebuild();
  }
  closeIsland(): void {
    this.history.push(this.features());
    this.syncHistoryState();
    this.features.update((items) =>
      items.map((feature) =>
        feature.layer === 'island' ? { ...feature, closed: true } : feature,
      ),
    );
    this.rebuild();
  }
  updateSetting(key: keyof ComposerSettings, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.settings.update((settings) => ({ ...settings, [key]: value }));
    this.rebuild();
  }
  updateNoiseStyle(key: keyof ComposerSettings, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.settings.update((settings) => ({ ...settings, [key]: value }));
    this.rebuild();
  }
  randomizeNoise(): void {
    const seed = Math.floor(Math.random() * 999);
    this.seedLabel.set(String(seed));
    this.settings.update((settings) => ({ ...settings, noiseSeed: seed }));
    this.rebuild();
  }
  resetDemo(): void {
    this.features.set(createDemoFeatures());
    this.settings.set(defaultComposerSettings());
    this.seedLabel.set('7');
    this.rebuild();
  }

  setMoveConstraint(constraint: SplineMoveConstraint): void {
    this.moveConstraint.set(constraint);
    this.rebuildTransformGizmo();
  }
  selectedPointPosition(axis: 0 | 1 | 2): number | undefined {
    if (!this.selectedPoint) return undefined;
    const feature = this.features().find(
      (item) => item.id === this.selectedPoint?.featureId,
    );
    return feature?.points[this.selectedPoint.index]?.[axis];
  }
  nudgeSelected(axis: 0 | 1 | 2, amount: number): void {
    if (!this.selectedPoint) return;
    this.history.push(this.features());
    this.syncHistoryState();
    this.features.update((items) =>
      items.map((feature) =>
        feature.id !== this.selectedPoint?.featureId
          ? feature
          : {
              ...feature,
              points: feature.points.map((point, index) => {
                if (index !== this.selectedPoint?.index) return point;
                const delta: [number, number, number] = [0, 0, 0];
                delta[axis] = amount;
                return moveSplinePoint(point, delta, 'free');
              }),
            },
      ),
    );
    this.rebuild();
  }
  undo(): void {
    const restored = this.history.undo(this.features());
    if (restored) {
      this.features.set(restored);
      this.rebuild();
    }
    this.syncHistoryState();
  }
  redo(): void {
    const restored = this.history.redo(this.features());
    if (restored) {
      this.features.set(restored);
      this.rebuild();
    }
    this.syncHistoryState();
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    const restored = this.history.handleKeyDown(event, this.features());
    if (restored) {
      this.features.set(restored);
      this.rebuild();
    }
    this.syncHistoryState();
  }

  onCanvasClick(event: MouseEvent | null): void {
    if (!event || !this.editMode() || event.button !== 0) return;
    const target = this.pickTarget(event);
    if (target?.kind === 'axis' || target?.kind === 'plane') {
      const selected = this.selectedPoint;
      const feature = selected
        ? this.features().find((item) => item.id === selected.featureId)
        : undefined;
      const point =
        selected && feature ? feature.points[selected.index] : undefined;
      const hit = point ? this.raycastFree(event, point) : undefined;
      if (selected && point && hit) {
        this.history.push(this.features());
        this.syncHistoryState();
        this.drag = {
          kind: target.kind,
          featureId: selected.featureId,
          index: selected.index,
          axis: target.kind === 'axis' ? target.axis : target.constraint,
          startHit: hit,
          startPoint: point,
        };
        this.isDragging.set(true);
      }
      return;
    }
    if (target?.kind === 'point') {
      const pointHit = target;
      this.currentFeatureId = pointHit.featureId;
      const selectedFeature = this.features().find(
        (item) => item.id === pointHit.featureId,
      );
      if (selectedFeature) this.activeLayer.set(selectedFeature.layer);
      if (
        event.shiftKey &&
        this.selectedPoint?.featureId === pointHit.featureId &&
        this.selectedPoint.index === pointHit.index
      ) {
        this.selectedPoint = undefined;
      } else {
        this.selectedPoint = pointHit;
        const hit = this.raycastGround(event);
        if (hit) {
          const feature = this.features().find(
            (item) => item.id === pointHit.featureId,
          );
          const point = feature?.points[pointHit.index];
          if (point) {
            this.history.push(this.features());
            this.syncHistoryState();
            this.drag = {
              ...pointHit,
              startHit:
                this.moveConstraint() === 'free'
                  ? (this.raycastFree(event, point) ?? hit)
                  : hit,
              startPoint: point,
            };
            this.isDragging.set(true);
          }
        }
      }
      this.rebuildPointMeshes();
      return;
    }
    if (target?.kind === 'spline') {
      this.currentFeatureId = target.featureId;
      this.selectedPoint = undefined;
      const feature = this.features().find(
        (item) => item.id === target.featureId,
      );
      if (feature) this.activeLayer.set(feature.layer);
      this.rebuildPointMeshes();
      return;
    }
    if (!(event.ctrlKey || event.metaKey)) return;
    const hit = this.raycastGround(event);
    if (!hit) return;
    const layer = this.activeLayer();
    let id = this.currentFeatureId;
    if (layer === 'island')
      id = this.features().find((feature) => feature.layer === 'island')?.id;
    if (!id) {
      this.addFeature();
      id = this.currentFeatureId;
    }
    if (!id) return;
    this.features.update((items) =>
      items.map((feature) =>
        feature.id === id
          ? {
              ...feature,
              points: [...feature.points, hit],
              closed: layer === 'island' ? feature.closed : false,
            }
          : feature,
      ),
    );
    this.rebuild();
  }

  private onCanvasMove(event: MouseEvent | null): void {
    const drag = this.drag;
    if (!event || !drag) return;
    const hit =
      this.moveConstraint() === 'free'
        ? this.raycastFree(event, drag.startPoint)
        : this.raycastGround(event);
    if (!hit) return;
    const delta: [number, number, number] = [
      hit[0] - drag.startHit[0],
      hit[1] - drag.startHit[1],
      hit[2] - drag.startHit[2],
    ];
    this.features.update((items) =>
      items.map((feature) => {
        if (feature.id !== drag.featureId) return feature;
        const constraint =
          drag.kind === 'axis' || drag.kind === 'plane'
            ? (drag.axis ?? 'free')
            : this.moveConstraint();
        return {
          ...feature,
          points: feature.points.map((point, index) =>
            index === drag.index
              ? moveSplinePoint(drag.startPoint, delta, constraint)
              : point,
          ),
        };
      }),
    );
    // Keep pointer movement light: the terrain mesh, ocean, river ribbon and
    // preview canvases are committed once the drag ends. Only the editor
    // overlay needs to follow the pointer continuously.
    this.field.set(new TerrainComposerField(this.features(), this.settings()));
    this.rebuildLines();
  }

  private onCanvasUp(): void {
    const wasDragging = this.drag !== undefined;
    this.drag = undefined;
    this.isDragging.set(false);
    if (wasDragging) this.rebuild();
  }

  private syncHistoryState(): void {
    this.canUndo.set(this.history.canUndo);
    this.canRedo.set(this.history.canRedo);
  }

  private raycastGround(
    event: MouseEvent,
  ): [number, number, number] | undefined {
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.engine.camera);
    const hit = this.raycaster.intersectObject(this.ground, false)[0];
    return hit ? [hit.point.x, 0, hit.point.z] : undefined;
  }

  private raycastFree(
    event: MouseEvent,
    origin: readonly [number, number, number],
  ): [number, number, number] | undefined {
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.engine.camera);
    const normal = this.engine.camera.getWorldDirection(new Vector3());
    const plane = new Plane().setFromNormalAndCoplanarPoint(
      normal,
      new Vector3(origin[0], origin[1], origin[2]),
    );
    const hit = this.raycaster.ray.intersectPlane(plane, new Vector3());
    return hit ? [hit.x, hit.y, hit.z] : undefined;
  }

  private pickTarget(event: MouseEvent): ComposerPickTarget | undefined {
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.engine.camera);
    const [axisHit] = this.raycaster.intersectObjects(this.gizmoArrows, true);
    if (axisHit) return axisHit.object.userData['dragTarget'];
    const hit = this.raycaster.intersectObjects(this.pointMeshes, false)[0];
    if (hit) return hit.object.userData['dragTarget'];
    const [planeHit] = this.raycaster.intersectObjects(this.gizmoPlanes, false);
    if (planeHit) return planeHit.object.userData['dragTarget'];
    const [lineHit] = this.raycaster.intersectObjects(this.lines, false);
    return lineHit?.object.userData['dragTarget'];
  }

  private rebuild(): void {
    this.field.set(new TerrainComposerField(this.features(), this.settings()));
    this.rebuildTerrainMesh();
    this.rebuildLines();
    this.drawPreviews();
  }

  private rebuildTerrainMesh(): void {
    const size = 96,
      world = this.settings().worldSize;
    const positions = new Float32Array(size * size * 3),
      colors = new Float32Array(size * size * 3),
      uvs = new Float32Array(size * size * 2),
      indices: number[] = [];
    const active = this.field();
    const color = new Color();
    for (let row = 0; row < size; row++)
      for (let col = 0; col < size; col++) {
        const i = row * size + col,
          x = (col / (size - 1)) * world - world / 2,
          z = (row / (size - 1)) * world - world / 2;
        const elevation = active.sample([x, 0, z]).elevationM;
        positions[i * 3] = x;
        positions[i * 3 + 1] = elevation;
        positions[i * 3 + 2] = z;
        this.setTerrainColor(color, elevation);
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
        uvs[i * 2] = col / (size - 1);
        uvs[i * 2 + 1] = row / (size - 1);
      }
    for (let row = 0; row < size - 1; row++)
      for (let col = 0; col < size - 1; col++) {
        const i = row * size + col;
        indices.push(i, i + size, i + 1, i + 1, i + size, i + size + 1);
      }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new Mesh(
      geometry,
      new MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.94,
        metalness: 0,
        vertexColors: true,
      }),
    );
    const previous = this.group.getObjectByName('terrain');
    if (previous instanceof Mesh) {
      previous.removeFromParent();
      previous.geometry.dispose();
      (previous.material as MeshStandardMaterial).dispose();
    }
    mesh.name = 'terrain';
    this.group.add(mesh);
    this.rebuildOcean();
    this.rebuildWater();
  }

  private rebuildOcean(): void {
    this.ocean?.removeFromParent();
    this.ocean?.geometry.dispose();
    const size = this.settings().worldSize * 1.8;
    this.ocean = new Mesh(new PlaneGeometry(size, size), this.oceanMaterial);
    this.ocean.name = 'ocean';
    this.ocean.rotation.x = -Math.PI / 2;
    this.ocean.position.y = this.settings().seaLevel;
    this.ocean.renderOrder = 0;
    this.group.add(this.ocean);
  }

  private rebuildWater(): void {
    this.water?.removeFromParent();
    this.water?.geometry.dispose();
    this.water = undefined;
    const feature = this.features().find((item) => item.layer === 'river');
    if (!feature || feature.points.length < 2) return;
    const points: RiverControlPoint[] = this.field()
      .riverPolyline(feature.id)
      .map((point, index, all) => ({
        x: point[0],
        z: point[2],
        surfaceY:
          this.field().sampleLandElevation(point[0], point[2]) -
          this.settings().riverDepth * 0.72 +
          0.18,
        halfWidth: this.settings().riverWidth * 0.72,
        flowMps: 1.2 + (index / Math.max(1, all.length - 1)) * 1.8,
      }));
    if (points.length < 2) return;
    this.water = createRiverRibbon(new RiverPath(points), this.waterMaterial);
    this.water.name = 'river-water';
    this.group.add(this.water);
  }

  private setTerrainColor(color: Color, elevation: number): void {
    const sea = this.settings().seaLevel;
    if (elevation < sea - 10) {
      color.set('#123d5a');
    } else if (elevation < sea + 1) {
      color
        .set('#2d7890')
        .lerp(new Color('#d0b77a'), Math.max(0, (elevation - (sea - 10)) / 11));
    } else if (elevation < 22) {
      color
        .set('#587447')
        .lerp(new Color('#86a85f'), Math.min(1, (elevation - sea) / 30));
    } else if (elevation < 48) {
      color.set('#86a85f').lerp(new Color('#8a744f'), (elevation - 22) / 26);
    } else if (elevation < 72) {
      color.set('#8a744f').lerp(new Color('#77736a'), (elevation - 48) / 24);
    } else {
      color
        .set('#77736a')
        .lerp(new Color('#d5d8d0'), Math.min(1, (elevation - 72) / 28));
    }
  }

  private rebuildLines(): void {
    this.disposeLines();
    this.rebuildPointMeshes();
    for (const feature of this.features()) {
      if (feature.points.length < 2) continue;
      const visiblePoints = feature.points.map((point) =>
        this.overlayPoint(point),
      );
      const geometry = new BufferGeometry().setFromPoints(visiblePoints as any);
      const color =
        feature.layer === 'island'
          ? '#f4d35e'
          : feature.layer === 'mountain'
            ? '#e76f51'
            : '#53c7e8';
      const line = new Line(
        geometry,
        new LineBasicMaterial({ color, linewidth: 2 }),
      );
      line.userData['dragTarget'] = {
        kind: 'spline',
        featureId: feature.id,
      } satisfies ComposerPickTarget;
      if (feature.closed) {
        const closedPoints = [...visiblePoints, visiblePoints[0]];
        line.geometry.dispose();
        line.geometry = new BufferGeometry().setFromPoints(closedPoints as any);
      }
      this.group.add(line);
      this.lines.push(line);
    }
  }

  private overlayPoint(point: readonly [number, number, number]): {
    x: number;
    y: number;
    z: number;
  } {
    return {
      x: point[0],
      y: this.field().sample(point).elevationM + 3,
      z: point[2],
    };
  }

  private rebuildPointMeshes(): void {
    this.disposePointMeshes();
    for (const feature of this.features()) {
      feature.points.forEach((point, index) => {
        const mesh = new Mesh(
          this.pointGeometry,
          this.selectedPoint?.featureId === feature.id &&
            this.selectedPoint.index === index
            ? this.selectedPointMaterial
            : this.pointMaterial,
        );
        const visible = this.overlayPoint(point);
        mesh.position.set(visible.x, visible.y + 0.4, visible.z);
        mesh.userData['dragTarget'] = {
          kind: 'point',
          featureId: feature.id,
          index,
        } satisfies ComposerPickTarget;
        this.group.add(mesh);
        this.pointMeshes.push(mesh);
      });
    }
    this.rebuildTransformGizmo();
  }

  private rebuildTransformGizmo(): void {
    this.disposeTransformGizmo();
    if (!this.editMode() || !this.selectedPoint) return;
    const feature = this.features().find(
      (item) => item.id === this.selectedPoint?.featureId,
    );
    const point = feature?.points[this.selectedPoint.index];
    if (!point) return;
    const visible = this.overlayPoint(point);
    const origin = new Vector3(visible.x, visible.y, visible.z);
    const axes: Array<['x' | 'y' | 'z', Vector3, number]> = [
      ['x', new Vector3(1, 0, 0), 0xff4d4d],
      ['y', new Vector3(0, 1, 0), 0x55dd77],
      ['z', new Vector3(0, 0, 1), 0x4d8dff],
    ];
    for (const [axis, direction, color] of axes) {
      if (!constraintAllowsAxis(this.moveConstraint(), axis)) continue;
      const arrow = new ArrowHelper(direction, origin, 7, color, 1.5, 0.8);
      arrow.traverse((child) => {
        child.userData['dragTarget'] = {
          kind: 'axis',
          axis,
        } satisfies ComposerPickTarget;
      });
      this.group.add(arrow);
      this.gizmoArrows.push(arrow);
    }
    const planes: Array<['xy' | 'xz' | 'yz', number, Vector3]> = [
      ['xy', 0, new Vector3(0, 0, 2.8)],
      ['xz', -Math.PI / 2, new Vector3(0, 2.8, 0)],
      ['yz', Math.PI / 2, new Vector3(2.8, 0, 0)],
    ];
    for (const [constraint, rotation, offset] of planes) {
      if (!constraintAllowsPlane(this.moveConstraint(), constraint)) continue;
      const plane = new Mesh(
        new PlaneGeometry(3.2, 3.2),
        new MeshBasicMaterial({
          color: '#ffc857',
          transparent: true,
          opacity: 0.22,
          side: DoubleSide,
          depthWrite: false,
        }),
      );
      plane.position.copy(origin).add(offset);
      if (constraint === 'xy') plane.rotation.set(0, 0, rotation);
      else if (constraint === 'xz') plane.rotation.x = rotation;
      else plane.rotation.y = rotation;
      plane.userData['dragTarget'] = {
        kind: 'plane',
        constraint,
      } satisfies ComposerPickTarget;
      this.group.add(plane);
      this.gizmoPlanes.push(plane);
    }
  }

  private disposeTransformGizmo(): void {
    for (const arrow of this.gizmoArrows) {
      arrow.removeFromParent();
      arrow.line.geometry.dispose();
      (arrow.line.material as MeshBasicMaterial).dispose();
      arrow.cone.geometry.dispose();
      (arrow.cone.material as MeshBasicMaterial).dispose();
    }
    this.gizmoArrows = [];
    for (const plane of this.gizmoPlanes) {
      plane.removeFromParent();
      plane.geometry.dispose();
      (plane.material as MeshBasicMaterial).dispose();
    }
    this.gizmoPlanes = [];
  }

  private disposePointMeshes(): void {
    for (const mesh of this.pointMeshes) mesh.removeFromParent();
    this.pointMeshes = [];
  }

  private drawPreviews(): void {
    this.drawHeightmap();
    this.drawLayerPreview(this.islandPreview?.nativeElement, 'island');
    this.drawLayerPreview(this.mountainPreview?.nativeElement, 'mountain');
    this.drawLayerPreview(this.riverPreview?.nativeElement, 'river');
  }

  private drawHeightmap(): void {
    const canvas = this.heightmap?.nativeElement;
    if (!canvas) return;
    const size = 192;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const values = sampleHeightmap(
      this.field(),
      size,
      this.settings().worldSize,
    );
    const image = ctx.createImageData(size, size);
    const color = new Color();
    for (let i = 0; i < values.length; i++) {
      const value = values[i] / 255;
      color.set(
        value < 0.25
          ? '#174968'
          : value < 0.42
            ? '#3b8192'
            : value < 0.58
              ? '#6f9658'
              : value < 0.76
                ? '#a88d5c'
                : '#d6d9d0',
      );
      image.data[i * 4] = Math.round(color.r * 255);
      image.data[i * 4 + 1] = Math.round(color.g * 255);
      image.data[i * 4 + 2] = Math.round(color.b * 255);
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }

  private drawLayerPreview(
    canvas: HTMLCanvasElement | undefined,
    layer: ComposerLayer,
  ): void {
    if (!canvas) return;
    const size = 192;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(size, size);
    const color = new Color();
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        const x = (column / (size - 1)) * this.settings().worldSize - this.settings().worldSize / 2;
        const z = (row / (size - 1)) * this.settings().worldSize - this.settings().worldSize / 2;
        const value = this.field().sampleLayerMask(layer, x, z);
        color.set(layer === 'island' ? '#d3a84c' : layer === 'mountain' ? '#d9634e' : '#4dc7e5');
        color.multiplyScalar(0.16 + value * 0.84);
        const index = (row * size + column) * 4;
        image.data[index] = Math.round(color.r * 255);
        image.data[index + 1] = Math.round(color.g * 255);
        image.data[index + 2] = Math.round(color.b * 255);
        image.data[index + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  private disposeLines(): void {
    for (const line of this.lines) {
      line.removeFromParent();
      line.geometry.dispose();
      (line.material as LineBasicMaterial).dispose();
    }
    this.lines = [];
  }
}

function cloneFeatures(features: ComposerFeature[]): ComposerFeature[] {
  return features.map((feature) => ({
    ...feature,
    points: feature.points.map(
      (point) => [...point] as [number, number, number],
    ),
  }));
}

function constraintAllowsAxis(
  constraint: SplineMoveConstraint,
  axis: 'x' | 'y' | 'z',
): boolean {
  return constraint === 'free' || constraint.includes(axis);
}

function constraintAllowsPlane(
  constraint: SplineMoveConstraint,
  plane: 'xy' | 'xz' | 'yz',
): boolean {
  return (
    constraint === 'free' ||
    (constraint.length === 2 &&
      plane.split('').every((axis) => constraint.includes(axis)))
  );
}

function createDemoFeatures(): ComposerFeature[] {
  const scale = 1.35;
  const scalePoints = (
    points: [number, number, number][],
  ): [number, number, number][] =>
    points.map(([x, y, z]) => [x * scale, y, z * scale]);
  return [
    {
      id: 'island',
      layer: 'island',
      closed: true,
      points: scalePoints([
        [-68, 0, -18],
        [-42, 0, -62],
        [18, 0, -68],
        [70, 0, -26],
        [62, 0, 36],
        [18, 0, 68],
        [-44, 0, 52],
        [-72, 0, 20],
      ]),
    },
    {
      id: 'mountain-west',
      layer: 'mountain',
      closed: false,
      points: scalePoints([
        [-48, 0, 28],
        [-24, 0, 12],
        [2, 0, 22],
        [30, 0, 8],
        [53, 0, -12],
      ]),
    },
    {
      id: 'mountain-east',
      layer: 'mountain',
      closed: false,
      points: scalePoints([
        [-14, 0, 54],
        [2, 0, 30],
        [20, 0, 16],
        [42, 0, 18],
      ]),
    },
    {
      id: 'river',
      layer: 'river',
      closed: false,
      points: scalePoints([
        [18, 0, 47],
        [10, 0, 28],
        [4, 0, 10],
        [-2, 0, -12],
        [-22, 0, -32],
        [-48, 0, -48],
      ]),
    },
  ];
}
