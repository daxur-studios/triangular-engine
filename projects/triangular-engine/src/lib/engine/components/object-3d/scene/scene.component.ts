import {
  AfterViewInit,
  Component,
  contentChildren,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  OnInit,
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

@Component({
  selector: 'scene',
  standalone: true,
  imports: [EngineUiComponent],
  templateUrl: './scene.component.html',
  styleUrl: './scene.component.scss',
  host: {
    class: 'flex-page',
  },
  providers: [provideObject3DComponent(SceneComponent)],
})
export class SceneComponent
  extends Object3DComponent
  implements OnInit, OnDestroy, AfterViewInit
{
  //#region Injected Dependencies
  readonly #destroyRef = inject(DestroyRef);
  override readonly engineService: EngineService = inject(EngineService, {
    skipSelf: true,
  });

  readonly engineSettingsService = inject(EngineSettingsService);

  readonly renderer2 = inject(Renderer2);
  //#endregion

  readonly keyBindings = input<IKeyBindingOptions[]>([]);
  readonly userInterface = input<IUserInterfaceOptions>({});

  readonly #resizeObserver: ResizeObserver = new ResizeObserver((entries) => {
    const { width, height } = entries[0].contentRect;
    this.#onResize(width, height);
  });

  readonly wrapper = viewChild.required<ElementRef<HTMLDivElement>>('wrapper');

  readonly css2dRenderer =
    viewChild.required<ElementRef<HTMLElement>>('css2dRenderer');

  static instance = 0;

  get scene() {
    return this.engineService.scene;
  }
  override readonly object3D = signal(this.scene);

  readonly children = contentChildren(Object3DComponent);

  constructor() {
    super();

    SceneComponent.instance++;
    this.name.set(`Engine Scene ${SceneComponent.instance}`);

    this.engineService.setEngineComponent(this);

    effect(() => {
      const children = this.children();

      children.forEach((child) => {
        this.scene.add(child.object3D());
      });
    });
  }

  ngOnInit(): void {
    this.#resizeObserver.observe(this.wrapper().nativeElement);
    this.engineService.initCss2dRenderer(this.css2dRenderer()!.nativeElement!);

    this.handleKeyBindings();

    this.engineService.onComponentInit();
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();

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
