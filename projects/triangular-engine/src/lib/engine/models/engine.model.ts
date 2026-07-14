import { BehaviorSubject, ReplaySubject, takeUntil } from 'rxjs';
import {
  Camera,
  Clock,
  Scene,
  ToneMapping,
  WebGLRenderer,
  WebGLRendererParameters,
} from 'three';

import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import {
  EventEmitter,
  InjectionToken,
  InputSignal,
  WritableSignal,
  signal,
} from '@angular/core';

import { FPSController } from './fps.controller';
import { Cursor } from './cursor.model';
import { WebGPURenderer } from 'three/webgpu';
import type { WebGPURendererParameters } from 'three/src/renderers/webgpu/WebGPURenderer.js';
import type { EngineRenderPipeline } from './engine-render-pipeline.model';

//#region Provide Engine Options
export const ENGINE_OPTIONS = new InjectionToken<IEngineOptions>(
  'ENGINE_OPTIONS',
);

export function provideEngineOptions(options: IEngineOptions) {
  return {
    provide: ENGINE_OPTIONS,
    useValue: options,
  };
}
//#endregion

export interface IPerformanceThresholds {
  /** Maximum healthy frame time in ms. Default is 16.6ms (60 FPS equivalent) */
  maxFrameTimeWarning?: number;
  maxFrameTimeCritical?: number;

  /** Maximum healthy draw calls. Default is 150 */
  maxDrawCallsWarning?: number;
  maxDrawCallsCritical?: number;

  /** Maximum healthy triangles. Default is 1,000,000 */
  maxTrianglesWarning?: number;
  maxTrianglesCritical?: number;
}

export interface IEngineOptions {
  showFPS?: boolean;
  performanceThresholds?: IPerformanceThresholds;

  /**
   * Renderer pixel ratio. Defaults to the device pixel ratio capped at 2.
   * Lower values reduce GPU fill cost; 1 renders at CSS-pixel resolution.
   */
  pixelRatio?: number;

  /** Renderer tone mapping. Defaults to THREE.ACESFilmicToneMapping. */
  toneMapping?: ToneMapping;
  /** Renderer tone-mapping exposure. Defaults to 1. */
  toneMappingExposure?: number;

  transparent?: boolean;
  webGLRendererParameters?: WebGLRendererParameters;
  /** Parameters forwarded to WebGPURenderer constructor. */
  webGpuRendererParameters?: WebGPURendererParameters;
  /**
   * Preferred renderer to use. WebGL by default
   */
  preferredRenderer?: 'webgl' | 'webgpu';

  speedFactor$?: BehaviorSubject<number>;
  elapsedTime$?: BehaviorSubject<number>;
}

export interface IEngineLifecycle {
  readonly onDestroy$: ReplaySubject<void>;

  readonly fpsController: FPSController;
  readonly tick$: BehaviorSubject<number>;

  readonly speedFactor$: BehaviorSubject<number>;

  onComponentInit(): void;
  onComponentDestroy(): void;

  beginPlay(): void;
  endPlay(): void;

  readonly isPlaying: WritableSignal<boolean>;
  readonly onBeginPlay$: ReplaySubject<void>;
  readonly onBeginPlaySignal: WritableSignal<boolean>;
  readonly onEndPlay$: ReplaySubject<void>;
  readonly onEndPlaySignal: WritableSignal<boolean>;

  tick(delta: number): void;
  startLoop(): void;
  stopLoop(): void;
  render(time: number, force?: boolean, deltaTime?: number): void;
  setFPSLimit(fps: number): void;
}

export interface IEngineCamera {
  readonly camera$: BehaviorSubject<Camera>;
  readonly camera: Camera;
  switchCamera(camera: Camera): void;
}

export interface IEngineCore extends IEngineCamera {
  readonly canvas: HTMLCanvasElement;

  readonly options: IEngineOptions;
  renderer: WebGLRenderer | WebGPURenderer | undefined;
  composer: EffectComposer | undefined;
  renderPass: RenderPass | undefined;
  renderPipeline: EngineRenderPipeline | undefined;

  readonly scene: Scene;
  readonly clock: Clock;

  cursor: Cursor;

  readonly width$: BehaviorSubject<number>;
  readonly height$: BehaviorSubject<number>;
  readonly width: number;
  readonly height: number;
  readonly resolution$: BehaviorSubject<ISizes>;
}

/** Width and height */
export interface ISizes {
  width: number;
  height: number;
}

export interface IEngineInput {
  readonly keyup$: BehaviorSubject<KeyboardEvent | null>;
  readonly keydown$: BehaviorSubject<KeyboardEvent | null>;
  readonly mouseup$: BehaviorSubject<MouseEvent | null>;
  readonly mousedown$: BehaviorSubject<MouseEvent | null>;
  readonly mousemove$: BehaviorSubject<MouseEvent | null>;
  readonly mousewheel$: BehaviorSubject<Event | WheelEvent | MouseEvent | null>;
  readonly contextmenu$: BehaviorSubject<MouseEvent | null>;
}

export interface IEngine extends IEngineCore, IEngineLifecycle, IEngineInput {}
