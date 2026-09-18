import {
  Box3,
  Camera,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';

export interface SceneTestObject {
  id: string;
  label: string;
  object: Object3D;
}

export interface SceneTestBridge {
  version: 'scene-test-v1';
  discover(): unknown;
  reset(): Promise<unknown>;
  focus(request: { target: string; azimuthDeg?: number; elevationDeg?: number; padding?: number }): Promise<unknown>;
  orbit(request: { target: string; checkpointsDeg?: number[]; elevationDeg?: number }): Promise<unknown>;
  projectToScreen(target: string): unknown;
  capture(checkpoint?: string): Promise<unknown>;
  diagnostics(): unknown;
  injectFailure(kind: 'runtime-error' | 'readiness-timeout' | 'duplicate-id' | 'visual-mutation' | 'stale-render' | 'subscriber-error'): unknown;
  clearFailure(): unknown;
  stability(target: string, frames?: number): Promise<unknown>;
}

interface SceneTestRenderer { domElement: HTMLCanvasElement }

type Frame = { frameId: number; renderedAt: number };

export class SceneTestAdapter implements SceneTestBridge {
  readonly version = 'scene-test-v1' as const;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private frameId = 0;
  private readonly errors: Array<{ code: string; message: string; phase: string }> = [];
  private initialCamera = { position: new Vector3(), target: new Vector3() };
  private failure?: 'runtime-error' | 'readiness-timeout' | 'duplicate-id' | 'visual-mutation' | 'stale-render' | 'subscriber-error';

  constructor(
    private readonly scene: Object3D,
    private readonly cameraSource: Camera | (() => Camera),
    private readonly renderer: SceneTestRenderer,
    private readonly objects: readonly SceneTestObject[],
    private readonly render: () => Promise<Frame>,
  ) {
    this.initialCamera.position.copy(this.camera.position);
    this.initialCamera.target.set(0, 0, 0);
  }

  discover(): unknown {
    return {
      version: this.version,
      sceneId: 'inspection-reference',
      fixture: 'agent-reference-v1',
      capabilities: ['discover', 'reset', 'camera.focus', 'camera.orbit', 'projectToScreen', 'capture', 'diagnostics'],
      objects: this.objects.map(({ id, label, object }) => ({ id, label, bounds: this.bounds(object) })),
    };
  }

  async reset(): Promise<unknown> {
    if (this.failure === 'readiness-timeout') throw this.fail('TIMEOUT', 'Injected readiness timeout', 'ready');
    this.camera.position.copy(this.initialCamera.position);
    if (this.camera instanceof PerspectiveCamera) this.camera.lookAt(this.initialCamera.target);
    (this.camera as PerspectiveCamera).updateProjectionMatrix();
    return { state: 'ready', frame: await this.render() };
  }

  async focus(request: { target: string; azimuthDeg?: number; elevationDeg?: number; padding?: number }): Promise<unknown> {
    if (this.failure === 'runtime-error' || this.failure === 'subscriber-error') throw this.fail('RUNTIME_ERROR', `Injected ${this.failure}`, 'render');
    if (this.failure === 'stale-render') throw this.fail('TIMEOUT', 'Injected stale render', 'render');
    const entry = this.find(request.target);
    if (!entry.object.visible) throw this.fail('INVALID_BOUNDS', `Target ${request.target} is hidden`, 'focus');
    const bounds = new Box3().setFromObject(entry.object);
    if (bounds.isEmpty()) throw this.fail('INVALID_BOUNDS', `Target ${request.target} has empty bounds`, 'focus');
    const center = bounds.getCenter(new Vector3());
    const radius = Math.max(bounds.getSize(new Vector3()).length() * 0.5, 0.01);
    const padding = Math.max(request.padding ?? 1.2, 1);
    const azimuth = (request.azimuthDeg ?? 45) * Math.PI / 180;
    const elevation = (request.elevationDeg ?? 30) * Math.PI / 180;
    const distance = radius * padding / Math.max(Math.tan((this.camera as PerspectiveCamera).fov * Math.PI / 360), 0.1);
    this.camera.position.set(
      center.x + Math.sin(azimuth) * Math.cos(elevation) * distance,
      center.y + Math.sin(elevation) * distance,
      center.z + Math.cos(azimuth) * Math.cos(elevation) * distance,
    );
    this.camera.lookAt(center);
    const controls = (this.camera.userData as { sceneTestOrbitControls?: { target: Vector3; update: () => void; enabled: boolean } }).sceneTestOrbitControls;
    if (controls) {
      controls.enabled = false;
      controls.target.copy(center);
      controls.update();
    }
    (this.camera as PerspectiveCamera).updateProjectionMatrix();
    const frame = await this.render();
    return { target: request.target, pose: this.pose(), bounds: this.bounds(entry.object), frame };
  }

  async orbit(request: { target: string; checkpointsDeg?: number[]; elevationDeg?: number }): Promise<unknown> {
    const checkpoints = request.checkpointsDeg ?? [0, 90, 180, 270, 360];
    const results = [];
    for (const azimuthDeg of checkpoints) results.push(await this.focus({ target: request.target, azimuthDeg, elevationDeg: request.elevationDeg ?? 30 }));
    return { target: request.target, checkpoints: results };
  }

  projectToScreen(target: string): unknown {
    const entry = this.find(target);
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(entry.object);
    const center = bounds.getCenter(new Vector3()).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = (center.x + 1) * rect.width / 2;
    const y = (1 - center.y) * rect.height / 2;
    return { target, canvas: { x, y, width: rect.width, height: rect.height }, page: { x: rect.left + x, y: rect.top + y }, inFrustum: center.z >= -1 && center.z <= 1, bounds: this.bounds(entry.object) };
  }

  async capture(checkpoint = 'capture'): Promise<unknown> {
    const frame = await this.render();
    const image = this.renderer.domElement.toDataURL('image/png');
    return { checkpoint, frame, width: this.renderer.domElement.width, height: this.renderer.domElement.height, image };
  }

  diagnostics(): unknown { return { version: this.version, errors: [...this.errors] }; }
  injectFailure(kind: 'runtime-error' | 'readiness-timeout' | 'duplicate-id' | 'visual-mutation' | 'stale-render' | 'subscriber-error'): unknown { this.failure = kind; if (kind === 'visual-mutation') this.find('small-box').object.visible = false; return { injected: kind }; }
  clearFailure(): unknown { this.failure = undefined; this.find('small-box').object.visible = true; return { cleared: true }; }
  async stability(target: string, frames = 30): Promise<unknown> {
    this.find(target);
    const poses: unknown[] = [];
    for (let index = 0; index < frames; index++) { poses.push(this.pose()); await this.render(); }
    return { target, frames, poses };
  }

  hit(pageX: number, pageY: number): string | undefined {
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((pageX - rect.left) / rect.width) * 2 - 1, -((pageY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.objects.map((item) => item.object), true)[0];
    return hit ? this.objects.find((item) => item.object === hit.object || item.object.children.includes(hit.object))?.id : undefined;
  }

  private find(id: string): SceneTestObject {
    if (this.failure === 'duplicate-id' && id === 'small-box') throw this.fail('DUPLICATE_ID', `Injected duplicate target ${id}`, 'resolve');
    const found = this.objects.filter((item) => item.id === id);
    if (found.length !== 1) throw this.fail(found.length ? 'DUPLICATE_ID' : 'TARGET_NOT_FOUND', `Unknown or duplicate target ${id}`, 'resolve');
    return found[0];
  }

  private bounds(object: Object3D): unknown {
    const box = new Box3().setFromObject(object);
    return { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new Vector3()).toArray(), center: box.getCenter(new Vector3()).toArray() };
  }

  private pose(): unknown { return { position: this.camera.position.toArray(), quaternion: this.camera.quaternion.toArray() }; }
  private get camera(): Camera { return typeof this.cameraSource === 'function' ? this.cameraSource() : this.cameraSource; }
  private fail(code: string, message: string, phase: string): Error { this.errors.push({ code, message, phase }); return new Error(`${code}: ${message}`); }
}
