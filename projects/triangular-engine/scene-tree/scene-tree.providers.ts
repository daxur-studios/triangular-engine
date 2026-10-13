import type { Provider } from '@angular/core';
import { ENGINE_SCENE_TREE_COMPONENT } from 'triangular-engine';
import { SceneTreeComponent } from './scene-tree.component';

/**
 * Enables the Material Scene Tree panel for engine UI in the current injector.
 *
 * Value: scenes can opt into inspection without making Material a core dependency.
 */
export function provideSceneTree(): Provider[] {
  return [{ provide: ENGINE_SCENE_TREE_COMPONENT, useValue: SceneTreeComponent }];
}
