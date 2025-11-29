import {
  EventEmitter,
  Inject,
  Injectable,
  InjectionToken,
  WritableSignal,
  effect,
  inject,
  input,
  signal,
  Provider,
} from '@angular/core';
import {
  BehaviorSubject,
  Subject,
  filter,
  firstValueFrom,
  ReplaySubject,
} from 'rxjs';
import {
  ACESFilmicToneMapping,
  Camera,
  Clock,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  WebGLRendererParameters,
  BufferGeometry,
  Mesh,
  OrthographicCamera,
} from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';

import {
  Cursor,
  ENGINE_OPTIONS,
  FPSController,
  IEngine,
  IEngineOptions,
  provideEngineOptions,
} from '../models';

import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import type { SceneComponent } from '../components/object-3d/scene/scene.component';

import { EngineSettingsService } from './engine-settings.service';
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh';
import { toSignal } from '@angular/core/rxjs-interop';

@Injectable()
export class EngineService implements IEngine {
  static provideEngineOptions = provideEngineOptions;
  static provide(options: IEngineOptions = {}): Provider[] {
    return [EngineService, provideEngineOptions(options)];
  }

  static instance = 0;
  public readonly instance: number;

  //#region Injected Dependencies
  readonly options = inject<IEngineOptions>(ENGINE_OPTIONS);
  readonly engineSettingsService = inject(EngineSettingsService);

  //#endregion

  //#region Core

  //#region Sizes
  public resolution$ = new BehaviorSubject<{ width: number; height: number }>({
    width: 50,
    height: 50,
  });

  public width$ = new BehaviorSubject<number>(1);
  public height$ = new BehaviorSubject<number>(1);
  public get width() {
    return this.width$.value;
  }
  public get height() {
    return this.height$.value;
  }

  //#endregion

  readonly canvas = document.createElement('canvas');
  readonly scene = new Scene();

  webGLRenderer?: WebGLRenderer;

  renderer: WebGLRenderer | WebGPURenderer;
  CSS2DRenderer: CSS2DRenderer | undefined;
  CSS3DRenderer: CSS3DRenderer | undefined;

  public composer: EffectComposer | undefined;
  public renderPass: RenderPass | undefined;

  public readonly clock = new Clock();

  readonly camera$: BehaviorSubject<Camera> = new BehaviorSubject<Camera>(
    new PerspectiveCamera(),
  );
  /** Created from the camera$ BehaviorSubject */
  readonly cameraSignal = toSignal(this.camera$);
  get camera() {
    return this.camera$.value;
  }

  //#endregion

  //#region Lifecycle Events

  public readonly speedFactor$ =
    this.options.speedFactor$ || new BehaviorSubject(1);

  readonly elapsedTime$: BehaviorSubject<number> =
    this.options.elapsedTime$ || new BehaviorSubject(0);

  /**
   * value: delta time * speed factor
   *
   * Ticker for the rendering loop, holds the delta time * speed factor.
   * Unit: seconds
   */
  readonly tick$: BehaviorSubject<number> = new BehaviorSubject<number>(0);
  /** Fired after all tick$ subscribers run but before rendering the frame */
  readonly postTick$ = new Subject<void>();

  /** Triggered when the SceneComponent is destroyed */
  readonly onDestroy$ = new ReplaySubject<void>();

  readonly onBeginPlay$ = new ReplaySubject<void>();
  readonly onEndPlay$ = new ReplaySubject<void>();
  readonly onBeginPlaySignal: WritableSignal<boolean> = signal(false);
  readonly onEndPlaySignal: WritableSignal<boolean> = signal(false);

  readonly isPlaying = signal(false);
  //#endregion

  //#region Input Events
  readonly keyup$ = new BehaviorSubject<KeyboardEvent | null>(null);
  readonly keydown$ = new BehaviorSubject<KeyboardEvent | null>(null);
  readonly mouseup$ = new BehaviorSubject<MouseEvent | null>(null);
  readonly mousedown$ = new BehaviorSubject<MouseEvent | null>(null);
  readonly mousemove$ = new BehaviorSubject<MouseEvent | null>(null);
  readonly click$ = new BehaviorSubject<MouseEvent | null>(null);
  readonly dblclick$ = new BehaviorSubject<MouseEvent | null>(null);
  readonly wheel$ = new BehaviorSubject<WheelEvent | null>(null);
  readonly pointerdown$ = new BehaviorSubject<PointerEvent | null>(null);

  readonly mousewheel$ = new BehaviorSubject<
    Event | WheelEvent | MouseEvent | null
  >(null);
  readonly contextmenu$ = new BehaviorSubject<MouseEvent | null>(null);
  //#endregion
  public readonly isDraggingTransformControls$ = new BehaviorSubject<boolean>(
    false,
  );

  readonly cursor: Cursor;

  readonly fpsController: FPSController = new FPSController(this);

  constructor() {
    EngineService.instance++;
    this.instance = EngineService.instance;
    console.debug('EngineService created, instance: ', this.instance);

    this.cursor = new Cursor(this);

    const renderer = this.initRenderer(this.options);
    this.renderer = renderer;

    if (renderer instanceof WebGLRenderer) {
      this.createComposer(renderer);
    }

    BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
    BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
    Mesh.prototype.raycast = acceleratedRaycast;
  }

  readonly sceneComponent = new BehaviorSubject<SceneComponent | undefined>(
    undefined,
  );

  public getSceneComponent() {
    return this.sceneComponent.value;
  }
  public async getSceneComponentAsync() {
    return await firstValueFrom(this.sceneComponent.pipe(filter((x) => !!x)));
  }
  public setSceneComponent(sceneComponent: SceneComponent) {
    this.sceneComponent.next(sceneComponent);
  }

  public consoleLogGroup(
    message: any,
    type?: 'log' | 'warn' | 'error' | 'debug',
  ) {
    if (type === 'warn') {
      console.warn(message);
    } else if (type === 'error') {
      console.error(message);
    } else if (type === 'debug') {
      console.debug(message);
    } else {
      console.log(message);
    }
  }

  onComponentDestroy(): void {
    this.stopLoop();

    this.onDestroy$.next();
    this.onDestroy$.complete();

    this.renderer?.dispose();
  }

  onComponentInit(): void {
    // WebGPU needs explicit initialization before the first render.
    if (this.renderer instanceof WebGPURenderer) {
      // Do not await to keep the signature synchronous; start loop after init completes.
      this.renderer
        .init()
        .then(() => this.startLoop())
        .catch(() => this.startLoop());
      return;
    }
    this.startLoop();
  }

  beginPlay() {
    this.onBeginPlay$.next();
    this.onBeginPlay$.complete();
    this.isPlaying.set(true);
  }
  endPlay() {
    this.onEndPlay$.next();
    this.onEndPlay$.complete();
    this.isPlaying.set(false);
  }

  private initRenderer(options?: IEngineOptions) {
    const preferred = options?.preferredRenderer ?? 'webgl';

    // Try WebGPU if preferred or auto
    if (preferred === 'webgpu' && this.isWebGPUSupported()) {
      const webGpuParams: any = {
        ...(options?.webGpuRendererParameters || {}),
      } as any;
      if (options?.transparent) {
        // Align behavior with WebGL when transparent scenes are requested
        (webGpuParams as any).alpha = true;
      }
      try {
        this.renderer = this.createWebGpuRenderer(webGpuParams);
        return this.renderer;
      } catch (err) {
        console.warn(
          'WebGPU renderer initialization failed, falling back to WebGL.',
          err,
        );
      }
    }

    // Fallback to WebGL
    const webGLParams = options?.webGLRendererParameters || {};
    if (options?.transparent) {
      webGLParams.alpha = true;
    }
    this.renderer = this.createWebGlRenderer(webGLParams);
    return this.renderer;
  }
  /** Initiated in the canvas component */
  public initCss2dRenderer(element: HTMLElement) {
    this.CSS2DRenderer = new CSS2DRenderer({ element: element });
    this.CSS2DRenderer.setSize(this.width, this.height);
    this.CSS2DRenderer.domElement.style.position = 'absolute';
    this.CSS2DRenderer.domElement.style.pointerEvents = 'none';
    this.CSS2DRenderer.domElement.style.top = '0';
    this.CSS2DRenderer.domElement.style.width = '100%';
    this.CSS2DRenderer.domElement.style.height = '100%';

    //  document.body.appendChild(this.CSS2DRenderer.domElement);
  }
  /** Initiated in the canvas component */
  public initCss3dRenderer(element: HTMLElement) {
    this.CSS3DRenderer = new CSS3DRenderer({ element: element });
    this.CSS3DRenderer.setSize(this.width, this.height);
    this.CSS3DRenderer.domElement.style.position = 'absolute';
    this.CSS3DRenderer.domElement.style.pointerEvents = 'none';
    this.CSS3DRenderer.domElement.style.top = '0';
    this.CSS3DRenderer.domElement.style.width = '100%';
    this.CSS3DRenderer.domElement.style.height = '100%';

    //  document.body.appendChild(this.CSS3DRenderer.domElement);
  }
  public createWebGlRenderer(
    webGLRendererParameters?: WebGLRendererParameters,
  ): WebGLRenderer {
    if (this.renderer) {
      this.renderer.dispose();
    }

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      ...webGLRendererParameters,
    });

    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.renderer.setSize(this.width, this.height);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.resolution$.subscribe(({ width, height }) =>
      this.onResize(width, height),
    );

    if (this.composer) {
      this.composer.renderer = this.renderer;
    }

    return this.renderer;
  }

  public createWebGpuRenderer(
    webGpuRendererParameters?: unknown,
  ): WebGPURenderer {
    if (this.renderer) {
      this.renderer.dispose();
    }

    const renderer = new WebGPURenderer({
      canvas: this.canvas,
      ...(webGpuRendererParameters || {}),
    } as any);

    // Keep tone mapping alignment with WebGL defaults
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;

    renderer.setSize(this.width, this.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.resolution$.subscribe(({ width, height }) =>
      this.onResize(width, height),
    );

    // Composer currently targets WebGL. Skip for WebGPU.
    return (this.renderer = renderer);
  }

  private isWebGPUSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      'gpu' in navigator &&
      !!(navigator as any).gpu
    );
  }

  private onResize(width: number, height: number) {
    if (!this.renderer) {
      return;
    }

    this.renderer.setSize(width, height, true);
    this.composer?.setSize(width, height);

    if (this.camera instanceof PerspectiveCamera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    } else if (this.camera instanceof OrthographicCamera) {
      const aspect = width / height;
      const viewHeight = this.camera.top - this.camera.bottom;
      this.camera.left = -((aspect * viewHeight) / 2);
      this.camera.right = (aspect * viewHeight) / 2;
      this.camera.updateProjectionMatrix();
    }

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer?.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.CSS2DRenderer?.setSize(this.width, this.height);
    this.CSS3DRenderer?.setSize(this.width, this.height);

    this.render(this.fpsController.lastRenderTime);
  }
  private createComposer(renderer: WebGLRenderer): EffectComposer {
    if (this.renderPass) {
      this.renderPass.dispose();
    }
    if (this.composer) {
      this.composer.dispose();
    }

    const composer = new EffectComposer(renderer);

    const renderPass = new RenderPass(this.scene, this.camera);
    this.renderPass = renderPass;

    composer.addPass(renderPass);

    return composer;
  }

  /** Start the rendering loop */
  async startLoop() {
    // await this.physicsService.worldPromise;
    const sceneComponent = await this.getSceneComponentAsync();

    // Check if we should only render on trigger
    if (sceneComponent.renderOnlyWhenThisIsTriggered() !== undefined) {
      // Initial render
      this.render(this.clock.getElapsedTime(), true);
      return;
    }

    this.startAnimationLoop();
  }

  public startAnimationLoop() {
    this.renderer!.setAnimationLoop((time) => this.tick(time));
  }

  /** Handle single render requests */
  public requestSingleRender() {
    this.render(this.clock.getElapsedTime(), true);
  }

  /** Stop the rendering loop */
  stopLoop() {
    this.renderer?.setAnimationLoop(null);
  }
  /** Ticker function runs every frame */
  tick(time: number) {
    const delta = this.clock.getDelta() * this.speedFactor$.value;

    this.tick$.next(delta);
    this.elapsedTime$.next(this.elapsedTime$.value + delta);

    // Update the physics simulation
    //this.physicsService.update(delta);

    // Synchronize physics and rendering
    //this.syncPhysicsToRender();

    //if (this.useOrbitControls) this.orbitControls?.update(delta);

    // Allow late subscribers (e.g., camera follow) to update just before render
    this.postTick$.next();

    this.render(time);
  }

  public render(time: number, force?: boolean) {
    if (!this.renderer || !this.camera) return;

    // Only render if enough time has passed since the last frame
    if (
      force ||
      time - this.fpsController.lastRenderTime >=
        this.fpsController.fpsLimitInterval
    ) {
      if (this.composer) {
        this.composer.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }

      if (this.CSS2DRenderer)
        this.CSS2DRenderer.render(this.scene, this.camera);

      if (this.CSS3DRenderer)
        this.CSS3DRenderer.render(this.scene, this.camera);

      this.fpsController.lastRenderTime = time;
    }
  }
  public setSpeedFactor(timeSpeed: number) {
    this.speedFactor$.next(timeSpeed);
  }
  public setFPSLimit(fpsLimit: number) {
    if (fpsLimit === 0) this.fpsController.fpsLimitInterval = 0;
    else this.fpsController.fpsLimitInterval = 1000 / fpsLimit;
  }

  public switchCamera(newCamera: Camera) {
    this.camera$.next(newCamera);

    if (newCamera instanceof PerspectiveCamera && this.canvas) {
      newCamera.aspect = this.width / this.height;
      newCamera.updateProjectionMatrix();
    } else if (newCamera instanceof OrthographicCamera) {
      newCamera.updateProjectionMatrix();
    }

    if (this.renderPass) {
      this.renderPass.camera = newCamera;
    }

    // Trigger resize to adjust ortho frustum if needed
    this.onResize(this.width, this.height);

    // Render the scene with the composer instead of the renderer
    this.render(this.fpsController.lastRenderTime, true);
  }
}
