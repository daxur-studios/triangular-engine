import { InjectionToken, type Type } from '@angular/core';

/**
 * Optional Scene Tree component supplied by the Material inspection entry point.
 *
 * Value: core UI can render an opted-in panel without importing its implementation.
 */
export const ENGINE_SCENE_TREE_COMPONENT = new InjectionToken<Type<unknown>>(
  'ENGINE_SCENE_TREE_COMPONENT',
);
