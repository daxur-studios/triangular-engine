import {
  Injectable,
  Provider,
  WritableSignal,
  inject,
  signal,
} from '@angular/core';
import {
  BehaviorSubject,
  ReplaySubject,
  Subject,
  filter,
  firstValueFrom,
} from 'rxjs';
import {
  ACESFilmicToneMapping,
  BufferGeometry,
  Camera,
  Clock,
  Mesh,
  OrthographicCamera,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  WebGLRendererParameters,
} from 'three';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { WebGPURenderer } from 'three/webgpu';

import {
  Cursor,
  ENGINE_OPTIONS,
  EngineRenderPipeline,
  FPSController,
  IEngine,
  IEngineOptions,
  provideEngineOptions,
} from '../models';

import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import type { SceneComponent } from '../components/object-3d/scene/scene.component';

import { toSignal } from '@angular/core/rxjs-interop';
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh';
import { EngineSettingsService } from './engine-settings.service';

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
  /** Set by EffectComposerComponent when using declarative post-processing (WebGL only). */
  public renderPass: RenderPass | undefined;
  public renderPipeline: EngineRenderPipeline | undefined;
  private composerPipeline: EngineRenderPipeline | undefined;

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
  /**
   * Fired after postTick$ camera/controllers have settled, immediately before
   * rendering. Camera-relative render systems should update here.
   */
  readonly beforeRender$ = new Subject<void>();

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

    this.renderer.info.autoReset = false;

    this.renderer.toneMapping =
      this.options.toneMapping ?? ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.options.toneMappingExposure ?? 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;

    this.renderer.setSize(this.width, this.height);

    this.renderer.setPixelRatio(this.pixelRatio);

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

    renderer.info.autoReset = false;

    // Keep tone mapping alignment with WebGL defaults
    renderer.toneMapping = this.options.toneMapping ?? ACESFilmicToneMapping;
    renderer.toneMappingExposure = this.options.toneMappingExposure ?? 1.0;

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;

    renderer.setSize(this.width, this.height);
    renderer.setPixelRatio(this.pixelRatio);

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
    const pixelRatio = this.pixelRatio;
    this.renderPipeline?.setSize(width, height, pixelRatio);

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

    this.renderer.setPixelRatio(pixelRatio);

    this.CSS2DRenderer?.setSize(this.width, this.height);
    this.CSS3DRenderer?.setSize(this.width, this.height);

    this.render(this.fpsController.lastRenderTime);
  }

  /**
   * Register the active effect composer (called by EffectComposerComponent).
   * When set, render() uses composer.render() instead of renderer.render().
   */
  public setComposer(composer: EffectComposer, renderPass?: RenderPass): void {
    const pipeline: EngineRenderPipeline = {
      render: (deltaTime) => composer.render(deltaTime),
      setSize: (width, height, pixelRatio) => {
        composer.setPixelRatio(pixelRatio);
        composer.setSize(width, height);
      },
    };

    this.registerRenderPipeline(pipeline);
    this.composer = composer;
    this.renderPass = renderPass;
    this.composerPipeline = pipeline;
  }

  /**
   * Clear the active effect composer (called by EffectComposerComponent on destroy).
   */
  public clearComposer(): void {
    if (this.composerPipeline) {
      this.unregisterRenderPipeline(this.composerPipeline);
      this.composerPipeline = undefined;
    }
    this.composer?.dispose();
    this.composer = undefined;
    this.renderPass = undefined;
  }

  /** Register the sole owner of the engine's main render. */
  public registerRenderPipeline(pipeline: EngineRenderPipeline): void {
    if (this.renderPipeline && this.renderPipeline !== pipeline) {
      throw new Error('An EngineRenderPipeline is already registered.');
    }

    this.renderPipeline = pipeline;
    pipeline.setSize(this.width, this.height, this.pixelRatio);
  }

  /** The configured renderer pixel ratio, or the engine's capped device default. */
  public get pixelRatio(): number {
    const pixelRatio = this.options.pixelRatio;
    return pixelRatio !== undefined && pixelRatio > 0
      ? pixelRatio
      : Math.min(window.devicePixelRatio, 2);
  }

  /** Remove a pipeline only when it is the currently registered instance. */
  public unregisterRenderPipeline(pipeline: EngineRenderPipeline): void {
    if (this.renderPipeline === pipeline) {
      this.renderPipeline = undefined;
    }
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
    const startTime = performance.now();
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
    this.beforeRender$.next();

    this.render(time, false, delta);

    const frameTimeMs = performance.now() - startTime;
    this.fpsController.recordFrame(frameTimeMs);
  }

  public render(time: number, force?: boolean, deltaTime = 0) {
    if (!this.renderer || !this.camera) return;

    // Only render if enough time has passed since the last frame
    if (
      force ||
      time - this.fpsController.lastRenderTime >=
        this.fpsController.fpsLimitInterval
    ) {
      this.renderer.info.reset();

      if (this.renderPipeline) {
        this.renderPipeline.render(deltaTime);
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

    // EffectComposerComponent subscribes to camera$ and updates its RenderPass camera

    // Trigger resize to adjust ortho frustum if needed
    this.onResize(this.width, this.height);

    // Render the scene with the composer instead of the renderer
    this.render(this.fpsController.lastRenderTime, true);
  }
}
