import {
  Component,
  DestroyRef,
  inject,
  OnDestroy,
  Provider,
  Type,
  WritableSignal,
  forwardRef,
} from '@angular/core';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { EngineService } from '../../../services';

/**
 * Base class for post-processing pass components used inside {@link EffectComposerComponent}.
 * Subclasses create a Three.js Pass and optionally sync inputs to it via effects.
 */
@Component({
  standalone: true,
  template: '',
  selector: 'abstract-pass',
})
export abstract class AbstractPassComponent implements OnDestroy {
  readonly engineService = inject(EngineService);
  readonly destroyRef = inject(DestroyRef);

  /**
   * Called by EffectComposerComponent inside an effect when the pass component list changes.
   * Implementations should create the pass (or return a cached one) and store it in the pass signal.
   * If creating a new pass while one already exists, dispose the old one first to avoid leaking GPU resources.
   *
   * **Important:** Be careful about signal reads that could trigger unwanted effect re-runs. Use
   * `untracked()` when reading signals that should not cause the caller's effect to re-execute
   * (e.g. when disposing the previous pass via `this.pass()`).
   */
  abstract createPass(): Pass;

  /**
   * Signal holding the current pass instance, used for reactive property updates and cleanup.
   */
  abstract readonly pass: WritableSignal<Pass | undefined>;

  ngOnDestroy(): void {
    const p = this.pass();
    if (p && typeof (p as { dispose?: () => void }).dispose === 'function') {
      (p as { dispose: () => void }).dispose();
    }
  }
}

/**
 * Provider for a concrete pass component. Use in the component's providers array.
 *
 * @param component The component class that extends AbstractPassComponent.
 * @returns A Provider for Angular's dependency injection.
 */
export function providePassComponent<T extends AbstractPassComponent>(
  component: Type<T>,
): Provider {
  return {
    provide: AbstractPassComponent,
    useExisting: forwardRef(() => component),
  };
}
