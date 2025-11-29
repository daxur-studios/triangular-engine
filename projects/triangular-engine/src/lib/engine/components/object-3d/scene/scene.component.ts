import {
  AfterViewInit,
  Component,
  contentChildren,
  DestroyRef,
  effect,
  ElementRef,
  forwardRef,
  inject,
  Injector,
  input,
  OnDestroy,
  OnInit,
  output,
  Provider,
  Renderer2,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IKeyBindingOptions, IUserInterfaceOptions } from '../../../models';
import { EngineService, EngineSettingsService } from '../../../services';
import { EngineUiComponent } from '../../engine-ui/engine-ui.component';
import {
  Object3DComponent,
  provideObject3DComponent,
} from '../object-3d.component';

/**
 * Scenarios:
 * 1. <scene> is added without providing EngineService in a parent component
 * 2. <scene> is added with EngineService provided in a parent component
 * 3. <scene> is added inside another <scene> (therefore MUST not use parent EngineService)
 */
function optionallyProvideEngineService(): Provider[] {
  return [
    {
      provide: EngineService,
      useFactory: () => {
        const parentInjector = inject(Injector);
        const parentEngineService = inject(EngineService, {
          skipSelf: true,
          optional: true,
        });
        const parentSceneComponent = inject(
          forwardRef(() => SceneComponent),
          {
            optional: true,
            skipSelf: true,
          },
        );

        console.log({
          parentEngineService,
          parentSceneComponent,
        });

        const createEngineService = () =>
          Injector.create({
            providers: EngineService.provide({
              showFPS: false,
            }),
            parent: parentInjector,
          }).get(EngineService);

        if (parentSceneComponent) {
          return createEngineService();
        }

        if (parentEngineService) {
          return parentEngineService;
        }

        return createEngineService();
      },
    },
  ];
}

@Component({
  selector: 'scene',
  imports: [EngineUiComponent],
  templateUrl: './scene.component.html',
  styleUrl: './scene.component.scss',
  host: {
    class: 'flex-page',
  },
  providers: [optionallyProvideEngineService()],
})
export class SceneComponent implements OnInit, OnDestroy, AfterViewInit {
  static instance = 1;
  public readonly instance: number = SceneComponent.instance++;
  //#region Injected Dependencies
  readonly #destroyRef = inject(DestroyRef);
  readonly engineService: EngineService = inject(EngineService);

  readonly engineSettingsService = inject(EngineSettingsService);

  readonly renderer2 = inject(Renderer2);
  //#endregion

  readonly keyBindings = input<IKeyBindingOptions[]>([]);
  readonly userInterface = input<IUserInterfaceOptions>({});

  /**
   * If this input is set, the scene will only render when this input is triggered
   *
   * set it to true to render only once, or an incrementing number/string if multiple renders are needed
   *
   * No ticks will be triggered while this is enabled
   */
  readonly renderOnlyWhenThisIsTriggered = input<
    boolean | number | string | undefined | null
  >(undefined);
  readonly rendered = output<this>();

  readonly #resizeObserver: ResizeObserver = new ResizeObserver((entries) => {
    const { width, height } = entries[0].contentRect;
    this.#onResize(width, height);
  });

  readonly wrapper = viewChild.required<ElementRef<HTMLDivElement>>('wrapper');

  readonly css2dRenderer =
    viewChild.required<ElementRef<HTMLElement>>('css2dRenderer');

  readonly css3dRenderer =
    viewChild.required<ElementRef<HTMLElement>>('css3dRenderer');

  get scene() {
    return this.engineService.scene;
  }

  readonly children = contentChildren(Object3DComponent);

  constructor() {
    effect(() => {
      const children = this.children();

      children.forEach((child) => {
        const object3D = child.object3D();
        if (object3D) {
          this.scene.add(object3D);
        }
      });
    });

    // Watch for render trigger changes
    effect(() => {
      const shouldRender = this.renderOnlyWhenThisIsTriggered();

      if (shouldRender === undefined) {
        // Resume animation loop
        this.engineService.startAnimationLoop();
      } else {
        // Stop animation loop and do a single render
        this.engineService.stopLoop();
        this.engineService.requestSingleRender();
        this.rendered.emit(this);
      }
    });
  }

  ngOnInit(): void {
    this.engineService.setSceneComponent(this);

    this.#resizeObserver.observe(this.wrapper().nativeElement);
    this.engineService.initCss2dRenderer(this.css2dRenderer()!.nativeElement!);
    this.engineService.initCss3dRenderer(this.css3dRenderer()!.nativeElement!);

    this.handleKeyBindings();

    this.engineService.onComponentInit();
  }

  ngOnDestroy(): void {
    this.#resizeObserver.disconnect();
    this.engineService.onComponentDestroy();
  }

  ngAfterViewInit() {
    const canvas = this.engineService.canvas;
    // append canvas to the wrapper
    this.renderer2.appendChild(this.wrapper().nativeElement, canvas);
  }

  private handleKeyBindings() {
    const keyBindings = this.keyBindings();

    this.engineService.keydown$
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe((event) => {
        if (!event) return;

        keyBindings.forEach((keyBinding) => {
          if (keyBinding.keys.includes(event.key)) keyBinding.keydown(event);
        });
      });
  }

  #onResize(width: number, height: number): void {
    this.engineService.width$.next(width);
    this.engineService.height$.next(height);

    this.engineService.resolution$.next({
      width: width,
      height: height,
    });
  }
}
