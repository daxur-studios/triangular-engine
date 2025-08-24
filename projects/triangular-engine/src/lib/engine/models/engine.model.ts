import { BehaviorSubject, ReplaySubject, takeUntil } from 'rxjs';
import {
  Camera,
  Clock,
  Scene,
  WebGLRenderer,
  WebGLRendererParameters,
} from 'three';

import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
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

export interface IEngineOptions {
  showFPS?: boolean;

  transparent?: boolean;
  webGLRendererParameters?: WebGLRendererParameters;
  /** Parameters forwarded to WebGPURenderer constructor. */
  webGpuRendererParameters?: unknown;
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
  render(time: number, force?: boolean): void;
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

  readonly scene: Scene;
  readonly clock: Clock;

  cursor: Cursor;

  readonly width$: BehaviorSubject<number>;
  readonly height$: BehaviorSubject<number>;
  readonly width: number;
  readonly height: number;
  readonly resolution$: BehaviorSubject<ISizes>;
}

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
